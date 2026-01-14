// 数据库配置和连接模块
const sql = require('mssql');

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

// 功能开关
const ENABLE_DEEPSEEK = true;
const ENABLE_DATABASE_QUERY = true;

// 调试模式
const DEBUG_MODE = true;

function debugLog(message, data = null) {
    if (DEBUG_MODE) {
        console.log(`[DEBUG] ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// 导出配置
module.exports = {
    sql,
    dbConfig,
    DEEPSEEK_API_KEY,
    DEEPSEEK_API_URL,
    ENABLE_DEEPSEEK,
    ENABLE_DATABASE_QUERY,
    DEBUG_MODE,
    debugLog
};
