const AV = require('leanengine');
const express = require('express');
const app = express();
const axios = require('axios');
const sql = require('mssql');

// 初始化 LeanCloud 使用您的配置
AV.init({
  appId: process.env.LEANCLOUD_APP_ID || '8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz',
  appKey: process.env.LEANCLOUD_APP_KEY || 'CMGwM4hzM3C2TXTfIYQVS6TM',
  masterKey: process.env.LEANCLOUD_APP_MASTER_KEY || 'EWL7AJTpwcTvRbfSsEj3rYmU',
  serverURL: process.env.LEANCLOUD_APP_SERVER_URL || 'https://8luz5iul.lc-cn-n1-shared.com'
});

// 使用 Master Key 提升权限
AV.Cloud.useMasterKey();

// SQL Server 2008R2 配置 - 根据您提供的信息
const SQL_CONFIG = {
  user: 'csfh',
  password: 'fh123456',
  server: 'csfhcdz.f3322.net',
  database: '特来电',
  port: 1433,
  options: {
    encrypt: false, // SQL Server 2008 通常不需要加密
    trustServerCertificate: true,
    enableArithAbort: true,
    instanceName: 'SQLEXPRESS' // 指定实例名
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  connectionTimeout: 30000,
  requestTimeout: 30000
};

// DeepSeek API 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-9a6e2beae112468dba3d212df48354f0';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// 中间件配置
app.use(AV.express());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// 静态文件服务（前端文件）
app.use(express.static('public'));

// 跨域支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-LC-Id, X-LC-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    leancloud: {
      appId: AV.applicationId,
      environment: process.env.LEANCLOUD_APP_ENV || 'development'
    },
    database: {
      connected: false,
      server: SQL_CONFIG.server
    }
  });
});

// 测试连接云函数
AV.Cloud.define('testConnection', async (request) => {
  console.log('测试连接请求');
  
  return {
    success: true,
    timestamp: new Date().toISOString(),
    leancloud: '连接正常',
    deepseek: '配置就绪',
    sqlServer: {
      server: SQL_CONFIG.server,
      database: SQL_CONFIG.database,
      status: '配置就绪'
    }
  };
});

