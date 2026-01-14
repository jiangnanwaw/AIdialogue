// Vercel Serverless Function - 替代 LeanCloud chatWithAI 云函数
import sql from 'mssql';
import axios from 'axios';

// ========== 配置 ==========
const DEBUG_MODE = true;

function debugLog(message, data = null) {
    if (DEBUG_MODE) {
        console.log(`[DEBUG] ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// 数据库配置
const dbConfig = {
    user: process.env.DB_USER || 'csfh',
    password: process.env.DB_PASSWORD || 'fh123456',
    server: process.env.DB_SERVER || 'csfhcdz.f3322.net',
    database: process.env.DB_DATABASE || 'chargingdata',
    port: 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    connectionTimeout: 30000,
    requestTimeout: 30000
};

// DeepSeek API配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-9a6e2beae112468dba3d212df48354f0';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const ENABLE_DEEPSEEK = true;
const ENABLE_DATABASE_QUERY = true;

// ========== 表配置 ==========
const TABLE_NAMES = {
    '特来电': '特来电',
    '能科': '能科',
    '滴滴': '滴滴',
    '车海洋洗车充值': '车海洋洗车充值',
    '车海洋洗车消费': '车海洋洗车消费',
    '车颜知己洗车': '车颜知己洗车',
    '电力局': '电力局',
    '红门缴费': '红门缴费',
    '快易洁洗车': '快易洁洗车',
    '赛菲姆道闸': '赛菲姆道闸',
    '收钱吧': '收钱吧',
    '兴元售货机': '兴元售货机',
    '微信商户下单': '微信商户下单',
    '微信收款商业版': '微信收款商业版',
    '月租车充值': '月租车充值',
    '智小盟': '智小盟',
    '超时占位费': '超时占位费',
    '活动优惠券': '活动优惠券'
};

const TABLE_FIELDS = {
    '特来电': {
        timeField: '充电结束时间',
        stationField: '电站名称',
        fields: {
            '充电电量': { column: '[充电电量(度)]', type: 'number' },
            '电量': { column: '[充电电量(度)]', type: 'number' },
            '充电服务费': { column: '[充电服务费(元)]', type: 'number' },
            '服务费': { column: '[充电服务费(元)]', type: 'number' },
            '充电费用': { column: '[充电费用(元)]', type: 'number' },
            '充电电费': { column: '[充电电费(元)]', type: 'number' },
            '电费': { column: '[充电电费(元)]', type: 'number' },
            '费用': { column: '[充电费用(元)]', type: 'number' },
            '金额': { column: '[充电费用(元)]', type: 'number' },
            '收入': { column: '[充电费用(元)]', type: 'number' },
            '充电时长': { column: 'CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT)', type: 'computed' },
            '时长': { column: 'CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT)', type: 'computed' },
            '订单数量': { column: '[订单编号]', type: 'count' },
            '订单数': { column: '[订单编号]', type: 'count' },
            '电站名称': { column: '[电站名称]', type: 'string' },
            '终端名称': { column: '[终端名称]', type: 'string' }
        }
    },
    '能科': {
        timeField: '结束日期时间',
        fields: {
            '充电电量': { column: '[充电量]', type: 'number' },
            '电量': { column: '[充电量]', type: 'number' },
            '充电服务费': { column: '[服务费]', type: 'number' },
            '服务费': { column: '[服务费]', type: 'number' },
            '充电费用': { column: '[消费金额]', type: 'number' },
            '充电电费': { column: '[电费]', type: 'number' },
            '电费': { column: '[电费]', type: 'number' },
            '费用': { column: '[消费金额]', type: 'number' },
            '金额': { column: '[消费金额]', type: 'number' },
            '收入': { column: '[消费金额]', type: 'number' },
            '充电时长': { column: 'DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))', type: 'computed' },
            '时长': { column: 'DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))', type: 'computed' }
        }
    },
    '滴滴': {
        timeField: '充电完成时间',
        stationField: '场站名称',
        fields: {
            '充电电量': { column: 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)', type: 'computed' },
            '电量': { column: 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)', type: 'computed' },
            '充电服务费': { column: 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)', type: 'computed' },
            '服务费': { column: 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)', type: 'computed' },
            '充电费用': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '充电电费': { column: 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)', type: 'computed' },
            '电费': { column: 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)', type: 'computed' },
            '费用': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '金额': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '收入': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '充电时长': { column: '[充电时长（分钟）]', type: 'number' },
            '时长': { column: '[充电时长（分钟）]', type: 'number' }
        }
    }
};

// 简化的洗车表配置
const WASHING_TABLES = ['车海洋洗车充值', '车海洋洗车消费', '车颜知己洗车', '快易洁洗车'];

// ========== 工具函数 ==========

function isDatabaseQuery(message) {
    const hasTableName = Object.keys(TABLE_NAMES).some(name => message.includes(name));
    const hasCharging = message.includes('充电');
    const hasWashing = message.includes('洗车');
    const hasParking = message.includes('停车');
    const hasRetail = message.includes('零售') || message.includes('售货');
    const hasRecharge = message.includes('充值');
    const hasPayment = message.includes('缴费');
    const hasWeixin = message.includes('微信');
    const hasComprehensive = (message.includes('综合业务收入') || message.includes('综合收入')) && !message.includes('充电');

    return hasTableName || hasCharging || hasWashing || hasParking || hasRetail ||
           hasRecharge || hasPayment || hasWeixin || hasComprehensive;
}

function extractTableNames(message) {
    const tables = [];
    const metadata = {};

    // 检查洗车关键词
    if (message.includes('洗车')) {
        const washingTables = WASHING_TABLES.filter(t => message.includes(t.replace('洗车', '').replace('充值', '').replace('消费', '')));
        if (washingTables.length > 0) {
            tables.push(...washingTables);
        } else {
            // 默认所有洗车表
            tables.push(...WASHING_TABLES);
        }
    }

    // 检查充电关键词
    if (message.includes('充电') || message.includes('特来电')) {
        if (!tables.includes('特来电')) tables.push('特来电');
        if (!tables.includes('能科') && message.includes('能科')) tables.push('能科');
        if (!tables.includes('滴滴') && message.includes('滴滴')) tables.push('滴滴');
    }

    // 检查其他表
    Object.keys(TABLE_NAMES).forEach(name => {
        if (message.includes(name) && !tables.includes(name)) {
            tables.push(name);
        }
    });

    return { tables, metadata };
}

function extractTimeInfo(message) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let startDate = null;
    let endDate = null;
    let hasTime = false;

    // 今年
    if (message.includes('今年')) {
        startDate = new Date(currentYear, 0, 1);
        endDate = new Date(currentYear, 11, 31, 23, 59, 59);
        hasTime = true;
    }
    // 去年
    else if (message.includes('去年')) {
        startDate = new Date(currentYear - 1, 0, 1);
        endDate = new Date(currentYear - 1, 11, 31, 23, 59, 59);
        hasTime = true;
    }
    // 本月
    else if (message.includes('本月')) {
        startDate = new Date(currentYear, currentMonth - 1, 1);
        endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);
        hasTime = true;
    }
    // 今天
    else if (message.includes('今天')) {
        startDate = new Date(currentYear, currentMonth - 1, now.getDate(), 0, 0, 0);
        endDate = new Date(currentYear, currentMonth - 1, now.getDate(), 23, 59, 59);
        hasTime = true;
    }

    return { startDate, endDate, hasTime, currentYear, currentMonth };
}

function createFriendlyErrorMessage(errorType, details = {}) {
    const messages = {
        NO_DATA_FOUND: '❓ 未查询到数据\n\n可能原因：\n• 查询时间范围内没有数据\n• 筛选条件过于严格\n• 指定的表名或地点不匹配',
        NO_TABLES_FOUND: '❓ 无法确定要查询的数据表\n\n请在问题中明确指定：\n• 表名（如：特来电、能科等）\n• 业务类型（如：充电、洗车、停车等）',
        SQL_EXECUTION_ERROR: `❌ 数据库查询出错\n\n错误信息：${details.errorMessage || '未知错误'}`,
        UNKNOWN_ERROR: `❌ 处理请求时发生未知错误\n\n错误信息：${details.errorMessage || '未知错误'}`
    };

    return messages[errorType] || messages.UNKNOWN_ERROR;
}

async function executeQuery(sqlQuery) {
    let pool;
    const QUERY_TIMEOUT = 25000; // Vercel 超时时间更长
    try {
        debugLog('开始连接数据库');
        pool = await sql.connect(dbConfig);
        debugLog('数据库连接成功');

        debugLog('执行SQL查询', sqlQuery);
        const request = pool.request();
        request.timeout = QUERY_TIMEOUT;
        const result = await request.query(sqlQuery);

        debugLog('查询结果数量', result.recordset.length);
        return result.recordset;
    } catch (error) {
        console.error('数据库查询失败:', error.message);
        throw new Error(`数据库查询失败: ${error.message}`);
    } finally {
        if (pool) {
            try {
                await pool.close();
            } catch (err) {
                console.error('关闭数据库连接时出错:', err);
            }
        }
    }
}

function formatQueryResult(data) {
    if (!data || data.length === 0) {
        return '未找到相关数据。';
    }

    let result = '\n';

    // 表头
    const headers = Object.keys(data[0]);
    result += '| ' + headers.join(' | ') + ' |\n';
    result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

    // 数据行
    data.forEach(row => {
        result += '| ' + headers.map(h => {
            let val = row[h];
            if (val === null || val === undefined) val = '';
            if (val instanceof Date) {
                val = val.toISOString().replace('T', ' ').substring(0, 19);
            }
            return String(val);
        }).join(' | ') + ' |\n';
    });

    if (data.length > 20) {
        result += `\n... 还有 ${data.length - 20} 条记录`;
    }

    return result;
}

async function askDeepSeek(message) {
    if (!ENABLE_DEEPSEEK) {
        return '通用AI问答功能暂时关闭。请询问数据库相关问题。';
    }

    try {
        const systemPrompt = '你是一个友好、专业的AI助手，请用简洁准确的语言回答用户的问题。';
        const requestData = {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            temperature: 0.7,
            max_tokens: 800,
            stream: false
        };

        const response = await axios.post(
            DEEPSEEK_API_URL,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 25000
            }
        );

        if (response.status !== 200 || !response.data?.choices?.[0]) {
            throw new Error('DeepSeek API 返回错误');
        }

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('DeepSeek API调用失败:', error.message);
        return '抱歉，AI服务暂时不可用。';
    }
}

// 简化的 SQL 生成（基于关键词）
function generateSimpleSQL(message, tables, timeInfo) {
    const table = tables[0];
    const config = TABLE_FIELDS[table];

    if (!config) {
        throw new Error(`未找到表 ${table} 的配置`);
    }

    const timeField = config.timeField || '充电结束时间';
    const incomeField = config.fields['充电电量'] || config.fields['收入'] || config.fields['金额'];

    let sql = `SELECT ${incomeField.column} as value`;

    if (config.stationField) {
        sql += `, ${config.stationField} as station`;
    }

    sql += ` FROM [${table}]`;

    // 添加时间条件
    if (timeInfo.hasTime && timeInfo.startDate && timeInfo.endDate) {
        sql += ` WHERE [${timeField}] >= '${timeInfo.startDate.toISOString()}' AND [${timeField}] <= '${timeInfo.endDate.toISOString()}'`;
    }

    sql += ` ORDER BY [${timeField}] DESC`;

    return sql;
}

async function analyzeQuestionWithAI(message, tables, metadata) {
    // 简化版本：直接生成 SQL
    const timeInfo = extractTimeInfo(message);
    return generateSimpleSQL(message, tables, timeInfo);
}

function sanitizeSQLQuery(sqlQuery, message = '') {
    // 移除可能危险的关键词
    return sqlQuery
        .replace(/DROP\s+TABLE/i, '')
        .replace(/DELETE\s+FROM/i, '')
        .replace(/TRUNCATE/i, '');
}

async function checkTimeRangeWithWarning(timeInfo, tableName) {
    // 简化版本：不检查时间范围
    return null;
}

async function getTableTimeRanges() {
    return {};
}

async function saveConversationLog(logData) {
    // Vercel 版本暂不保存日志
    return null;
}

// ========== 主处理函数 ==========

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const startTime = Date.now();

    try {
        const { message, sessionId } = req.body;

        debugLog('收到请求', { message, sessionId });

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: '消息内容不能为空' });
        }

        const isDbQuery = isDatabaseQuery(message);
        debugLog('问题类型', { isDbQuery });

        if (isDbQuery && ENABLE_DATABASE_QUERY) {
            const { tables, metadata } = extractTableNames(message);
            debugLog('提取的表', { tables });

            if (tables.length === 0) {
                return res.status(200).json({
                    reply: createFriendlyErrorMessage('NO_TABLES_FOUND'),
                    processingTime: Date.now() - startTime
                });
            }

            try {
                const sqlQuery = await analyzeQuestionWithAI(message, tables, metadata);
                const sanitizedQuery = sanitizeSQLQuery(sqlQuery, message);
                const queryResult = await executeQuery(sanitizedQuery);

                const processingTime = Date.now() - startTime;

                if (!queryResult || queryResult.length === 0) {
                    return res.status(200).json({
                        reply: createFriendlyErrorMessage('NO_DATA_FOUND'),
                        processingTime: processingTime,
                        rawData: queryResult,
                        hasData: false
                    });
                }

                const formattedResult = formatQueryResult(queryResult);

                return res.status(200).json({
                    reply: `查询结果：${formattedResult}`,
                    processingTime: processingTime,
                    method: 'Vercel Serverless',
                    rawData: queryResult,
                    hasData: true
                });
            } catch (error) {
                debugLog('查询错误', error.message);
                return res.status(200).json({
                    reply: createFriendlyErrorMessage('SQL_EXECUTION_ERROR', { errorMessage: error.message }),
                    processingTime: Date.now() - startTime
                });
            }
        } else {
            // 通用问答
            const aiResponse = await askDeepSeek(message);
            return res.status(200).json({
                reply: aiResponse,
                processingTime: Date.now() - startTime
            });
        }
    } catch (error) {
        console.error('处理请求时出错:', error);
        return res.status(200).json({
            reply: createFriendlyErrorMessage('UNKNOWN_ERROR', { errorMessage: error.message }),
            processingTime: Date.now() - startTime
        });
    }
}
