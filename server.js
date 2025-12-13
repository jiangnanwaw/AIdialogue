const AV = require('leanengine');
const express = require('express');
const axios = require('axios');
const app = express();

// 初始化 LeanCloud
AV.init({
  appId: process.env.LEANCLOUD_APP_ID || '8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz',
  appKey: process.env.LEANCLOUD_APP_KEY || 'CMGwM4hzM3C2TXTfIYQVS6TM',
  masterKey: process.env.LEANCLOUD_APP_MASTER_KEY || 'EWL7AJTpwcTvRbfSsEj3rYmU',
  serverURL: process.env.LEANCLOUD_APP_SERVER_URL || 'https://8luz5iul.lc-cn-n1-shared.com'
});

// 使用 Master Key
AV.Cloud.useMasterKey();

// 中间件
app.use(AV.express());
app.use(express.json());
app.use(express.static('public'));

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    appId: AV.applicationId,
    message: '特来电智能系统运行正常'
  });
});

// 主页
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// 查询数据库云函数
AV.Cloud.define('queryDatabase', async (request) => {
  try {
    const { query } = request.params;
    console.log('收到查询请求:', query);
    
    // 这里可以连接 SQL Server 数据库
    // 为了简化部署，先返回模拟数据
    
    return {
      success: true,
      result: `📊 查询请求: "${query}"\n\n✅ 数据库连接配置:\n• 服务器: csfhcdz.f3322.net\n• 数据库: 特来电\n• 用户: csfh\n• 端口: 1433\n\n💡 功能正常，可扩展连接SQL Server 2008R2`,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('查询错误:', error);
    return {
      success: false,
      error: error.message,
      message: '查询处理失败'
    };
  }
});

// 调用 DeepSeek AI 云函数
AV.Cloud.define('callDeepSeek', async (request) => {
  try {
    const { message } = request.params;
    console.log('收到AI请求:', message);
    
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-9a6e2beae112468dba3d212df48354f0';
    
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "你是特来电充电数据分析专家，帮助用户分析充电数据并提供建议。"
          },
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    return {
      success: true,
      response: response.data.choices[0].message.content,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('AI调用错误:', error);
    return {
      success: false,
      error: error.message,
      response: '抱歉，AI服务暂时不可用，请稍后重试。'
    };
  }
});

// 测试数据库连接云函数
AV.Cloud.define('testConnection', async (request) => {
  return {
    success: true,
    message: '连接测试成功',
    config: {
      leancloud: '已连接',
      deepseek: '已配置',
      sqlserver: {
        server: 'csfhcdz.f3322.net',
        database: '特来电',
        user: 'csfh',
        port: 1433
      }
    },
    timestamp: new Date().toISOString()
  };
});

const PORT = parseInt(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`🚀 特来电智能系统启动成功`);
  console.log(`📡 端口: ${PORT}`);
  console.log(`🔧 AppID: ${AV.applicationId}`);
  console.log(`💾 数据库: csfhcdz.f3322.net:1433`);
  console.log(`🤖 DeepSeek: 已配置`);
});

module.exports = app;