// 主查询数据库云函数
AV.Cloud.define('queryDatabase', async (request) => {
  try {
    const { query, sqlConfig = SQL_CONFIG } = request.params;
    console.log('收到数据库查询请求:', query);
    
    // 记录请求日志
    AV.Cloud.saveLog('数据库查询请求', {
      query: query,
      timestamp: new Date().toISOString(),
      userAgent: request.headers['user-agent']
    });
    
    // 解析用户查询意图
    const { sqlQuery, params, queryType } = parseUserQuery(query);
    console.log('生成的SQL:', sqlQuery);
    
    let pool;
    try {
      // 连接数据库
      console.log('正在连接SQL Server数据库...');
      pool = await sql.connect(sqlConfig);
      console.log('数据库连接成功');
      
      // 准备查询请求
      const sqlRequest = pool.request();
      
      // 添加参数
      if (params) {
        Object.keys(params).forEach(key => {
          sqlRequest.input(key, params[key]);
        });
      }
      
      // 执行查询
      console.log('执行SQL查询...');
      const result = await sqlRequest.query(sqlQuery);
      console.log(`查询成功，返回 ${result.recordset.length} 条记录`);
      
      // 格式化结果
      const formattedResult = formatQueryResult(result.recordset, query, queryType);
      
      // 记录成功日志
      AV.Cloud.saveLog('数据库查询成功', {
        query: query,
        recordCount: result.recordset.length,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        result: formattedResult,
        queryType: queryType,
        recordCount: result.recordset.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (dbError) {
      console.error('数据库错误:', dbError);
      
      // 记录错误日志
      AV.Cloud.saveLog('数据库查询错误', {
        query: query,
        error: dbError.message,
        timestamp: new Date().toISOString()
      });
      
      // 如果数据库查询失败，尝试使用 AI 回答
      try {
        const aiResponse = await callDeepSeekAI(query);
        return {
          success: false,
          message: '数据库查询失败，已使用AI回答',
          response: aiResponse,
          error: dbError.message,
          timestamp: new Date().toISOString()
        };
      } catch (aiError) {
        throw new AV.Cloud.Error(`数据库查询失败，且AI服务不可用: ${dbError.message}`);
      }
    } finally {
      if (pool) {
        try {
          await pool.close();
          console.log('数据库连接已关闭');
        } catch (closeError) {
          console.error('关闭数据库连接时出错:', closeError);
        }
      }
    }
    
  } catch (error) {
    console.error('查询处理错误:', error);
    throw new AV.Cloud.Error(`查询处理失败: ${error.message}`);
  }
});

// 调用 DeepSeek AI 云函数
AV.Cloud.define('callDeepSeek', async (request) => {
  try {
    const { message, apiKey = DEEPSEEK_API_KEY, context = [] } = request.params;
    console.log('收到AI请求:', message.substring(0, 100));
    
    // 记录请求日志
    AV.Cloud.saveLog('AI请求', {
      messageLength: message.length,
      timestamp: new Date().toISOString()
    });
    
    const response = await callDeepSeekAI(message, apiKey, context);
    
    // 记录成功日志
    AV.Cloud.saveLog('AI响应成功', {
      messageLength: message.length,
      responseLength: response.length,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      response: response,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('AI调用错误:', error);
    
    // 记录错误日志
    AV.Cloud.saveLog('AI响应错误', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    throw new AV.Cloud.Error(`AI服务调用失败: ${error.message}`);
  }
});

// 数据库表结构查询云函数
AV.Cloud.define('getTableInfo', async (request) => {
  try {
    const pool = await sql.connect(SQL_CONFIG);
    
    const result = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '特来电'
      ORDER BY ORDINAL_POSITION
    `);
    
    await pool.close();
    
    return {
      success: true,
      tableName: '特来电',
      columns: result.recordset,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('获取表信息错误:', error);
    throw new AV.Cloud.Error(`获取表信息失败: ${error.message}`);
  }
});

// 解析用户查询，生成 SQL
function parseUserQuery(userQuery) {
  const lowerQuery = userQuery.toLowerCase().trim();
  
  // 检测查询类型
  if (containsAny(lowerQuery, ['充电电量', '电量'])) {
    return handleChargeQuery(userQuery, lowerQuery);
  } else if (containsAny(lowerQuery, ['充电电费', '充电费用', '费用', '电费', '服务费'])) {
    return handleCostQuery(userQuery, lowerQuery);
  } else if (containsAny(lowerQuery, ['车牌', '车牌号'])) {
    return handleVehicleQuery(userQuery, lowerQuery);
  } else if (containsAny(lowerQuery, ['电站', '充电站', '站点', '站名'])) {
    return handleStationQuery(userQuery, lowerQuery);
  } else if (containsAny(lowerQuery, ['时间', '日期', '何时', '什么时候', '今天', '昨天', '本月'])) {
    return handleTimeQuery(userQuery, lowerQuery);
  } else if (containsAny(lowerQuery, ['统计', '总计', '总数', '合计', '总和'])) {
    return handleStatisticsQuery(userQuery, lowerQuery);
  } else if (containsAny(lowerQuery, ['最近', '最新', '近期的', '最近的'])) {
    return handleRecentQuery(userQuery, lowerQuery);
  } else {
    // 默认查询最近记录
    return {
      sqlQuery: `SELECT TOP 10 
                 [充电电量(度)], 
                 [充电电费(元)], 
                 [充电服务费(元)],
                 [充电费用(元)], 
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间],
                 [判定车牌号], 
                 [电站名称], 
                 [终端名称]
                 FROM [特来电]
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '默认查询'
    };
  }
}

// 辅助函数：检查字符串是否包含任意关键词
function containsAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

// 充电电量查询处理
function handleChargeQuery(originalQuery, lowerQuery) {
  if (containsAny(lowerQuery, ['最高', '最多', '最大', 'top', '前'])) {
    return {
      sqlQuery: `SELECT TOP 5 
                 [电站名称], 
                 [判定车牌号], 
                 MAX([充电电量(度)]) as 最大充电电量,
                 CONVERT(varchar, MAX([充电结束时间]), 120) as 最近充电时间
                 FROM [特来电]
                 WHERE [充电电量(度)] IS NOT NULL
                 GROUP BY [电站名称], [判定车牌号]
                 ORDER BY 最大充电电量 DESC`,
      params: {},
      queryType: '最大充电电量查询'
    };
  } else if (containsAny(lowerQuery, ['最低', '最少', '最小'])) {
    return {
      sqlQuery: `SELECT TOP 5 
                 [电站名称], 
                 [判定车牌号], 
                 MIN([充电电量(度)]) as 最小充电电量,
                 CONVERT(varchar, MIN([充电结束时间]), 120) as 最早充电时间
                 FROM [特来电]
                 WHERE [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
                 GROUP BY [电站名称], [判定车牌号]
                 ORDER BY 最小充电电量 ASC`,
      params: {},
      queryType: '最小充电电量查询'
    };
  } else if (containsAny(lowerQuery, ['平均', '均值'])) {
    return {
      sqlQuery: `SELECT 
                 AVG(CAST([充电电量(度)] as float)) as 平均充电电量,
                 COUNT(*) as 记录总数
                 FROM [特来电]
                 WHERE [充电电量(度)] IS NOT NULL`,
      params: {},
      queryType: '平均充电电量查询'
    };
  } else if (containsAny(lowerQuery, ['总计', '总和', '合计', '总量'])) {
    return {
      sqlQuery: `SELECT 
                 SUM([充电电量(度)]) as 总充电电量,
                 COUNT(*) as 充电次数,
                 AVG([充电电量(度)]) as 平均充电电量
                 FROM [特来电]
                 WHERE [充电电量(度)] IS NOT NULL`,
      params: {},
      queryType: '充电电量统计'
    };
  } else {
    // 默认查询最近电量记录
    return {
      sqlQuery: `SELECT TOP 15 
                 [充电电量(度)], 
                 [充电电费(元)], 
                 [充电服务费(元)],
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间], 
                 [判定车牌号], 
                 [电站名称]
                 FROM [特来电]
                 WHERE [充电电量(度)] IS NOT NULL
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '充电电量查询'
    };
  }
}

// 费用查询处理
function handleCostQuery(originalQuery, lowerQuery) {
  if (containsAny(lowerQuery, ['最高', '最贵', '最多'])) {
    return {
      sqlQuery: `SELECT TOP 5 
                 [电站名称], 
                 [判定车牌号], 
                 MAX([充电费用(元)]) as 最高费用,
                 CONVERT(varchar, MAX([充电结束时间]), 120) as 最近充电时间
                 FROM [特来电]
                 WHERE [充电费用(元)] IS NOT NULL
                 GROUP BY [电站名称], [判定车牌号]
                 ORDER BY 最高费用 DESC`,
      params: {},
      queryType: '最高费用查询'
    };
  } else if (containsAny(lowerQuery, ['平均'])) {
    return {
      sqlQuery: `SELECT 
                 AVG(CAST([充电费用(元)] as float)) as 平均总费用,
                 AVG(CAST([充电电费(元)] as float)) as 平均电费,
                 AVG(CAST([充电服务费(元)] as float)) as 平均服务费
                 FROM [特来电]
                 WHERE [充电费用(元)] IS NOT NULL`,
      params: {},
      queryType: '平均费用查询'
    };
  } else if (containsAny(lowerQuery, ['总计', '总和', '合计', '总额'])) {
    return {
      sqlQuery: `SELECT 
                 SUM([充电费用(元)]) as 总充电费用,
                 SUM([充电电费(元)]) as 总电费,
                 SUM([充电服务费(元)]) as 总服务费
                 FROM [特来电]
                 WHERE [充电费用(元)] IS NOT NULL`,
      params: {},
      queryType: '费用总计查询'
    };
  } else {
    return {
      sqlQuery: `SELECT TOP 15 
                 [充电费用(元)], 
                 [充电电费(元)], 
                 [充电服务费(元)],
                 [充电电量(度)], 
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间], 
                 [电站名称],
                 [判定车牌号]
                 FROM [特来电]
                 WHERE [充电费用(元)] IS NOT NULL
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '费用记录查询'
    };
  }
}

// 车牌查询处理
function handleVehicleQuery(originalQuery, lowerQuery) {
  // 尝试提取车牌号
  const plateRegex = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]/;
  const match = originalQuery.match(plateRegex);
  
  if (match) {
    const plateNumber = match[0];
    return {
      sqlQuery: `SELECT 
                 [充电电量(度)], 
                 [充电费用(元)], 
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间], 
                 [电站名称], 
                 [终端名称]
                 FROM [特来电]
                 WHERE [判定车牌号] LIKE '%' + @plateNumber + '%'
                 ORDER BY [充电结束时间] DESC`,
      params: { plateNumber: plateNumber },
      queryType: '车牌号详细查询'
    };
  } else if (containsAny(lowerQuery, ['所有', '全部', '列表'])) {
    return {
      sqlQuery: `SELECT DISTINCT TOP 20 [判定车牌号], 
                 COUNT(*) as 充电次数,
                 SUM([充电电量(度)]) as 总充电电量,
                 SUM([充电费用(元)]) as 总充电费用
                 FROM [特来电]
                 WHERE [判定车牌号] IS NOT NULL
                 GROUP BY [判定车牌号]
                 ORDER BY 充电次数 DESC`,
      params: {},
      queryType: '所有车牌统计'
    };
  } else {
    return {
      sqlQuery: `SELECT DISTINCT TOP 10 [判定车牌号], 
                 COUNT(*) as 充电次数,
                 SUM([充电电量(度)]) as 总充电电量
                 FROM [特来电]
                 WHERE [判定车牌号] IS NOT NULL
                 GROUP BY [判定车牌号]
                 ORDER BY 充电次数 DESC`,
      params: {},
      queryType: '车牌号统计'
    };
  }
}

// 电站查询处理
function handleStationQuery(originalQuery, lowerQuery) {
  // 尝试提取电站名称关键词
  const stationKeywords = ['电站', '充电站', '站'];
  let stationName = '';
  
  for (const keyword of stationKeywords) {
    const index = lowerQuery.indexOf(keyword);
    if (index !== -1 && index > 0) {
      const beforeKeyword = originalQuery.substring(0, index).trim();
      const words = beforeKeyword.split(' ');
      if (words.length > 0) {
        stationName = words[words.length - 1];
        break;
      }
    }
  }
  
  if (stationName && stationName.length > 1) {
    return {
      sqlQuery: `SELECT 
                 [充电电量(度)], 
                 [充电费用(元)], 
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间],
                 [判定车牌号], 
                 [终端名称]
                 FROM [特来电]
                 WHERE [电站名称] LIKE '%' + @stationName + '%'
                 ORDER BY [充电结束时间] DESC`,
      params: { stationName: stationName },
      queryType: '电站名称查询'
    };
  } else if (containsAny(lowerQuery, ['所有', '全部', '列表'])) {
    return {
      sqlQuery: `SELECT DISTINCT [电站名称], 
                 COUNT(*) as 充电次数,
                 SUM([充电电量(度)]) as 总充电电量,
                 AVG([充电费用(元)]) as 平均费用
                 FROM [特来电]
                 WHERE [电站名称] IS NOT NULL
                 GROUP BY [电站名称]
                 ORDER BY 充电次数 DESC`,
      params: {},
      queryType: '所有电站统计'
    };
  } else {
    return {
      sqlQuery: `SELECT DISTINCT TOP 10 [电站名称], 
                 COUNT(*) as 充电次数,
                 SUM([充电电量(度)]) as 总充电电量
                 FROM [特来电]
                 WHERE [电站名称] IS NOT NULL
                 GROUP BY [电站名称]
                 ORDER BY 充电次数 DESC`,
      params: {},
      queryType: '热门电站查询'
    };
  }
}

// 时间查询处理
function handleTimeQuery(originalQuery, lowerQuery) {
  if (containsAny(lowerQuery, ['今天'])) {
    return {
      sqlQuery: `SELECT 
                 [充电电量(度)], 
                 [充电费用(元)], 
                 [电站名称], 
                 [判定车牌号],
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间]
                 FROM [特来电]
                 WHERE CONVERT(date, [充电结束时间]) = CONVERT(date, GETDATE())
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '今天充电记录'
    };
  } else if (containsAny(lowerQuery, ['昨天'])) {
    return {
      sqlQuery: `SELECT 
                 [充电电量(度)], 
                 [充电费用(元)], 
                 [电站名称], 
                 [判定车牌号],
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间]
                 FROM [特来电]
                 WHERE CONVERT(date, [充电结束时间]) = CONVERT(date, DATEADD(day, -1, GETDATE()))
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '昨天充电记录'
    };
  } else if (containsAny(lowerQuery, ['本月'])) {
    return {
      sqlQuery: `SELECT 
                 [充电电量(度)], 
                 [充电费用(元)], 
                 [电站名称], 
                 [判定车牌号],
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间]
                 FROM [特来电]
                 WHERE MONTH([充电结束时间]) = MONTH(GETDATE())
                   AND YEAR([充电结束时间]) = YEAR(GETDATE())
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '本月充电记录'
    };
  } else if (containsAny(lowerQuery, ['今年'])) {
    return {
      sqlQuery: `SELECT 
                 MONTH([充电结束时间]) as 月份,
                 COUNT(*) as 充电次数,
                 SUM([充电电量(度)]) as 月充电电量,
                 SUM([充电费用(元)]) as 月充电费用
                 FROM [特来电]
                 WHERE YEAR([充电结束时间]) = YEAR(GETDATE())
                 GROUP BY MONTH([充电结束时间])
                 ORDER BY 月份`,
      params: {},
      queryType: '今年月度统计'
    };
  } else {
    return {
      sqlQuery: `SELECT TOP 10 
                 CONVERT(varchar, [充电结束时间], 120) as [充电结束时间], 
                 [充电电量(度)], 
                 [充电费用(元)],
                 [电站名称], 
                 [判定车牌号]
                 FROM [特来电]
                 ORDER BY [充电结束时间] DESC`,
      params: {},
      queryType: '最近时间记录'
    };
  }
}

// 统计查询处理
function handleStatisticsQuery(originalQuery, lowerQuery) {
  if (containsAny(lowerQuery, ['电量'])) {
    return {
      sqlQuery: `SELECT 
                 COUNT(*) as 总记录数,
                 SUM([充电电量(度)]) as 总充电电量,
                 AVG([充电电量(度)]) as 平均充电电量,
                 MIN([充电电量(度)]) as 最小充电电量,
                 MAX([充电电量(度)]) as 最大充电电量
                 FROM [特来电]
                 WHERE [充电电量(度)] IS NOT NULL`,
      params: {},
      queryType: '电量统计'
    };
  } else if (containsAny(lowerQuery, ['费用'])) {
    return {
      sqlQuery: `SELECT 
                 SUM([充电费用(元)]) as 总充电费用,
                 SUM([充电电费(元)]) as 总电费,
                 SUM([充电服务费(元)]) as 总服务费,
                 AVG([充电费用(元)]) as 平均充电费用
                 FROM [特来电]
                 WHERE [充电费用(元)] IS NOT NULL`,
      params: {},
      queryType: '费用统计'
    };
  } else {
    return {
      sqlQuery: `SELECT 
                 COUNT(*) as 总充电记录数,
                 COUNT(DISTINCT [判定车牌号]) as 总车辆数,
                 COUNT(DISTINCT [电站名称]) as 总电站数,
                 SUM([充电电量(度)]) as 总充电电量,
                 SUM([充电费用(元)]) as 总充电费用
                 FROM [特来电]`,
      params: {},
      queryType: '总体统计'
    };
  }
}

// 最近记录查询处理
function handleRecentQuery(originalQuery, lowerQuery) {
  let limit = 10;
  
  // 尝试提取数量
  const numMatch = lowerQuery.match(/(\d+)/);
  if (numMatch) {
    limit = parseInt(numMatch[1]);
    if (limit > 50) limit = 50; // 限制最大返回50条
  }
  
  return {
    sqlQuery: `SELECT TOP ${limit} 
               CONVERT(varchar, [充电结束时间], 120) as [充电结束时间],
               [充电电量(度)], 
               [充电费用(元)], 
               [充电电费(元)],
               [充电服务费(元)],
               [判定车牌号], 
               [电站名称], 
               [终端名称]
               FROM [特来电]
               ORDER BY [充电结束时间] DESC`,
    params: {},
    queryType: '最近记录查询'
  };
}

// 格式化查询结果
function formatQueryResult(records, originalQuery, queryType) {
  if (!records || records.length === 0) {
    return "未找到相关数据。\n\n您可以尝试：\n1. 检查查询条件是否正确\n2. 查询其他时间段的数据\n3. 使用更广泛的关键词";
  }
  
  let result = `📊 **${queryType} 结果**\n\n`;
  
  // 根据记录数量和类型选择显示方式
  if (records.length <= 8) {
    // 显示详细数据
    result += `共找到 ${records.length} 条记录：\n\n`;
    
    records.forEach((record, index) => {
      result += `**记录 ${index + 1}**\n`;
      result += "```\n";
      
      // 根据字段存在性显示信息
      if (record['充电电量(度)'] !== undefined) {
        result += `  充电电量: ${formatNumber(record['充电电量(度)'])} 度\n`;
      }
      if (record['充电费用(元)'] !== undefined) {
        result += `  充电费用: ${formatNumber(record['充电费用(元)'])} 元\n`;
      }
      if (record['充电电费(元)'] !== undefined) {
        result += `  电费: ${formatNumber(record['充电电费(元)'])} 元\n`;
      }
      if (record['充电服务费(元)'] !== undefined) {
        result += `  服务费: ${formatNumber(record['充电服务费(元)'])} 元\n`;
      }
      if (record['充电结束时间'] !== undefined) {
        result += `  充电时间: ${record['充电结束时间']}\n`;
      }
      if (record['判定车牌号'] !== undefined) {
        result += `  车牌号: ${record['判定车牌号']}\n`;
      }
      if (record['电站名称'] !== undefined) {
        result += `  电站名称: ${record['电站名称']}\n`;
      }
      if (record['终端名称'] !== undefined) {
        result += `  终端名称: ${record['终端名称']}\n`;
      }
      
      // 处理统计字段
      const statFields = ['总充电电量', '总充电费用', '充电次数', '平均充电电量', 
                         '最大充电电量', '最小充电电量', '总电费', '总服务费',
                         '月充电电量', '月充电费用'];
      
      statFields.forEach(field => {
        if (record[field] !== undefined) {
          result += `  ${field}: ${formatNumber(record[field])}\n`;
        }
      });
      
      result += "```\n\n";
    });
  } else {
    // 显示汇总信息和表格
    result += `共找到 ${records.length} 条记录\n\n`;
    
    // 计算总计（如果适用）
    const totalCharge = records.reduce((sum, record) => 
      sum + (parseFloat(record['充电电量(度)']) || 0), 0);
    const totalCost = records.reduce((sum, record) => 
      sum + (parseFloat(record['充电费用(元)']) || 0), 0);
    const totalElectricCost = records.reduce((sum, record) => 
      sum + (parseFloat(record['充电电费(元)']) || 0), 0);
    const totalServiceCost = records.reduce((sum, record) => 
      sum + (parseFloat(record['充电服务费(元)']) || 0), 0);
    
    // 显示统计信息
    if (totalCharge > 0 || totalCost > 0) {
      result += "**📈 统计摘要**\n";
      result += "```\n";
      if (totalCharge > 0) result += `总充电电量: ${formatNumber(totalCharge)} 度\n`;
      if (totalCost > 0) result += `总充电费用: ${formatNumber(totalCost)} 元\n`;
      if (totalElectricCost > 0) result += `总电费: ${formatNumber(totalElectricCost)} 元\n`;
      if (totalServiceCost > 0) result += `总服务费: ${formatNumber(totalServiceCost)} 元\n`;
      
      if (totalCharge > 0 && totalCost > 0) {
        result += `平均单价: ${(totalCost / totalCharge).toFixed(2)} 元/度\n`;
      }
      result += "```\n\n";
    }
    
    // 显示表格格式的前8条记录
    result += "**最近记录预览**\n";
    result += "```\n";
    result += "序号 | 电量(度) | 费用(元) | 车牌号 | 电站名称\n";
    result += "-----|----------|----------|--------|----------\n";
    
    records.slice(0, 8).forEach((record, index) => {
      const charge = record['充电电量(度)'] ? formatNumber(record['充电电量(度)'], 1) : '-';
      const cost = record['充电费用(元)'] ? formatNumber(record['充电费用(元)'], 1) : '-';
      const plate = record['判定车牌号'] || '-';
      const station = record['电站名称'] || '-';
      
      result += `${(index + 1).toString().padEnd(4)} | ${charge.padStart(8)} | ${cost.padStart(8)} | ${plate.padEnd(6)} | ${station}\n`;
    });
    
    if (records.length > 8) {
      result += `... 还有 ${records.length - 8} 条记录未显示\n`;
    }
    result += "```\n";
  }
  
  // 添加分析建议（如果查询包含分析关键词）
  if (originalQuery.toLowerCase().includes('分析') || 
      originalQuery.includes('建议') || 
      originalQuery.includes('如何')) {
    result += "\n**💡 分析建议**\n";
    
    if (records.length > 0) {
      const avgCharge = totalCharge / records.length;
      const avgCost = totalCost / records.length;
      
      result += "```\n";
      result += `平均每次充电: ${formatNumber(avgCharge, 2)} 度\n`;
      result += `平均每次费用: ${formatNumber(avgCost, 2)} 元\n`;
      
      if (avgCharge > 0) {
        const unitPrice = avgCost / avgCharge;
        result += `平均单价: ${unitPrice.toFixed(2)} 元/度\n`;
        
        // 根据单价给出建议
        if (unitPrice > 1.5) {
          result += "建议: 当前单价较高，建议选择谷时充电或更换充电站\n";
        } else if (unitPrice < 1.0) {
          result += "状态: 当前单价较为合理\n";
        }
      }
      
      if (totalServiceCost > 0 && totalElectricCost > 0) {
        const serviceRatio = totalServiceCost / totalCost * 100;
        result += `服务费占比: ${serviceRatio.toFixed(1)}%\n`;
      }
      
      result += "```";
    }
  }
  
  return result;
}

// 格式化数字
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined) return '-';
  const n = parseFloat(num);
  if (isNaN(n)) return '-';
  return n.toFixed(decimals);
}

// 调用 DeepSeek AI
async function callDeepSeekAI(message, apiKey = DEEPSEEK_API_KEY, context = []) {
  try {
    // 构建消息历史
    const messages = [
      {
        role: "system",
        content: `你是特来电充电数据分析专家，帮助用户分析充电数据并提供建议。
        
        你了解以下数据库字段：
        1. 充电电量(度) - 每次充电的电量
        2. 充电电费(元) - 电费部分
        3. 充电服务费(元) - 服务费部分
        4. 充电费用(元) - 总费用
        5. 充电结束时间 - 充电完成时间
        6. 判定车牌号 - 车辆车牌号
        7. 电站名称 - 充电站名称
        8. 终端名称 - 充电终端名称
        
        当用户询问充电相关数据时，如果问题中包含上述字段关键词，你应该建议用户使用更具体的查询语句来触发数据库查询。
        例如：当用户问"充电费用高吗？"，你可以回答"我可以帮您查询具体的充电费用数据，请尝试输入'查询充电费用统计'或'分析充电费用分布'。"
        
        你的回答应该专业、清晰、有帮助。`
      }
    ];
    
    // 添加上下文
    if (context && context.length > 0) {
      context.slice(-3).forEach(item => {
        if (item.role && item.content) {
          messages.push({
            role: item.role,
            content: item.content
          });
        }
      });
    }
    
    // 添加当前消息
    messages.push({
      role: "user",
      content: message
    });
    
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: "deepseek-chat",
        messages: messages,
        max_tokens: 2000,
        temperature: 0.7,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000
      }
    );
    
    return response.data.choices[0].message.content;
    
  } catch (error) {
    console.error('DeepSeek API 调用失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
      
      if (error.response.status === 401) {
        throw new Error('DeepSeek API 密钥无效或已过期');
      } else if (error.response.status === 429) {
        throw new Error('API 调用次数超限，请稍后重试');
      } else if (error.response.status === 500) {
        throw new Error('DeepSeek 服务器内部错误');
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('API 请求超时，请检查网络连接');
    } else if (error.code === 'ENOTFOUND') {
      throw new Error('无法连接到 API 服务器，请检查网络');
    }
    
    throw new Error(`AI 服务调用失败: ${error.message}`);
  }
}

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('全局错误:', err.stack);
  
  const statusCode = err.status || 500;
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? '服务器内部错误，请稍后重试' 
    : err.message;
  
  res.status(statusCode).json({
    error: '服务器内部错误',
    message: errorMessage,
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    error: '未找到资源',
    message: `请求的路径 ${req.path} 不存在`,
    timestamp: new Date().toISOString()
  });
});

// 获取端口
const PORT = parseInt(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000);

// 启动服务器
if (process.env.LEANCLOUD_APP_ENV === 'development') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务器运行在: http://0.0.0.0:${PORT}`);
    console.log(`📊 健康检查: http://0.0.0.0:${PORT}/health`);
    console.log(`🔧 数据库配置: ${SQL_CONFIG.server}:${SQL_CONFIG.port}/${SQL_CONFIG.database}`);
    console.log(`🤖 DeepSeek API: 已配置`);
    console.log(`☁️ LeanCloud: ${AV.applicationId}`);
  });
}

module.exports = app;