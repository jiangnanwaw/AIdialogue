const AV = require('leanengine');
const axios = require('axios');
const sql = require('mssql');

// 启用详细日志
const DEBUG_MODE = true;

function debugLog(message, data = null) {
    if (DEBUG_MODE) {
        console.log(`[DEBUG] ${message}`);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// ========== 任务5：数据类型转换和校验工具函数 ==========

/**
 * 清理和转换数据值
 * @param {any} value - 原始值
 * @param {string} type - 期望的类型 ('number', 'string', 'boolean')
 * @returns {any} - 清理后的值
 */
function cleanDataValue(value, type = 'number') {
    if (value === null || value === undefined) {
        return null;
    }

    // 如果是字符串类型
    if (typeof value === 'string') {
        // 去除首尾空格
        value = value.trim();

        // 空字符串返回null
        if (value === '') {
            return null;
        }

        // 如果期望数字类型
        if (type === 'number') {
            // 移除千分位分隔符（逗号）
            value = value.replace(/,/g, '');

            // 检查是否为有效数字
            if (!isNaN(value) && value !== '') {
                return parseFloat(value);
            }
            return null;
        }

        // 如果期望布尔类型
        if (type === 'boolean') {
            if (value.toLowerCase() === 'true' || value === '1' || value === '是') {
                return true;
            }
            if (value.toLowerCase() === 'false' || value === '0' || value === '否') {
                return false;
            }
            return null;
        }

        // 默认返回字符串
        return value;
    }

    // 如果已经是数字类型
    if (typeof value === 'number') {
        if (type === 'number') {
            return value;
        }
        if (type === 'string') {
            return String(value);
        }
    }

    // 如果是布尔类型
    if (typeof value === 'boolean') {
        if (type === 'boolean') {
            return value;
        }
        if (type === 'string') {
            return value ? 'true' : 'false';
        }
        if (type === 'number') {
            return value ? 1 : 0;
        }
    }

    return value;
}

/**
 * 生成安全的字段转换SQL（用于nvarchar转float）
 * @param {string} columnName - 列名（带方括号）
 * @param {boolean} removeBrackets - 是否去除方括号（用于WHERE条件）
 * @returns {string} - 转换SQL片段
 */
function generateSafeCastSQL(columnName, removeBrackets = false) {
    const rawColumnName = removeBrackets ? columnName.replace(/^\[|\]$/g, '') : columnName;
    return `CAST(LTRIM(RTRIM(${columnName})) AS FLOAT)`;
}

/**
 * 生成安全的nvarchar字段WHERE条件
 * @param {string} columnName - 列名（带方括号）
 * @returns {string} - WHERE条件SQL片段
 */
function generateNvarcharWhereCondition(columnName) {
    const rawColumnName = columnName.replace(/^\[|\]$/g, '');
    return `${columnName} IS NOT NULL AND LTRIM(RTRIM(${columnName})) != '' AND ISNUMERIC(${rawColumnName}) = 1`;
}

// ========== 任务5工具函数结束 ==========

// ========== 任务6：错误处理和用户反馈函数 ==========

/**
 * 创建友好的错误消息
 * @param {string} errorType - 错误类型
 * @param {object} details - 错误详情
 * @returns {string} - 友好的错误消息
 */
function createFriendlyErrorMessage(errorType, details = {}) {
    const messages = {
        NO_DATA_FOUND: '❓ 未查询到数据\n\n可能原因：\n• 查询时间范围内没有数据\n• 筛选条件过于严格\n• 指定的表名或地点不匹配',
        TIME_RANGE_OUT_OF_BOUNDS: '⚠️ 查询时间超出数据范围\n\n{tableName}表的数据时间范围：{timeRange}\n您的查询时间：{queryTime}\n\n请调整查询时间后重试。',
        INVALID_KEYWORDS: '❓ 无法识别您的问题\n\n系统未检测到有效的查询关键词。\n\n支持的查询类型：\n• 充电数据（充电电量、充电费用等）\n• 洗车收入\n• 充电桩/售货机收入\n• 停车/充值/缴费\n• 综合业务收入\n\n您可以输入 /help 查看更多示例。',
        SQL_EXECUTION_ERROR: '❌ 数据库查询出错\n\n错误信息：{errorMessage}\n\n建议：\n• 尝试简化查询条件\n• 检查时间格式是否正确\n• 稍后重试',
        NO_TABLES_FOUND: '❓ 无法确定要查询的数据表\n\n请在问题中明确指定：\n• 表名（如：特来电、能科、兴元售货机等）\n• 业务类型（如：充电、洗车、停车等）\n• 或输入 /help 查看帮助',
        UNKNOWN_ERROR: '❌ 处理请求时发生未知错误\n\n错误信息：{errorMessage}\n\n请稍后重试或联系管理员。'
    };

    let message = messages[errorType] || messages.UNKNOWN_ERROR;

    // 替换消息中的占位符
    message = message.replace('{tableName}', details.tableName || '相关');
    message = message.replace('{timeRange}', details.timeRange || '未知');
    message = message.replace('{queryTime}', details.queryTime || '未知');
    message = message.replace('{errorMessage}', details.errorMessage || '未知错误');

    return message;
}

/**
 * 检查并创建时间范围警告
 * @param {object} timeInfo - 时间信息对象
 * @param {string} tableName - 表名
 * @returns {string|null} - 警告消息，如果没有问题返回null
 */
async function checkTimeRangeWithWarning(timeInfo, tableName) {
    if (!timeInfo || !timeInfo.hasTime || !tableName) {
        return null;
    }

    try {
        const timeRanges = await getTableTimeRanges();
        const tableRange = timeRanges[tableName];

        if (!tableRange || tableRange.error) {
            return null;
        }

        let warning = null;
        const queryStart = timeInfo.startDate;
        const queryEnd = timeInfo.endDate;

        // 简单检查：如果查询时间早于表数据开始时间或晚于表数据结束时间
        if (queryStart && tableRange.minTime && queryStart < tableRange.minTime.substring(0, 10)) {
            warning = createFriendlyErrorMessage('TIME_RANGE_OUT_OF_BOUNDS', {
                tableName: tableName,
                timeRange: tableRange.formatted,
                queryTime: `${queryStart} 至 ${queryEnd || '现在'}`
            });
        } else if (queryEnd && tableRange.maxTime) {
            const tableMaxDate = tableRange.maxTime.substring(0, 10);
            const queryEndDate = queryEnd.substring(0, 10);
            if (queryEndDate > tableMaxDate) {
                // 查询时间超出数据范围的结束时间（允许一定程度的预测查询）
                warning = createFriendlyErrorMessage('TIME_RANGE_OUT_OF_BOUNDS', {
                    tableName: tableName,
                    timeRange: tableRange.formatted,
                    queryTime: `${queryStart || '开始'} 至 ${queryEnd}`
                });
            }
        }

        return warning;
    } catch (error) {
        debugLog('检查时间范围时出错', error.message);
        return null;
    }
}

// ========== 任务6错误处理函数结束 ==========

// 数据库配置
const dbConfig = {
    user: 'csfh',
    password: 'fh123456',
    server: 'csfhcdz.f3322.net',
    database: 'chargingdata',
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
const DEEPSEEK_API_KEY = 'sk-9a6e2beae112468dba3d212df48354f0'; // ⚠️ 请更新为充值后的Key
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// 是否启用DeepSeek（通用问答）
// 注意：LeanCloud 免费版云函数超时为 15 秒，复杂问题可能超时
// 建议设置为 false，专注于数据库查询功能，设置为true，打开通用AI问答功能
const ENABLE_DEEPSEEK = true

// 是否启用数据库查询功能
// 设置为 false 可以关闭AI查询数据库功能，所有问题将走通用AI问答
// 设置为 true 时，系统会根据问题内容自动判断是否需要查询数据库
const ENABLE_DATABASE_QUERY = true

// 表名映射
const TABLE_NAMES = {
    '特来电': '特来电',
    '能科': '能科',
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
    '活动优惠券': '活动优惠券',
    '滴滴': '滴滴'
};

// 表字段配置
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
            // 充电时长字段存储为nvarchar，参与计算前先转换为FLOAT，避免类型错误
            '充电时长': { column: 'CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT)', type: 'computed' },
            '时长': { column: 'CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT)', type: 'computed' },
            '订单数量': { column: '[订单编号]', type: 'count' },
            '订单数': { column: '[订单编号]', type: 'count' },
            '车牌号': { column: '[判定车牌号]', type: 'string' },
            '电站名称': { column: '[电站名称]', type: 'string' },
            '终端名称': { column: '[终端名称]', type: 'string' },
            '枪': { column: '[终端名称]', type: 'terminal', needStation: true },
            '终端': { column: '[终端名称]', type: 'terminal', needStation: true }
        }
    },
    '能科': {
        timeField: '结束日期时间',
        fields: {
            '充电电量': { column: '[充电量]', type: 'number' },
            '电量': { column: '[充电量]', type: 'number' },
            // 服务费和消费金额字段为float类型
            '充电服务费': { column: '[服务费]', type: 'number' },
            '服务费': { column: '[服务费]', type: 'number' },
            '充电费用': { column: '[消费金额]', type: 'number' },
            '充电电费': { column: '[电费]', type: 'number' },
            '电费': { column: '[电费]', type: 'number' },
            '费用': { column: '[消费金额]', type: 'number' },
            '金额': { column: '[消费金额]', type: 'number' },
            '收入': { column: '[消费金额]', type: 'number' },
            '充电时长': { column: 'DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))', type: 'computed' },
            '时长': { column: 'DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))', type: 'computed' },
            '订单数量': { column: '[卡号]', type: 'count' },
            '订单数': { column: '[卡号]', type: 'count' },
            '充电桩名称': { column: '[充电桩名称]', type: 'string' },
            '车牌号': { column: '[车牌号]', type: 'string' },
            '车牌': { column: '[车牌号]', type: 'string' }
        }
    },
    '滴滴': {
        timeField: '充电完成时间',
        stationField: '场站名称',
        fields: {
            '充电电量': { column: 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)', type: 'computed' },
            '电量': { column: 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)', type: 'computed' },
            // 充电服务费和订单总额字段可能也是nvarchar类型，需要转换
            '充电服务费': { column: 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)', type: 'computed' },
            '服务费': { column: 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)', type: 'computed' },
            '充电费用': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '充电电费': { column: 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)', type: 'computed' },
            '电费': { column: 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)', type: 'computed' },
            '费用': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '金额': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '收入': { column: 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)', type: 'computed' },
            '充电时长': { column: '[充电时长（分钟）]', type: 'number' },
            '时长': { column: '[充电时长（分钟）]', type: 'number' },
            '场站名称': { column: '[场站名称]', type: 'string' },
            '充电枪ID': { column: '[充电枪ID]', type: 'string' },
            '枪': { column: '[充电枪ID]', type: 'terminal', needStation: true },
            '终端': { column: '[充电枪ID]', type: 'terminal', needStation: true },
            '车牌号': { column: '[车牌号]', type: 'string' },
            '车牌': { column: '[车牌号]', type: 'string' }
        }
    },
    '车海洋洗车充值': {
        timeField: '时间',
        fields: {
            '收入': { column: '[返还金额]', type: 'number' },
            '金额': { column: '[返还金额]', type: 'number' },
            '返还金额': { column: '[返还金额]', type: 'number' }
        }
    },
    '车海洋洗车消费': {
        timeField: '时间',
        fields: {
            '收入': { column: '[返还金额]', type: 'number' },
            '金额': { column: '[返还金额]', type: 'number' },
            '返还金额': { column: '[返还金额]', type: 'number' }
        }
    },
    '红门缴费': {
        timeField: '缴费时间',
        fields: {
            '收入': { column: '[交易金额]', type: 'number' },
            '金额': { column: '[交易金额]', type: 'number' },
            '交易金额': { column: '[交易金额]', type: 'number' },
            '缴费': { column: '[交易金额]', type: 'number' },
            '缴费金额': { column: '[交易金额]', type: 'number' },
            '车牌号': { column: '[收费车牌]', type: 'string' },
            '车牌': { column: '[收费车牌]', type: 'string' }
        }
    },
    '快易洁洗车': {
        timeField: '日期',
        fields: {
            '收入': { column: '[返还总额]', type: 'number' },
            '金额': { column: '[返还总额]', type: 'number' },
            '返还总额': { column: '[返还总额]', type: 'number' }
        }
    },
    '赛菲姆道闸': {
        timeField: '支付时间',
        paymentTypeField: '支付方式',
        fields: {
            '收入': { column: '[支付金额]', type: 'number' },
            '金额': { column: '[支付金额]', type: 'number' },
            '支付金额': { column: '[支付金额]', type: 'number' }
        }
    },
    '收钱吧': {
        timeField: '交易日期',
        statusField: '交易状态',
        fields: {
            '收入': { column: '[实收金额]', type: 'number' },
            '金额': { column: '[实收金额]', type: 'number' },
            '实收金额': { column: '[实收金额]', type: 'number' }
        }
    },
    '兴元售货机': {
        timeField: '支付时间',
        fields: {
            '收入': { column: '([支付金额] - ISNULL([退款金额], 0))', type: 'computed' },
            '金额': { column: '([支付金额] - ISNULL([退款金额], 0))', type: 'computed' }
        }
    },
    '微信商户下单': {
        timeField: '交易时间',
        fields: {
            '收入': { column: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', type: 'computed' },
            '金额': { column: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', type: 'computed' }
        }
    },
    '微信收款商业版': {
        timeField: '交易时间',
        fields: {
            '收入': { column: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', type: 'computed' },
            '金额': { column: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', type: 'computed' }
        }
    },
    '月租车充值': {
        timeField: '交款时间',
        fields: {
            '收入': { column: '[交款金额]', type: 'number' },
            '金额': { column: '[交款金额]', type: 'number' },
            '交款金额': { column: '[交款金额]', type: 'number' },
            '充值': { column: '[交款金额]', type: 'number' },
            '充值金额': { column: '[交款金额]', type: 'number' },
            '车牌号': { column: '[车牌号码]', type: 'string' },
            '车牌': { column: '[车牌号码]', type: 'string' }
        }
    },
    '智小盟': {
        timeField: '支付时间',
        fields: {
            '收入': { column: '[实收金额]', type: 'number' },
            '金额': { column: '[实收金额]', type: 'number' },
            '实收金额': { column: '[实收金额]', type: 'number' }
        }
    },
    '超时占位费': {
        timeField: '支付时间',
        fields: {
            '收入': { column: 'CAST([应收金额] AS FLOAT)', type: 'computed' },
            '金额': { column: 'CAST([应收金额] AS FLOAT)', type: 'computed' },
            '应收金额': { column: 'CAST([应收金额] AS FLOAT)', type: 'computed' }
        }
    },
    '车颜知己洗车': {
        timeField: '启动时间',
        fields: {
            '收入': { column: "(CASE WHEN [使用会员卡] = '否' AND [订单状态] = '已完成' THEN CAST([订单金额] AS FLOAT) WHEN [使用会员卡] = '是' AND [订单状态] = '已完成' THEN 7 ELSE 0 END)", type: 'computed' },
            '金额': { column: "(CASE WHEN [使用会员卡] = '否' AND [订单状态] = '已完成' THEN CAST([订单金额] AS FLOAT) WHEN [使用会员卡] = '是' AND [订单状态] = '已完成' THEN 7 ELSE 0 END)", type: 'computed' }
        }
    },
    '活动优惠券': {
        timeField: '收款时间',
        stationField: '电站名称',
        fields: {
            '收入': { column: '活动优惠券收入计算', type: 'special' },
            '金额': { column: '活动优惠券收入计算', type: 'special' },
            '优惠券': { column: '活动优惠券收入计算', type: 'special' },
            '活动券': { column: '活动优惠券收入计算', type: 'special' },
            '折扣券': { column: '活动优惠券收入计算', type: 'special' }
        }
    },
    '电力局': {
        timeField: '年',
        monthField: '月',
        fields: {
            '用电量': { column: '[电量]', type: 'number' },
            '电量': { column: '[电量]', type: 'number', isPowerBureau: true }, // 标记为电力局电量
            '电费': { column: '([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用])', type: 'computed', isPowerBureau: true },
            '费用': { column: '([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用])', type: 'computed', isPowerBureau: true },
            '购电费': { column: '[购电费]', type: 'number' },
            '输配电量电费': { column: '[输配电量电费]', type: 'number' },
            '力调电费': { column: '[力调电费]', type: 'number' },
            '基金及附加': { column: '[基金及附加]', type: 'number' },
            '上网线损费用': { column: '[上网线损费用]', type: 'number' },
            '系统运行费用': { column: '[系统运行费用]', type: 'number' },
            '环境价值费用': { column: '[环境价值费用]', type: 'number' },
            '变压器编号': { column: '[变压器编号]', type: 'string' }
        }
    }
};

// 查询所有表的时间范围
let tableTimeRangesCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 60 * 60 * 1000; // 缓存1小时

async function getTableTimeRanges() {
    // 如果缓存存在且未过期,直接返回
    if (tableTimeRangesCache && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
        console.log('使用缓存的时间范围数据');
        return tableTimeRangesCache;
    }

    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const timeRanges = {};

        console.log('开始查询所有表的时间范围...');

        // 遍历所有表
        for (const [tableName, config] of Object.entries(TABLE_FIELDS)) {
            try {
                const timeField = config.timeField;

                // 电力局表特殊处理（使用年+月）
                if (tableName === '电力局') {
                    const query = `
                        SELECT
                            MIN(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') as minTime,
                            MAX(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') as maxTime
                        FROM [${tableName}]
                        WHERE [年] IS NOT NULL AND [月] IS NOT NULL
                    `;
                    const result = await pool.request().query(query);
                    if (result.recordset && result.recordset.length > 0) {
                        const record = result.recordset[0];
                        if (record.minTime && record.maxTime) {
                            timeRanges[tableName] = {
                                minTime: record.minTime,
                                maxTime: record.maxTime,
                                formatted: `${record.minTime.substring(0,7)} 至 ${record.maxTime.substring(0,7)}`
                            };
                        }
                    }
                } else if (timeField) {
                    // 其他表使用时间字段
                    const query = `
                        SELECT
                            MIN([${timeField}]) as minTime,
                            MAX([${timeField}]) as maxTime
                        FROM [${tableName}]
                        WHERE [${timeField}] IS NOT NULL
                    `;
                    const result = await pool.request().query(query);
                    if (result.recordset && result.recordset.length > 0) {
                        const record = result.recordset[0];
                        if (record.minTime && record.maxTime) {
                            timeRanges[tableName] = {
                                minTime: record.minTime,
                                maxTime: record.maxTime,
                                formatted: `${formatDate(record.minTime)} 至 ${formatDate(record.maxTime)}`
                            };
                        }
                    }
                }

                console.log(`表 [${tableName}] 时间范围: ${timeRanges[tableName]?.formatted || '无数据'}`);
            } catch (error) {
                console.error(`查询表 [${tableName}] 时间范围失败:`, error.message);
                timeRanges[tableName] = {
                    error: true,
                    message: error.message
                };
            }
        }

        // 更新缓存
        tableTimeRangesCache = timeRanges;
        cacheTimestamp = Date.now();
        console.log('时间范围查询完成，已缓存');

        return timeRanges;
    } catch (error) {
        console.error('查询表时间范围失败:', error);
        throw new Error(`查询表时间范围失败: ${error.message}`);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

// 格式化日期用于显示
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 判断是否是数据库查询问题
function isDatabaseQuery(message) {
    const hasTableName = Object.keys(TABLE_NAMES).some(name => message.includes(name));
    const hasCharging = message.includes('充电');
    const hasSifangping = message.includes('四方坪');
    const hasGaoling = message.includes('高岭');
    const hasChehaiyang = message.includes('车海洋');
    const hasWeixin = message.includes('微信');
    const hasParking = message.includes('停车'); // 停车相关查询

    // 支持模糊匹配的关键词
    const hasXingyuan = message.includes('兴元');
    const hasCheyanziji = message.includes('车颜知己');
    const hasKuaiyijie = message.includes('快易洁');
    const hasHongmen = message.includes('红门');
    const hasSaifeimu = message.includes('赛菲姆');
    const hasShouqianba = message.includes('收钱吧');
    const hasYuezuche = message.includes('月租车');
    const hasZhixiaomeng = message.includes('智小盟');
    const hasOvertime = message.includes('超时') || message.includes('占位');
    const hasDianliju = message.includes('电力局');

    // 车牌相关查询关键词
    // 充值(不包含洗车充值) -> 月租车充值表
    const hasRecharge = message.includes('充值') && !message.includes('车海洋') && !message.includes('洗车');
    // 缴费 -> 红门缴费表
    const hasPayment = message.includes('缴费');

    // 通用业务关键词（新增）
    const hasWashing = message.includes('洗车');  // 洗车业务
    const hasChargingPile = message.includes('充电桩');  // 充电桩
    const hasRetail = message.includes('零售') || message.includes('售货');  // 零售/售货
    const didiCharging = message.includes('滴滴充电');  // 滴滴充电

    // 电力局相关关键词
    const hasPowerBureau = (
        message.includes('用电量') ||
        message.includes('电力局电量') ||
        message.includes('电力局电费') ||
        message.includes('电量损耗') ||
        message.includes('毛利') ||
        message.includes('毛利润') ||
        (message.includes('电费') && (message.includes('电力局') || message.includes('用电'))) ||
        (message.includes('电量') && (message.includes('电力局') || message.includes('用电')))
    );

    // 综合业务收入/金额/流水相关关键词（无论是否指定地点，都应该走数据库查询）
    // 注意："综合收入"是"综合业务收入"的简称，也应该识别
    // 但注意：如果包含"充电"关键词，应该查询充电表，而不是综合业务收入表
    const hasComprehensiveBusiness = (message.includes('综合业务收入') || message.includes('综合业务金额') || message.includes('综合业务流水') || message.includes('综合收入')) && !message.includes('充电');

    return hasTableName || hasCharging || hasSifangping || hasGaoling || hasChehaiyang || hasWeixin || hasParking ||
           hasXingyuan || hasCheyanziji || hasKuaiyijie || hasHongmen || hasSaifeimu ||
           hasShouqianba || hasYuezuche || hasZhixiaomeng || hasOvertime || hasDianliju || hasPowerBureau ||
           hasRecharge || hasPayment || hasComprehensiveBusiness ||
           hasWashing || hasChargingPile || hasRetail || didiCharging;  // 新增通用关键词
}

// 从问题中提取表名
function extractTableNames(message) {
    const tables = [];
    const metadata = {
        isSifangping: false,
        isGaoling: false
    };

    // ========== 通用关键词到具体表的映射（优先级最高）==========

    // 滴滴充电 -> 滴滴表
    if (message.includes('滴滴充电')) {
        tables.push('滴滴');
        // 如果同时有地点关键词，设置metadata
        if (message.includes('四方坪')) {
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            metadata.isGaoling = true;
        }
        return { tables, metadata };
    }

    // 洗车业务（不包含"车海洋"+"充值"或"消费"的具体组合）
    // 如果只说"洗车"，查询所有洗车相关表
    if (message.includes('洗车') && !message.includes('车海洋洗车充值') && !message.includes('车海洋洗车消费')) {
        tables.push('车海洋洗车充值', '车海洋洗车消费', '车颜知己洗车', '快易洁洗车');

        // 如果同时有地点关键词，设置metadata
        if (message.includes('四方坪')) {
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            metadata.isGaoling = true;
        }
        return { tables, metadata };
    }

    // 充电桩 -> 特来电表
    if (message.includes('充电桩')) {
        tables.push('特来电');

        // 如果同时有地点关键词，设置metadata
        if (message.includes('四方坪')) {
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            metadata.isGaoling = true;
        }
        return { tables, metadata };
    }

    // 零售/售货 -> 兴元售货机
    if (message.includes('零售') || message.includes('售货')) {
        tables.push('兴元售货机');

        // 如果同时有地点关键词，设置metadata（用于筛选机器名称）
        if (message.includes('四方坪')) {
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            metadata.isGaoling = true;
        }
        return { tables, metadata };
    }

    // ========== 通用关键词映射结束 ==========

    // 特殊逻辑：综合业务收入/金额/流水（优先级很高）
    // 只要包含"综合业务收入"、"综合业务金额"、"综合业务流水"、"综合收入"等关键词
    // 但注意：如果包含"充电"关键词，应该查询充电表（特来电、能科、滴滴），而不是综合业务收入表
    if ((message.includes('综合业务收入') || message.includes('综合业务金额') || message.includes('综合业务流水') || message.includes('综合收入')) && !message.includes('充电')) {
        // 根据地点决定查询哪些表
        if (message.includes('四方坪')) {
            // 四方坪：10个表
            tables.push('车海洋洗车充值', '车海洋洗车消费', '红门缴费', '赛菲姆道闸', '收钱吧', 
                       '兴元售货机', '微信商户下单', '微信收款商业版', '月租车充值', '智小盟');
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            // 高岭：4个表
            tables.push('快易洁洗车', '车颜知己洗车', '超时占位费', '兴元售货机');
            metadata.isGaoling = true;
        } else {
            // 未指定地点：查询所有13个表
            tables.push('车海洋洗车充值', '车海洋洗车消费', '车颜知己洗车', '红门缴费', '快易洁洗车',
                       '赛菲姆道闸', '收钱吧', '兴元售货机', '微信商户下单', '微信收款商业版',
                       '月租车充值', '智小盟', '超时占位费');
        }
        return { tables, metadata };
    }

    // 特殊逻辑：停车收入（优先级很高）
    // 只要包含"停车收入"，无论是否提到"四方坪""高岭"等地点关键词，
    // 都按统一的停车收入公式：红门缴费[交易金额] + 赛菲姆道闸[支付金额]（排除线下现金、平台现金支付）
    if (message.includes('停车收入')) {
        tables.push('红门缴费', '赛菲姆道闸');
        return { tables, metadata };
    }

    // 优先逻辑：优惠券、活动券、折扣券 -> 活动优惠券（优先于四方坪/高岭逻辑）
    if (message.includes('优惠券') || message.includes('活动券') || message.includes('折扣券')) {
        tables.push('活动优惠券');
        // 如果同时包含四方坪或高岭，设置metadata用于筛选电站
        if (message.includes('四方坪')) {
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            metadata.isGaoling = true;
        }
        return { tables, metadata };
    }

    // 特殊逻辑：公司/飞狐/四方坪+高岭 - 如果包含"公司"或"飞狐"，或同时包含"四方坪"和"高岭"，查询特来电+能科+滴滴三个表（所有数据）
    if (message.includes('公司') || message.includes('飞狐') || (message.includes('四方坪') && message.includes('高岭'))) {
        // 包含"公司"或"飞狐"时，等同于查询所有数据（四方坪+高岭）
        metadata.isSifangping = true;
        metadata.isGaoling = true;
        
        // 优先检查：用户是否明确指定了表名
        if (message.includes('特来电')) {
            tables.push('特来电');
            return { tables, metadata };
        }
        if (message.includes('能科')) {
            tables.push('能科');
            return { tables, metadata };
        }
        if (message.includes('滴滴')) {
            tables.push('滴滴');
            return { tables, metadata };
        }
        
        // 判断是否包含需要合并查询的关键词
        const shouldMergeQuery = (
            message.includes('充电电量') || 
            message.includes('电量') || 
            message.includes('服务费') || 
            message.includes('费用') || 
            message.includes('金额') || 
            message.includes('收入') || 
            message.includes('订单数量') || 
            message.includes('订单数') || 
            message.includes('多少单')
        );
        
        if (shouldMergeQuery) {
            // 检查字段名相关的内容
            const telaidianFieldKeywords = [
                '订单编号', '订单号', '车牌号', '车牌', '电站名称', '电站',
                '终端名称', '充电结束时间', '充电开始时间'
            ];
            const nengkeFieldKeywords = [
                '卡号', '充电桩名称', '充电桩', '结束日期时间'
            ];
            const didiFieldKeywords = [
                '充电完成时间', '场站名称', '充电枪ID'
            ];
            const commonFieldKeywords = [
                '充电时长', '时长', '枪', '终端'
            ];
            
            const hasTelaidianField = telaidianFieldKeywords.some(keyword => message.includes(keyword));
            const hasNengkeField = nengkeFieldKeywords.some(keyword => message.includes(keyword));
            const hasDidiField = didiFieldKeywords.some(keyword => message.includes(keyword));
            const hasCommonField = commonFieldKeywords.some(keyword => message.includes(keyword));
            
            if (hasTelaidianField && !hasNengkeField && !hasDidiField) {
                tables.push('特来电');
            } else if (hasNengkeField && !hasTelaidianField && !hasDidiField) {
                tables.push('能科');
            } else if (hasDidiField && !hasTelaidianField && !hasNengkeField) {
                tables.push('滴滴');
            } else if (hasCommonField) {
                if (hasTelaidianField) {
                    tables.push('特来电');
                } else if (hasNengkeField) {
                    tables.push('能科');
                } else if (hasDidiField) {
                    tables.push('滴滴');
                } else {
                    tables.push('特来电', '能科', '滴滴');
                }
            } else {
                // 不包含字段名相关的内容，合并查询特来电+能科+滴滴
                tables.push('特来电', '能科', '滴滴');
            }
        } else {
            // 其他情况只查询特来电表
            tables.push('特来电');
        }
        
        return { tables, metadata };
    }

    // 特殊逻辑：高岭 - 只查询特来电高岭站点
    if (message.includes('高岭')) {
        metadata.isGaoling = true;
        tables.push('特来电');
        return { tables, metadata };
    }

    // 特殊逻辑：四方坪 - 需要判断是否合并查询特来电+能科+滴滴（停车收入已在前面单独处理）
    if (message.includes('四方坪')) {
        metadata.isSifangping = true;

        // 优先检查：用户是否明确指定了表名
        // 如果明确说了"特来电"，只查询特来电表
        if (message.includes('特来电')) {
            tables.push('特来电');
            return { tables, metadata };
        }
        // 如果明确说了"能科"，只查询能科表
        if (message.includes('能科')) {
            tables.push('能科');
            return { tables, metadata };
        }
        // 如果明确说了"滴滴"，只查询滴滴表
        if (message.includes('滴滴')) {
            tables.push('滴滴');
            return { tables, metadata };
        }

        // 判断是否包含需要合并查询的关键词
        // 只要包含"四方坪"和以下任一关键词，就需要判断是否合并查询
        const shouldMergeQuery = (
            message.includes('充电电量') || 
            message.includes('电量') || 
            message.includes('充电电费') ||
            (message.includes('电费') && message.includes('充电')) ||
            message.includes('服务费') || 
            message.includes('费用') || 
            message.includes('金额') || 
            message.includes('收入') || 
            message.includes('订单数量') || 
            message.includes('订单数') || 
            message.includes('多少单')
        );

        if (shouldMergeQuery) {
            // 检查第三个条件是否是字段名相关的内容
            // 特来电表特有的字段名关键词
            const telaidianFieldKeywords = [
                '订单编号', '订单号', '车牌号', '车牌', '电站名称', '电站',
                '终端名称', '充电结束时间', '充电开始时间'
            ];
            // 能科表特有的字段名关键词
            const nengkeFieldKeywords = [
                '卡号', '充电桩名称', '充电桩', '结束日期时间'
            ];
            // 滴滴表特有的字段名关键词
            const didiFieldKeywords = [
                '充电完成时间', '场站名称', '充电枪ID'
            ];
            // 三个表都有的字段名关键词（需要根据上下文判断）
            const commonFieldKeywords = [
                '充电时长', '时长', '枪', '终端'
            ];

            // 检查是否包含特来电表特有的字段名关键词
            const hasTelaidianField = telaidianFieldKeywords.some(keyword => message.includes(keyword));
            // 检查是否包含能科表特有的字段名关键词
            const hasNengkeField = nengkeFieldKeywords.some(keyword => message.includes(keyword));
            // 检查是否包含滴滴表特有的字段名关键词
            const hasDidiField = didiFieldKeywords.some(keyword => message.includes(keyword));
            // 检查是否包含共同字段名关键词
            const hasCommonField = commonFieldKeywords.some(keyword => message.includes(keyword));

            // 如果包含字段名相关的内容，只在对应的表中查询
            if (hasTelaidianField && !hasNengkeField && !hasDidiField) {
                // 只包含特来电表的字段，只查询特来电表
                tables.push('特来电');
            } else if (hasNengkeField && !hasTelaidianField && !hasDidiField) {
                // 只包含能科表的字段，只查询能科表
                tables.push('能科');
            } else if (hasDidiField && !hasTelaidianField && !hasNengkeField) {
                // 只包含滴滴表的字段，只查询滴滴表
                tables.push('滴滴');
            } else if (hasCommonField) {
                // 包含共同字段，需要判断：如果同时包含特来电特有字段，只查特来电；如果同时包含能科特有字段，只查能科；如果同时包含滴滴特有字段，只查滴滴；否则查三个表
                if (hasTelaidianField) {
                    tables.push('特来电');
                } else if (hasNengkeField) {
                    tables.push('能科');
                } else if (hasDidiField) {
                    tables.push('滴滴');
                } else {
                    // 只有共同字段，查三个表
                    tables.push('特来电', '能科', '滴滴');
                }
            } else {
                // 不包含字段名相关的内容，合并查询特来电+能科+滴滴
                tables.push('特来电', '能科', '滴滴');
            }
        } else {
            // 其他情况只查询特来电表
            tables.push('特来电');
        }

        return { tables, metadata };
    }

    // 车海洋逻辑
    // 如果明确提到"车海洋洗车充值"或"充值"，则只查询"车海洋洗车充值"表
    if (message.includes('车海洋洗车充值') || (message.includes('车海洋') && message.includes('充值') && !message.includes('消费'))) {
        tables.push('车海洋洗车充值');
        return { tables, metadata };
    }
    // 如果明确提到"车海洋洗车消费"或"消费"，则只查询"车海洋洗车消费"表
    if (message.includes('车海洋洗车消费') || (message.includes('车海洋') && message.includes('消费') && !message.includes('充值'))) {
        tables.push('车海洋洗车消费');
        return { tables, metadata };
    }
    // 如果只包含"车海洋"（不包含"充值"和"消费"），则查询两个表
    if (message.includes('车海洋') && !message.includes('充值') && !message.includes('消费')) {
        tables.push('车海洋洗车充值', '车海洋洗车消费');
        return { tables, metadata };
    }

    // 其他停车相关查询（不包含"停车收入"）：组合停车场相关的几张表
    // - 赛菲姆道闸：临停收费
    // - 红门缴费：停车场进出收费
    // - 月租车充值：月租车费用
    // - 超时占位费：超时停车收入
    if (message.includes('停车')) {
        if (!tables.includes('赛菲姆道闸')) {
            tables.push('赛菲姆道闸');
        }
        if (!tables.includes('红门缴费')) {
            tables.push('红门缴费');
        }
        if (!tables.includes('月租车充值')) {
            tables.push('月租车充值');
        }
        if (!tables.includes('超时占位费')) {
            tables.push('超时占位费');
        }
        return { tables, metadata };
    }

    // 微信逻辑
    // 如果明确提到"微信商户下单"或"商户下单"，则只查询"微信商户下单"表
    if (message.includes('微信商户下单') || (message.includes('微信') && message.includes('商户下单'))) {
        tables.push('微信商户下单');
        return { tables, metadata };
    }
    // 如果明确提到"微信收款商业版"或"收款商业版"，则只查询"微信收款商业版"表
    if (message.includes('微信收款商业版') || (message.includes('微信') && message.includes('收款商业版'))) {
        tables.push('微信收款商业版');
        return { tables, metadata };
    }
    // 如果只包含"微信"（不包含"商户下单"和"收款商业版"），则查询两个表
    if (message.includes('微信') && !message.includes('商户下单') && !message.includes('收款商业版')) {
        tables.push('微信商户下单', '微信收款商业版');
        return { tables, metadata };
    }

    // 电力局逻辑（优先判断，因为"用电量"、"电费"等关键词可能与充电混淆）
    const hasPowerBureauKeywords = (
        message.includes('用电量') ||
        message.includes('电力局电量') ||
        message.includes('电力局电费') ||
        message.includes('电量损耗') ||
        message.includes('毛利') ||
        message.includes('毛利润') ||
        (message.includes('电费') && (message.includes('电力局') || message.includes('用电'))) ||
        (message.includes('电量') && (message.includes('电力局') || message.includes('用电')))
    );

    if (hasPowerBureauKeywords || message.includes('电力局')) {
        tables.push('电力局');

        // 检查是否包含四方坪或高岭关键词，设置metadata
        if (message.includes('四方坪')) {
            metadata.isSifangping = true;
        } else if (message.includes('高岭')) {
            metadata.isGaoling = true;
        }

        // 如果涉及电量损耗或毛利润，还需要查询充电数据
        if (message.includes('电量损耗') || message.includes('毛利') || message.includes('毛利润')) {
            // 判断是否需要查询充电数据
            if (message.includes('充电') || message.includes('特来电') || message.includes('能科') || message.includes('滴滴')) {
                if (message.includes('充电') && !message.includes('特来电') && !message.includes('能科') && !message.includes('滴滴')) {
                    tables.push('特来电', '能科', '滴滴');
                } else if (message.includes('特来电')) {
                    tables.push('特来电');
                } else if (message.includes('能科')) {
                    tables.push('能科');
                } else if (message.includes('滴滴')) {
                    tables.push('滴滴');
                }
            } else {
                // 默认查询特来电、能科和滴滴（用于计算损耗和利润）
                tables.push('特来电', '能科', '滴滴');
            }
        }
        return { tables, metadata };
    }

    // 充电逻辑
    if (message.includes('充电') && !message.includes('特来电') && !message.includes('能科') && !message.includes('滴滴')) {
        tables.push('特来电', '能科', '滴滴');
    } else {
        // 模糊匹配表名（支持部分关键词）
        // 兴元 -> 兴元售货机
        if (message.includes('兴元') && !tables.includes('兴元售货机')) {
            tables.push('兴元售货机');
        }
        // 车颜知己 -> 车颜知己洗车
        if (message.includes('车颜知己') && !tables.includes('车颜知己洗车')) {
            tables.push('车颜知己洗车');
        }
        // 快易洁 -> 快易洁洗车
        if (message.includes('快易洁') && !tables.includes('快易洁洗车')) {
            tables.push('快易洁洗车');
        }
        // 红门 -> 红门缴费
        if (message.includes('红门') && !tables.includes('红门缴费')) {
            tables.push('红门缴费');
        }
        // 赛菲姆 -> 赛菲姆道闸
        if (message.includes('赛菲姆') && !tables.includes('赛菲姆道闸')) {
            tables.push('赛菲姆道闸');
        }
        // 收钱吧直接匹配
        if (message.includes('收钱吧') && !tables.includes('收钱吧')) {
            tables.push('收钱吧');
        }
        // 优惠券、活动券、折扣券 -> 活动优惠券
        if ((message.includes('优惠券') || message.includes('活动券') || message.includes('折扣券')) && !tables.includes('活动优惠券')) {
            tables.push('活动优惠券');
        }
        // 月租车 -> 月租车充值
        if (message.includes('月租车') && !tables.includes('月租车充值')) {
            tables.push('月租车充值');
        }
        // 充值(不包含洗车充值) -> 月租车充值
        // 当问题包含"充值"但不包含"车海洋"、"洗车"时,查询月租车充值表
        if (message.includes('充值') && !message.includes('车海洋') && !message.includes('洗车') && !tables.includes('月租车充值')) {
            tables.push('月租车充值');
        }
        // 缴费 -> 红门缴费
        // 当问题包含"缴费"时,查询红门缴费表
        if (message.includes('缴费') && !tables.includes('红门缴费')) {
            tables.push('红门缴费');
        }
        // 智小盟直接匹配
        if (message.includes('智小盟') && !tables.includes('智小盟')) {
            tables.push('智小盟');
        }
        // 超时占位 -> 超时占位费
        // 支持"超时"、"占位"、"占位费"等关键词
        if ((message.includes('超时') || message.includes('占位') || message.includes('占位费')) && !tables.includes('超时占位费')) {
            tables.push('超时占位费');
        }
        // 电力局直接匹配
        if (message.includes('电力局') && !tables.includes('电力局')) {
            tables.push('电力局');
        }

        // 精确匹配完整表名（作为补充）
        for (const tableName in TABLE_NAMES) {
            if (message.includes(tableName) && !tables.includes(tableName)) {
                tables.push(tableName);
            }
        }
    }

    // 特殊逻辑：如果涉及"枪"或"终端"，查询特来电表和滴滴表，不查询能科表
    if (message.includes('枪') || message.includes('终端')) {
        const index = tables.indexOf('能科');
        if (index > -1) {
            tables.splice(index, 1);
        }
        // 如果包含四方坪，需要添加滴滴表（如果还没有）
        if (message.includes('四方坪') && !tables.includes('滴滴')) {
            tables.push('滴滴');
        }
        // 如果包含充电相关关键词，需要添加滴滴表（如果还没有）
        if ((message.includes('充电') || message.includes('电量') || message.includes('服务费') || message.includes('费用') || message.includes('金额') || message.includes('收入')) && !tables.includes('滴滴')) {
            // 检查是否已经有特来电表，如果有，也添加滴滴表
            if (tables.includes('特来电')) {
                tables.push('滴滴');
            }
        }
    }

    return { tables, metadata };
}

// 提取时间信息
function extractTimeInfo(message) {
    const timeInfo = {
        hasTime: false,
        year: null,
        month: null,
        day: null,
        startDate: null,
        endDate: null,
        isToday: false,
        isThisYear: false,
        isLastYear: false,
        // 新增字段（任务2：增强时间提取）
        quarter: null,           // 季度 (1-4)
        week: null,              // 周 (current/last)
        isWeekday: null,         // 是否只查工作日
        isWeekend: null,         // 是否只查周末
        recentDays: null,        // 近N天
        recentMonths: null       // 近N个月
    };

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();
    const currentDate = new Date();  // 当前日期对象

    // ========== 优先匹配：具体日期范围 ==========
    // 支持3种格式：
    // 1. "2025-11-01 至 2026-01-15"（标准日期格式）
    // 2. "2025年11月01日 至 2026年01月15日"（中文日期格式）
    // 3. "2025年11月01日到2026年01月15日"（无空格变体）
    // 必须放在最前面，避免被后续的year/month/day匹配逻辑干扰

    // 匹配格式1：标准日期格式 YYYY-MM-DD 至 YYYY-MM-DD
    let dateRangeMatch = message.match(/(\d{4}-\d{1,2}-\d{1,2})\s*(?:至|到)\s*(\d{4}-\d{1,2}-\d{1,2})/);
    if (dateRangeMatch) {
        timeInfo.hasTime = true;
        timeInfo.startDate = dateRangeMatch[1];
        timeInfo.endDate = dateRangeMatch[2];
        debugLog('提取到日期范围（标准格式）', { startDate: timeInfo.startDate, endDate: timeInfo.endDate });
        return timeInfo;
    }

    // 匹配格式2：中文日期格式 YYYY年MM月DD日 至 YYYY年MM月DD日
    dateRangeMatch = message.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:至|到)\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (dateRangeMatch) {
        timeInfo.hasTime = true;
        // 转换为标准格式 YYYY-MM-DD
        timeInfo.startDate = `${dateRangeMatch[1]}-${String(dateRangeMatch[2]).padStart(2, '0')}-${String(dateRangeMatch[3]).padStart(2, '0')}`;
        timeInfo.endDate = `${dateRangeMatch[4]}-${String(dateRangeMatch[5]).padStart(2, '0')}-${String(dateRangeMatch[6]).padStart(2, '0')}`;
        debugLog('提取到日期范围（中文格式）', { startDate: timeInfo.startDate, endDate: timeInfo.endDate });
        return timeInfo;
    }

    // 匹配格式3：月份范围格式 YYYY年MM月 至 YYYY年MM月
    dateRangeMatch = message.match(/(\d{4})年(\d{1,2})月\s*(?:至|到)\s*(\d{4})年(\d{1,2})月/);
    if (dateRangeMatch) {
        timeInfo.hasTime = true;
        const startYear = parseInt(dateRangeMatch[1]);
        const startMonth = parseInt(dateRangeMatch[2]);
        const endYear = parseInt(dateRangeMatch[3]);
        const endMonth = parseInt(dateRangeMatch[4]);
        // 转换为标准格式 YYYY-MM-DD
        timeInfo.startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
        // endDate是结束月的下个月1号
        const endDateObj = new Date(endYear, endMonth, 1);
        timeInfo.endDate = formatDate(endDateObj);
        debugLog('提取到月份范围', { startDate: timeInfo.startDate, endDate: timeInfo.endDate });
        return timeInfo;
    }
    // ========== 日期范围匹配结束 ==========

    // 匹配年份
    const yearMatch = message.match(/(\d{4})年/);
    if (yearMatch) {
        timeInfo.hasTime = true;
        timeInfo.year = parseInt(yearMatch[1]);
    }

    // 匹配月份
    const monthMatch = message.match(/(\d{1,2})月/);
    if (monthMatch) {
        timeInfo.hasTime = true;
        timeInfo.month = parseInt(monthMatch[1]);
    }

    // 匹配日期
    const dayMatch = message.match(/(\d{1,2})日/);
    if (dayMatch) {
        timeInfo.hasTime = true;
        timeInfo.day = parseInt(dayMatch[1]);
    }

    // 匹配"今年"
    if (message.includes('今年')) {
        timeInfo.hasTime = true;
        timeInfo.isThisYear = true;
        timeInfo.year = currentYear;
    }

    // 匹配"去年"
    if (message.includes('去年')) {
        timeInfo.hasTime = true;
        timeInfo.isLastYear = true;
        timeInfo.year = currentYear - 1;
    }

    // 匹配"前年"
    if (message.includes('前年')) {
        timeInfo.hasTime = true;
        timeInfo.year = currentYear - 2;
    }

    // 匹配"今天"
    if (message.includes('今天')) {
        timeInfo.hasTime = true;
        timeInfo.isToday = true;
        timeInfo.year = currentYear;
        timeInfo.month = currentMonth;
        timeInfo.day = currentDay;
    }

    // 匹配"上个月"或"上月"
    if (message.includes('上个月') || message.includes('上月')) {
        timeInfo.hasTime = true;
        let lastMonth = currentMonth - 1;
        let lastMonthYear = currentYear;
        if (lastMonth <= 0) {
            lastMonth = 12;
            lastMonthYear = currentYear - 1;
        }
        timeInfo.year = lastMonthYear;
        timeInfo.month = lastMonth;
    }

    // 匹配"这个月"或"本月"
    if (message.includes('这个月') || message.includes('本月')) {
        timeInfo.hasTime = true;
        timeInfo.year = currentYear;
        timeInfo.month = currentMonth;
    }

    // ========== 任务2：增强时间提取功能 ==========

    // 匹配季度（如"2024年第1季度"、"2024年Q1"、"第1季度"）
    const quarterMatch = message.match(/(\d{4})年.*?第([1-4])季度/) ||
                         message.match(/(\d{4})年.*?Q([1-4])/) ||
                         message.match(/第([1-4])季度/);
    if (quarterMatch) {
        timeInfo.hasTime = true;
        timeInfo.quarter = parseInt(quarterMatch[2]);
        if (quarterMatch[1]) {
            timeInfo.year = parseInt(quarterMatch[1]);
        } else if (!timeInfo.year) {
            timeInfo.year = currentYear;
        }
        // 季度转月份：Q1=1-3月, Q2=4-6月, Q3=7-9月, Q4=10-12月
        if (!timeInfo.month) {
            timeInfo.month = timeInfo.quarter * 3 - 2;  // 季度的起始月份
        }
    }

    // 匹配周查询（如"本周"、"上周"）
    if (message.includes('本周')) {
        timeInfo.hasTime = true;
        timeInfo.week = 'current';
        // 计算本周的日期范围（周一到周日）
        const dayOfWeek = currentDate.getDay();  // 0=周日, 1=周一, ...
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDay - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        timeInfo.startDate = formatDate(startOfWeek);
        timeInfo.endDate = formatDate(endOfWeek);
    }
    if (message.includes('上周')) {
        timeInfo.hasTime = true;
        timeInfo.week = 'last';
        const dayOfWeek = currentDate.getDay();
        const startOfLastWeek = new Date(currentDate);
        startOfLastWeek.setDate(currentDay - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7);
        const endOfLastWeek = new Date(startOfLastWeek);
        endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
        timeInfo.startDate = formatDate(startOfLastWeek);
        timeInfo.endDate = formatDate(endOfLastWeek);
    }

    // 匹配相对时间"近N天"、"最近N天"、"过去N天"
    const recentDaysMatch = message.match(/近(\d+)[天日]/) ||
                            message.match(/最近(\d+)[天日]/) ||
                            message.match(/过去(\d+)[天日]/);
    if (recentDaysMatch) {
        timeInfo.hasTime = true;
        timeInfo.recentDays = parseInt(recentDaysMatch[1]);
        const startDate = new Date(currentDate);
        startDate.setDate(currentDay - timeInfo.recentDays + 1);
        timeInfo.startDate = formatDate(startDate);
        timeInfo.endDate = formatDate(currentDate);
    }

    // 匹配相对时间"近N个月"、"最近N个月"、"过去N个月"
    const recentMonthsMatch = message.match(/近(\d+)个?月/) ||
                              message.match(/最近(\d+)个?月/) ||
                              message.match(/过去(\d+)个?月/);
    if (recentMonthsMatch) {
        timeInfo.hasTime = true;
        timeInfo.recentMonths = parseInt(recentMonthsMatch[1]);
        const startMonthDate = new Date(currentYear, currentMonth - timeInfo.recentMonths, 1);
        timeInfo.startDate = formatDate(startMonthDate);
        timeInfo.endDate = formatDate(currentDate);
    }

    // 匹配工作日/周末
    if (message.includes('工作日')) {
        timeInfo.isWeekday = true;
        timeInfo.hasTime = true;
    }
    if (message.includes('周末')) {
        timeInfo.isWeekend = true;
        timeInfo.hasTime = true;
    }

    // ========== 任务2增强结束 ==========

    // 生成日期范围（添加季度处理）
    if (timeInfo.year) {
        if (timeInfo.quarter) {
            // 季度日期范围
            const quarterStartMonth = timeInfo.quarter * 3 - 2;
            const quarterEndMonth = timeInfo.quarter * 3;
            timeInfo.startDate = `${timeInfo.year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
            const lastDayOfQuarter = new Date(timeInfo.year, quarterEndMonth, 0).getDate();
            timeInfo.endDate = `${timeInfo.year}-${String(quarterEndMonth).padStart(2, '0')}-${lastDayOfQuarter}`;
        } else if (timeInfo.month) {
            if (timeInfo.day) {
                timeInfo.startDate = `${timeInfo.year}-${String(timeInfo.month).padStart(2, '0')}-${String(timeInfo.day).padStart(2, '0')}`;
                timeInfo.endDate = timeInfo.startDate;
            } else {
                timeInfo.startDate = `${timeInfo.year}-${String(timeInfo.month).padStart(2, '0')}-01`;
                const lastDay = new Date(timeInfo.year, timeInfo.month, 0).getDate();
                timeInfo.endDate = `${timeInfo.year}-${String(timeInfo.month).padStart(2, '0')}-${lastDay}`;
            }
        } else {
            timeInfo.startDate = `${timeInfo.year}-01-01`;
            timeInfo.endDate = `${timeInfo.year}-12-31`;
        }
    }
    // 如果只有startDate和endDate（周查询、近N天等），不需要重新生成

    return timeInfo;
}

// 提取问题中的数字（支持多种格式：前N、最多的N、列出N、N天等）
function extractNumberFromMessage(message) {
    // 匹配模式：
    // 1. "前N" 或 "前N天" 或 "前N日"
    // 2. "最多的N" 或 "最多的N天" 或 "最多的N日"
    // 3. "列出N" 或 "列出N天" 或 "列出N日"
    // 4. "N天" 或 "N日"（仅当前面有特定关键词时）
    //
    // 注意：不要匹配日期格式中的数字（如"2025年11月01日"中的"01日"）

    // 先检查是否包含日期范围格式（避免误匹配日期中的数字）
    const hasDateRange = message.match(/\d{4}[-年]\d{1,2}[-月]\d{1,2}[-日]\s*(?:至|到)\s*\d{4}[-年]\d{1,2}[-月]\d{1,2}[-日]/);
    if (hasDateRange) {
        // 如果包含日期范围格式，只匹配明确带有排名关键词的模式
        const strictPatterns = [
            /前(?:的)?(\d+)(?:天|日)?/,
            /最多(?:的)?(\d+)(?:天|日)?/,
            /最少(?:的)?(\d+)(?:天|日)?/,
            /列出(?:的)?(\d+)(?:天|日)?/
        ];

        for (const pattern of strictPatterns) {
            const match = message.match(pattern);
            if (match) {
                const num = parseInt(match[1]);
                if (num > 0) {
                    return num;
                }
            }
        }
        return null; // 日期范围格式下，没有明确排名关键词就不提取数字
    }

    // 常规模式（非日期范围）
    const patterns = [
        /前(?:的)?(\d+)(?:天|日)?/,
        /最多(?:的)?(\d+)(?:天|日)?/,
        /最少(?:的)?(\d+)(?:天|日)?/,
        /列出(?:的)?(\d+)(?:天|日)?/,
        // 匹配"N天"或"N日"，但要确保前面有排名相关关键词
        /(?:最多|最少|最大|最小|最高|最低|前|列出)(?:的)?\s*(\d+)(?:天|日)/
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
            const num = parseInt(match[1]);
            if (num > 0) {
                return num;
            }
        }
    }

    return null;
}

// 根据时间信息过滤充电相关的表（能科、特来电、滴滴）
// 时间过滤规则（最高优先级）：
// - 能科表：2024年5月（含）以后没有数据，所以2024年5月及以后不查询能科表
// - 特来电表：2026年2月（含）以后没有数据，所以2026年2月及以后不查询特来电表
// - 滴滴表：2025年11月（含）之前没有数据，所以2025年11月之前不查询滴滴表
function filterChargingTablesByTime(tables, timeInfo) {
    if (!timeInfo || !timeInfo.hasTime) {
        // 如果没有时间信息，返回所有表（保持原有逻辑）
        return tables;
    }

    const filteredTables = [];
    
    for (const table of tables) {
        if (table === '能科') {
            // 能科表：2024年5月（含）以后没有数据
            // 如果查询时间在2024年5月（含）以后，不查询能科表
            if (timeInfo.year) {
                if (timeInfo.year > 2024) {
                    // 2025年及以后，不查询能科表
                    continue;
                } else if (timeInfo.year === 2024) {
                    if (timeInfo.month && timeInfo.month >= 5) {
                        // 2024年5月及以后，不查询能科表
                        continue;
                    } else if (!timeInfo.month) {
                        // 2024年全年查询，需要查询能科表（因为包含1-4月）
                        // 但如果查询的是2024年5月及以后，不查询
                        // 这里保持查询，因为全年查询需要包含前4个月的数据
                    }
                }
            }
            filteredTables.push(table);
        } else if (table === '特来电') {
            // 特来电表：2026年2月（含）以后没有数据
            // 如果查询时间在2026年2月（含）以后，不查询特来电表
            if (timeInfo.year) {
                if (timeInfo.year > 2026) {
                    // 2027年及以后，不查询特来电表
                    continue;
                } else if (timeInfo.year === 2026) {
                    if (timeInfo.month && timeInfo.month >= 2) {
                        // 2026年2月及以后，不查询特来电表
                        continue;
                    } else if (!timeInfo.month) {
                        // 2026年全年查询，需要查询特来电表（因为包含1月）
                    }
                }
            }
            filteredTables.push(table);
        } else if (table === '滴滴') {
            // 滴滴表：2025年11月（含）之前没有数据
            // 如果查询时间在2025年11月之前，不查询滴滴表
            if (timeInfo.year) {
                if (timeInfo.year < 2025) {
                    // 2024年及以前，不查询滴滴表
                    continue;
                } else if (timeInfo.year === 2025) {
                    if (timeInfo.month && timeInfo.month < 11) {
                        // 2025年11月之前，不查询滴滴表
                        continue;
                    } else if (!timeInfo.month) {
                        // 2025年全年查询，需要查询滴滴表（因为包含11-12月）
                    }
                }
            }
            filteredTables.push(table);
        } else {
            // 其他表不受时间过滤规则影响
            filteredTables.push(table);
        }
    }
    
    return filteredTables;
}

// 规则匹配生成SQL
function generateSQLByRules(message, tables) {
    debugLog('使用规则匹配生成SQL', { message, tables });

    const timeInfo = extractTimeInfo(message);
    debugLog('提取的时间信息', timeInfo);

    // 应用时间过滤规则（最高优先级）
    // 对于充电相关的表（能科、特来电、滴滴），根据时间信息过滤
    // 时间过滤规则：
    // - 能科表：2024年5月（含）以后没有数据，所以2024年5月及以后不查询能科表
    // - 特来电表：2026年2月（含）以后没有数据，所以2026年2月及以后不查询特来电表
    // - 滴滴表：2025年11月（含）之前没有数据，所以2025年11月之前不查询滴滴表
    // 例如：对于"2025年12月四方坪充电电量最多的8天"查询：
    // - 会识别出需要查询特来电、能科、滴滴三个表
    // - 应用时间过滤规则后，会过滤掉能科表（因为能科表2024年5月后没有数据）
    // - 最终会查询特来电和滴滴两个表，然后合并结果
    tables = filterChargingTablesByTime(tables, timeInfo);
    debugLog('应用时间过滤规则后的表', tables);

    // 特殊处理：毛利 / 毛利润（充电收入 - 电力局电费）
    // 只在包含"毛利"/"毛利润"且明确地点（目前处理四方坪 / 高岭）时启用
    const hasGrossProfit = message.includes('毛利') || message.includes('毛利润');
    if (hasGrossProfit && (message.includes('四方坪') || message.includes('高岭'))) {
        debugLog('检测到毛利润专项计算逻辑');

        const isWhichYearQuery = message.includes('哪一年') || message.includes('哪年');
        const isMostQuery = message.includes('最多') || message.includes('最大') || message.includes('最高');
        const isLeastQuery = message.includes('最少') || message.includes('最小') || message.includes('最低');
        const isAveragePerMonth = message.includes('平均') && (message.includes('每月') || message.includes('每个月'));
        const isAveragePerDay = (message.includes('平均') && message.includes('每天')) || message.includes('每天平均');
        const isPerMonth = !message.includes('平均') && (message.includes('每月') || message.includes('每个月'));
        const isWhichMonth = message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月');

        // 根据地点设置变压器编号和特来电电站筛选条件
        let transformerCondition = '';
        let telaidianStationCondition = '';

        if (message.includes('四方坪')) {
            // 四方坪：电力局使用两个变压器，特来电排除高岭电站
            transformerCondition = "([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')";
            telaidianStationCondition =
                "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'" +
                " AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
        } else if (message.includes('高岭')) {
            // 高岭：电力局使用一个变压器，特来电只查询高岭电站
            transformerCondition = "([变压器编号] = '4350001671599')";
            telaidianStationCondition =
                "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%'" +
                " OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
        }

        // 应用时间过滤规则：根据时间信息决定需要查询哪些充电表
        const shouldQueryTelaidian = tables.includes('特来电');
        const shouldQueryNengke = tables.includes('能科');
        const shouldQueryDidi = tables.includes('滴滴');

        // 构建充电收入查询部分（用于日期范围查询）
        const buildChargingIncomeQuery = (startDate, endDate) => {
            const chargingParts = [];
            
            if (shouldQueryTelaidian) {
                chargingParts.push(`
                    ISNULL((SELECT SUM([充电费用(元)]) FROM [特来电] 
                            WHERE [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0 
                              AND [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}' 
                              ${telaidianStationCondition}), 0)
                `);
            }
            
            if (shouldQueryNengke) {
                chargingParts.push(`
                    ISNULL((SELECT SUM([消费金额]) FROM [能科] 
                            WHERE [消费金额] IS NOT NULL AND [消费金额] > 0 
                              AND [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}'), 0)
                `);
            }
            
            if (shouldQueryDidi) {
                chargingParts.push(`
                    ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)) FROM [滴滴] 
                            WHERE [订单总额（元）] IS NOT NULL 
                              AND LTRIM(RTRIM([订单总额（元）])) != '' 
                              AND ISNUMERIC([订单总额（元）]) = 1 
                              AND CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT) > 0 
                              AND [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}'), 0)
                `);
            }
            
            return chargingParts.length > 0 ? chargingParts.join(' + ') : '0';
        };

        // 1. 平均每月查询（如"2025年四方坪平均每月毛利多少"）
        if (isAveragePerMonth && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const chargingIncome = buildChargingIncomeQuery(startDate, endDate);

            const sql = `
                SELECT (
                    (${chargingIncome}) -
                    ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] +
                                       [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局]
                            WHERE [年] = ${year}
                              AND ${transformerCondition}
                              AND [购电费] IS NOT NULL
                              AND [输配电量电费] IS NOT NULL
                              AND [力调电费] IS NOT NULL
                              AND [基金及附加] IS NOT NULL
                              AND [上网线损费用] IS NOT NULL
                              AND [系统运行费用] IS NOT NULL
                              AND [环境价值费用] IS NOT NULL), 0)
                ) / 12.0 AS 平均每月毛利润
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 1.5. 平均每天查询（如"2025年四方坪平均每天毛利多少"）
        if (isAveragePerDay && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;
            // 计算该年的天数（闰年366天，平年365天）
            const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            const daysInYear = isLeapYear ? 366 : 365;

            const chargingIncome = buildChargingIncomeQuery(startDate, endDate);

            const sql = `
                SELECT (
                    (${chargingIncome}) -
                    ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] +
                                       [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局]
                            WHERE [年] = ${year}
                              AND ${transformerCondition}
                              AND [购电费] IS NOT NULL
                              AND [输配电量电费] IS NOT NULL
                              AND [力调电费] IS NOT NULL
                              AND [基金及附加] IS NOT NULL
                              AND [上网线损费用] IS NOT NULL
                              AND [系统运行费用] IS NOT NULL
                              AND [环境价值费用] IS NOT NULL), 0)
                ) / ${daysInYear}.0 AS 平均每天毛利润
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 2. 每月查询（按月份分组，如"2025年四方坪每月毛利"或"四方坪每个月的充电毛利"或"2025年四方坪最高的3个月"）
        if ((isPerMonth || isWhichMonth || isMostQuery || isLeastQuery) && !timeInfo.month) {
            // 如果有年份，查询该年的数据；如果没有年份，查询所有数据
            const hasYear = timeInfo.year !== undefined && timeInfo.year !== null;
            const startDate = hasYear ? `${timeInfo.year}-01-01` : '2000-01-01';
            const endDate = hasYear ? `${timeInfo.year + 1}-01-01` : '2099-12-31';

            // 构建充电收入按月份分组的子查询
            const chargingParts = [];
            if (shouldQueryTelaidian) {
                chargingParts.push(`
                    SELECT 
                        YEAR([充电结束时间]) AS 年,
                        MONTH([充电结束时间]) AS 月,
                        SUM([充电费用(元)]) AS 充电收入
                    FROM [特来电]
                    WHERE [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}'
                      AND [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0
                      ${telaidianStationCondition}
                    GROUP BY YEAR([充电结束时间]), MONTH([充电结束时间])
                `);
            }
            if (shouldQueryNengke) {
                chargingParts.push(`
                    SELECT 
                        YEAR([结束日期时间]) AS 年,
                        MONTH([结束日期时间]) AS 月,
                        SUM([消费金额]) AS 充电收入
                    FROM [能科]
                    WHERE [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}'
                      AND [消费金额] IS NOT NULL AND [消费金额] > 0
                    GROUP BY YEAR([结束日期时间]), MONTH([结束日期时间])
                `);
            }
            if (shouldQueryDidi) {
                chargingParts.push(`
                    SELECT 
                        YEAR([充电完成时间]) AS 年,
                        MONTH([充电完成时间]) AS 月,
                        SUM(CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)) AS 充电收入
                    FROM [滴滴]
                    WHERE [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}'
                      AND [订单总额（元）] IS NOT NULL 
                      AND LTRIM(RTRIM([订单总额（元）])) != '' 
                      AND ISNUMERIC([订单总额（元）]) = 1 
                      AND CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT) > 0
                    GROUP BY YEAR([充电完成时间]), MONTH([充电完成时间])
                `);
            }

            // 构建按月份分组的SQL
            const monthlyBaseSql = `
                SELECT 
                    p.[年],
                    p.[月],
                    ISNULL(c.充电收入, 0) - ISNULL(p.电费, 0) AS 毛利润
                FROM (
                    SELECT 
                        [年],
                        [月],
                        SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] +
                            [上网线损费用] + [系统运行费用] + [环境价值费用]) AS 电费
                    FROM [电力局]
                    WHERE ${hasYear ? '[年] = ' + timeInfo.year : '[年] >= 2000'}
                      AND ${transformerCondition}
                      AND [购电费] IS NOT NULL
                      AND [输配电量电费] IS NOT NULL
                      AND [力调电费] IS NOT NULL
                      AND [基金及附加] IS NOT NULL
                      AND [上网线损费用] IS NOT NULL
                      AND [系统运行费用] IS NOT NULL
                      AND [环境价值费用] IS NOT NULL
                    GROUP BY [年], [月]
                ) p
                LEFT JOIN (
                    SELECT 
                        年,
                        月,
                        SUM(充电收入) AS 充电收入
                    FROM (
                        ${chargingParts.length > 0 ? chargingParts.join(' UNION ALL ') : 'SELECT 0 AS 年, 0 AS 月, 0 AS 充电收入 WHERE 1=0'}
                    ) t
                    GROUP BY 年, 月
                ) c ON c.年 = p.[年] AND c.月 = p.[月]
            `;

            // 如果查询"哪一月"或"最高的多少个月"或"最少的多少个月"，需要按排名返回
            if (isWhichMonth || isMostQuery || isLeastQuery) {
                // 提取月份数
                let topN = 1;
                const monthMatch = message.match(/(\d+)\s*个*月/);
                if (monthMatch) {
                    topN = parseInt(monthMatch[1]);
                } else if (message.includes('前几') || message.includes('前')) {
                    topN = 5; // 默认前5
                } else if (!isWhichMonth) {
                    topN = 3; // 如果是"最高的/最低的几个月"但没有指定数字，默认前3
                }

                const orderDir = isLeastQuery ? 'ASC' : 'DESC';
                const wrapped = `
                    SELECT TOP ${topN} *
                    FROM (
                        ${monthlyBaseSql}
                    ) AS x
                    ORDER BY x.毛利润 ${orderDir}
                `;
                return wrapped.replace(/\s+/g, ' ').trim();
            }

            // 否则返回每月明细，按年、月排序
            const orderedSql = `
                SELECT *
                FROM (
                    ${monthlyBaseSql}
                ) AS t
                ORDER BY t.[年], t.[月]
            `;
            return orderedSql.replace(/\s+/g, ' ').trim();
        }

        // 3. 单月查询（如"2025年9月四方坪毛利是多少"）
        if (timeInfo.year && timeInfo.month) {
            const year = timeInfo.year;
            const month = timeInfo.month;
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

            const chargingIncome = buildChargingIncomeQuery(startDate, endDate);
            
            const sql = `
                SELECT 
                    (${chargingIncome}) -
                    ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] +
                                       [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局] 
                            WHERE [年] = ${year} AND [月] = ${month} 
                              AND ${transformerCondition} 
                              AND [购电费] IS NOT NULL 
                              AND [输配电量电费] IS NOT NULL 
                              AND [力调电费] IS NOT NULL 
                              AND [基金及附加] IS NOT NULL 
                              AND [上网线损费用] IS NOT NULL 
                              AND [系统运行费用] IS NOT NULL 
                              AND [环境价值费用] IS NOT NULL), 0) AS 毛利润
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 4. 单年查询（如"2025年四方坪毛利润是多少"）
        if (timeInfo.year && !timeInfo.month && !isWhichYearQuery && !isMostQuery) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const chargingIncome = buildChargingIncomeQuery(startDate, endDate);
            
            const sql = `
                SELECT 
                    (${chargingIncome}) -
                    ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] +
                                       [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局] 
                            WHERE [年] = ${year} 
                              AND ${transformerCondition} 
                              AND [购电费] IS NOT NULL 
                              AND [输配电量电费] IS NOT NULL 
                              AND [力调电费] IS NOT NULL 
                              AND [基金及附加] IS NOT NULL 
                              AND [上网线损费用] IS NOT NULL 
                              AND [系统运行费用] IS NOT NULL 
                              AND [环境价值费用] IS NOT NULL), 0) AS 毛利润
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 5. 每年查询（按年份分组，如"每年四方坪毛利润"或"四方坪哪一年的毛利润最多"）
        const yearlyBaseSql = `
            SELECT
                c.年,
                c.充电收入 - ISNULL(p.电费, 0) AS 毛利润
            FROM (
                SELECT
                    年,
                    SUM(金额) AS 充电收入
                FROM (
                    SELECT
                        YEAR([充电结束时间]) AS 年,
                        SUM([充电费用(元)]) AS 金额
                    FROM [特来电]
                    WHERE [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0
                      ${telaidianStationCondition}
                    GROUP BY YEAR([充电结束时间])
                    UNION ALL
                    SELECT
                        YEAR([结束日期时间]) AS 年,
                        SUM([消费金额]) AS 金额
                    FROM [能科]
                    WHERE [消费金额] IS NOT NULL AND [消费金额] > 0
                    GROUP BY YEAR([结束日期时间])
                    UNION ALL
                    SELECT
                        YEAR([充电完成时间]) AS 年,
                        SUM(CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)) AS 金额
                    FROM [滴滴]
                    WHERE [订单总额（元）] IS NOT NULL
                      AND LTRIM(RTRIM([订单总额（元）])) != ''
                      AND ISNUMERIC([订单总额（元）]) = 1
                      AND CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT) > 0
                      AND YEAR([充电完成时间]) >= 2025
                    GROUP BY YEAR([充电完成时间])
                ) t
                GROUP BY 年
            ) c
            LEFT JOIN (
                SELECT
                    [年],
                    SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] +
                        [上网线损费用] + [系统运行费用] + [环境价值费用]) AS 电费
                FROM [电力局]
                WHERE ${transformerCondition}
                  AND [购电费] IS NOT NULL
                  AND [输配电量电费] IS NOT NULL
                  AND [力调电费] IS NOT NULL
                  AND [基金及附加] IS NOT NULL
                  AND [上网线损费用] IS NOT NULL
                  AND [系统运行费用] IS NOT NULL
                  AND [环境价值费用] IS NOT NULL
                GROUP BY [年]
            ) p ON p.[年] = c.年
        `;

        // "四方坪哪一年的充电毛利最多？" -> 取毛利润最大的那一年
        // 注意：如果查询中包含"月"关键词，说明是按月查询，不应该在这里处理
        const hasMonthKeyword = message.includes('月') || message.includes('每个月') || message.includes('每月');
        if ((isWhichYearQuery || isMostQuery || isLeastQuery) && !hasMonthKeyword) {
            const wrapped = `
                SELECT TOP 1 *
                FROM (
                    ${yearlyBaseSql}
                ) AS x
                ORDER BY x.毛利润 DESC
            `;
            return wrapped.replace(/\s+/g, ' ').trim();
        }

        // 其他带"毛利润"的问题（如"每年四方坪毛利润"）直接返回每年明细
        return yearlyBaseSql.replace(/\s+/g, ' ').trim();
    }

    // 特殊处理：电量损耗（电力局电量 - 充电电量）
    // 只在包含"电量损耗"且明确地点（目前处理四方坪 / 高岭）时启用
    const hasPowerLoss = message.includes('电量损耗');
    if (hasPowerLoss && (message.includes('四方坪') || message.includes('高岭'))) {
        debugLog('检测到电量损耗专项计算逻辑');

        // 根据地点设置变压器编号和特来电电站筛选条件
        let transformerCondition = '';
        let telaidianStationCondition = '';

        if (message.includes('四方坪')) {
            // 四方坪：电力局使用两个变压器，特来电排除高岭电站
            transformerCondition = "([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')";
            telaidianStationCondition =
                "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'" +
                " AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
        } else if (message.includes('高岭')) {
            // 高岭：电力局使用一个变压器，特来电只查询高岭电站
            transformerCondition = "([变压器编号] = '4350001671599')";
            telaidianStationCondition =
                "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%'" +
                " OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
        }

        // 检测查询类型
        // 平均每天和每天平均都需要根据时间计算天数
        const isAveragePerDay = (message.includes('平均') && message.includes('每天')) || message.includes('每天平均');
        const isAveragePerMonth = message.includes('平均') && (message.includes('每月') || message.includes('每个月'));
        const isPerDay = !message.includes('平均') && message.includes('每天') && !message.includes('每天平均');
        const isPerMonth = !message.includes('平均') && (message.includes('每月') || message.includes('每个月'));
        const isWhichMonth = message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月');
        const isMost = message.includes('最多') || message.includes('最大') || message.includes('最高');
        const isLeast = message.includes('最少') || message.includes('最小') || message.includes('最低');

        // 应用时间过滤规则：根据时间信息决定需要查询哪些充电表
        const shouldQueryTelaidian = tables.includes('特来电');
        const shouldQueryNengke = tables.includes('能科');
        const shouldQueryDidi = tables.includes('滴滴');

        // 构建充电电量查询部分
        const buildChargingPowerQuery = (startDate, endDate) => {
            const chargingParts = [];
            
            if (shouldQueryTelaidian) {
                chargingParts.push(`
                    ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] 
                            WHERE [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}' 
                              AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 
                              ${telaidianStationCondition}), 0)
                `);
            }
            
            if (shouldQueryNengke) {
                chargingParts.push(`
                    ISNULL((SELECT SUM([充电量]) FROM [能科] 
                            WHERE [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}' 
                              AND [充电量] IS NOT NULL AND [充电量] > 0), 0)
                `);
            }
            
            if (shouldQueryDidi) {
                chargingParts.push(`
                    ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴] 
                            WHERE [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}' 
                              AND [充电量（度）] IS NOT NULL 
                              AND LTRIM(RTRIM([充电量（度）])) != '' 
                              AND ISNUMERIC([充电量（度）]) = 1 
                              AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0), 0)
                `);
            }
            
            return chargingParts.length > 0 ? chargingParts.join(' + ') : '0';
        };

        // 1. 平均每天查询（如"2025年12月四方坪平均每天电量损耗多少"）
        if (isAveragePerDay && timeInfo.year && timeInfo.month) {
            const year = timeInfo.year;
            const month = timeInfo.month;
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            const daysInMonth = new Date(year, month, 0).getDate();

            const chargingPower = buildChargingPowerQuery(startDate, endDate);
            
            const sql = `
                SELECT (
                    ISNULL((SELECT SUM([电量]) FROM [电力局] 
                            WHERE [年] = ${year} AND [月] = ${month} 
                              AND ${transformerCondition} 
                              AND [电量] IS NOT NULL AND [电量] > 0), 0) -
                    (${chargingPower})
                ) / ${daysInMonth} AS 平均每天电量损耗
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 1.5. 某年的平均每天查询（如"2025年四方坪平均每天电量损耗多少"）
        if (isAveragePerDay && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;
            // 计算该年的天数（闰年366天，平年365天）
            const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            const daysInYear = isLeapYear ? 366 : 365;

            const chargingPower = buildChargingPowerQuery(startDate, endDate);
            
            const sql = `
                SELECT (
                    ISNULL((SELECT SUM([电量]) FROM [电力局] 
                            WHERE [年] = ${year} 
                              AND ${transformerCondition} 
                              AND [电量] IS NOT NULL AND [电量] > 0), 0) -
                    (${chargingPower})
                ) / ${daysInYear} AS 平均每天电量损耗
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 2. 平均每月查询（如"2025年四方坪平均每月电量损耗多少"）
        if (isAveragePerMonth && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const chargingPower = buildChargingPowerQuery(startDate, endDate);
            
            const sql = `
                SELECT (
                    ISNULL((SELECT SUM([电量]) FROM [电力局] 
                            WHERE [年] = ${year} 
                              AND ${transformerCondition} 
                              AND [电量] IS NOT NULL AND [电量] > 0), 0) -
                    (${chargingPower})
                ) / 12.0 AS 平均每月电量损耗
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 3. 每天查询（如"2025年12月四方坪每天电量损耗多少"）
        // 注意：电力局只有月数据，不能直接计算每一天，所以返回该月的平均每天
        if (isPerDay && timeInfo.year && timeInfo.month) {
            const year = timeInfo.year;
            const month = timeInfo.month;
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            const daysInMonth = new Date(year, month, 0).getDate();

            const chargingPower = buildChargingPowerQuery(startDate, endDate);
            
            const sql = `
                SELECT (
                    ISNULL((SELECT SUM([电量]) FROM [电力局] 
                            WHERE [年] = ${year} AND [月] = ${month} 
                              AND ${transformerCondition} 
                              AND [电量] IS NOT NULL AND [电量] > 0), 0) -
                    (${chargingPower})
                ) / ${daysInMonth} AS 每天电量损耗
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 4. 每月查询（按月份分组，如"2025年四方坪每月电量损耗"或"2025年四方坪哪一月的电量损耗最多"或"2025年四方坪最高的3个月"）
        if ((isPerMonth || isWhichMonth || isMost || isLeast) && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            // 构建充电电量按月份分组的子查询
            const chargingParts = [];
            if (shouldQueryTelaidian) {
                chargingParts.push(`
                    SELECT 
                        YEAR([充电结束时间]) AS 年,
                        MONTH([充电结束时间]) AS 月,
                        SUM([充电电量(度)]) AS 充电电量
                    FROM [特来电]
                    WHERE [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}'
                      AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
                      ${telaidianStationCondition}
                    GROUP BY YEAR([充电结束时间]), MONTH([充电结束时间])
                `);
            }
            if (shouldQueryNengke) {
                chargingParts.push(`
                    SELECT 
                        YEAR([结束日期时间]) AS 年,
                        MONTH([结束日期时间]) AS 月,
                        SUM([充电量]) AS 充电电量
                    FROM [能科]
                    WHERE [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}'
                      AND [充电量] IS NOT NULL AND [充电量] > 0
                    GROUP BY YEAR([结束日期时间]), MONTH([结束日期时间])
                `);
            }
            if (shouldQueryDidi) {
                chargingParts.push(`
                    SELECT 
                        YEAR([充电完成时间]) AS 年,
                        MONTH([充电完成时间]) AS 月,
                        SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) AS 充电电量
                    FROM [滴滴]
                    WHERE [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}'
                      AND [充电量（度）] IS NOT NULL 
                      AND LTRIM(RTRIM([充电量（度）])) != '' 
                      AND ISNUMERIC([充电量（度）]) = 1 
                      AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
                    GROUP BY YEAR([充电完成时间]), MONTH([充电完成时间])
                `);
            }

            // 构建按月份分组的SQL
            const monthlyBaseSql = `
                SELECT 
                    p.[年],
                    p.[月],
                    p.电力局电量 - ISNULL(c.充电电量, 0) AS 电量损耗
                FROM (
                    SELECT 
                        [年],
                        [月],
                        SUM([电量]) AS 电力局电量
                    FROM [电力局]
                    WHERE [年] = ${year}
                      AND ${transformerCondition}
                      AND [电量] IS NOT NULL AND [电量] > 0
                    GROUP BY [年], [月]
                ) p
                LEFT JOIN (
                    SELECT 
                        年,
                        月,
                        SUM(充电电量) AS 充电电量
                    FROM (
                        ${chargingParts.length > 0 ? chargingParts.join(' UNION ALL ') : 'SELECT 0 AS 年, 0 AS 月, 0 AS 充电电量 WHERE 1=0'}
                    ) t
                    GROUP BY 年, 月
                ) c ON c.年 = p.[年] AND c.月 = p.[月]
            `;

            // 如果查询"哪一月"或"最高的多少个月"，需要按排名返回
            if (isWhichMonth || isMost || isLeast) {
                // 提取月份数
                let topN = 1;
                const monthMatch = message.match(/(\d+)\s*个*月/);
                if (monthMatch) {
                    topN = parseInt(monthMatch[1]);
                } else if (message.includes('前几') || message.includes('前')) {
                    topN = 5; // 默认前5
                } else if (!isWhichMonth) {
                    topN = 3; // 如果是"最高的几个月"但没有指定数字，默认前3
                }

                const orderDir = isLeast ? 'ASC' : 'DESC';
                const wrapped = `
                    SELECT TOP ${topN} *
                    FROM (
                        ${monthlyBaseSql}
                    ) AS x
                    ORDER BY x.电量损耗 ${orderDir}
                `;
                return wrapped.replace(/\s+/g, ' ').trim();
            }

            // 否则返回每月明细
            return monthlyBaseSql.replace(/\s+/g, ' ').trim();
        }

        // 5. 单月查询（如"2025年12月四方坪电量损耗是多少"）
        if (timeInfo.year && timeInfo.month) {
            const year = timeInfo.year;
            const month = timeInfo.month;
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

            const chargingPower = buildChargingPowerQuery(startDate, endDate);
            
            const sql = `
                SELECT 
                    ISNULL((SELECT SUM([电量]) FROM [电力局] 
                            WHERE [年] = ${year} AND [月] = ${month} 
                              AND ${transformerCondition} 
                              AND [电量] IS NOT NULL AND [电量] > 0), 0) -
                    (${chargingPower}) AS 电量损耗
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 6. 单年查询（如"2025年四方坪电量损耗是多少"）
        if (timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const chargingPower = buildChargingPowerQuery(startDate, endDate);
            
            const sql = `
                SELECT 
                    ISNULL((SELECT SUM([电量]) FROM [电力局] 
                            WHERE [年] = ${year} 
                              AND ${transformerCondition} 
                              AND [电量] IS NOT NULL AND [电量] > 0), 0) -
                    (${chargingPower}) AS 电量损耗
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 7. 没有年份的"哪一月"查询（如"四方坪哪一月的电量损耗最多"）
        if (isWhichMonth && !timeInfo.year) {
            // 构建充电电量按月份分组的子查询（不限制年份）
            const chargingParts = [];
            if (shouldQueryTelaidian) {
                chargingParts.push(`
                    SELECT 
                        YEAR([充电结束时间]) AS 年,
                        MONTH([充电结束时间]) AS 月,
                        SUM([充电电量(度)]) AS 充电电量
                    FROM [特来电]
                    WHERE [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
                      ${telaidianStationCondition}
                    GROUP BY YEAR([充电结束时间]), MONTH([充电结束时间])
                `);
            }
            if (shouldQueryNengke) {
                chargingParts.push(`
                    SELECT 
                        YEAR([结束日期时间]) AS 年,
                        MONTH([结束日期时间]) AS 月,
                        SUM([充电量]) AS 充电电量
                    FROM [能科]
                    WHERE [充电量] IS NOT NULL AND [充电量] > 0
                    GROUP BY YEAR([结束日期时间]), MONTH([结束日期时间])
                `);
            }
            if (shouldQueryDidi) {
                chargingParts.push(`
                    SELECT 
                        YEAR([充电完成时间]) AS 年,
                        MONTH([充电完成时间]) AS 月,
                        SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) AS 充电电量
                    FROM [滴滴]
                    WHERE [充电量（度）] IS NOT NULL 
                      AND LTRIM(RTRIM([充电量（度）])) != '' 
                      AND ISNUMERIC([充电量（度）]) = 1 
                      AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
                    GROUP BY YEAR([充电完成时间]), MONTH([充电完成时间])
                `);
            }

            // 构建按月份分组的SQL（不限制年份）
            const monthlyBaseSql = `
                SELECT 
                    p.[年],
                    p.[月],
                    p.电力局电量 - ISNULL(c.充电电量, 0) AS 电量损耗
                FROM (
                    SELECT 
                        [年],
                        [月],
                        SUM([电量]) AS 电力局电量
                    FROM [电力局]
                    WHERE ${transformerCondition}
                      AND [电量] IS NOT NULL AND [电量] > 0
                    GROUP BY [年], [月]
                ) p
                LEFT JOIN (
                    SELECT 
                        年,
                        月,
                        SUM(充电电量) AS 充电电量
                    FROM (
                        ${chargingParts.length > 0 ? chargingParts.join(' UNION ALL ') : 'SELECT 0 AS 年, 0 AS 月, 0 AS 充电电量 WHERE 1=0'}
                    ) t
                    GROUP BY 年, 月
                ) c ON c.年 = p.[年] AND c.月 = p.[月]
            `;

            // 找出电量损耗最多的月份
            const wrapped = `
                SELECT TOP 1 *
                FROM (
                    ${monthlyBaseSql}
                ) AS x
                ORDER BY x.电量损耗 DESC
            `;
            return wrapped.replace(/\s+/g, ' ').trim();
        }
    }

    // 特殊处理：综合业务收入/金额/流水
    // 只在包含"综合业务收入"、"综合业务金额"、"综合业务流水"、"综合收入"时启用
    // 但注意：如果包含"充电"关键词，应该查询充电表，而不是综合业务收入表
    const hasComprehensiveBusiness = (message.includes('综合业务收入') || message.includes('综合业务金额') || message.includes('综合业务流水') || message.includes('综合收入')) && !message.includes('充电');
    if (hasComprehensiveBusiness) {
        debugLog('检测到综合业务专项计算逻辑');
        
        // 根据问题中的关键词决定输出字段名
        let outputFieldName = '综合业务收入'; // 默认
        if (message.includes('综合收入') && !message.includes('综合业务收入')) {
            outputFieldName = '综合收入';
        } else if (message.includes('综合业务金额')) {
            outputFieldName = '综合业务金额';
        } else if (message.includes('综合业务流水')) {
            outputFieldName = '综合业务流水';
        }

        // 定义综合业务表配置
        const comprehensiveBusinessTables = {
            // 四方坪：10个表
            sifangping: [
                { name: '车海洋洗车充值', field: '[返还金额]', timeField: '[时间]', whereCondition: '[返还金额] IS NOT NULL AND [返还金额] > 0' },
                { name: '车海洋洗车消费', field: '[返还金额]', timeField: '[时间]', whereCondition: '[返还金额] IS NOT NULL' },
                { name: '红门缴费', field: '[交易金额]', timeField: '[缴费时间]', whereCondition: '[交易金额] IS NOT NULL AND [交易金额] > 0' },
                { name: '赛菲姆道闸', field: '[支付金额]', timeField: '[支付时间]', whereCondition: '[支付金额] IS NOT NULL AND [支付金额] > 0 AND LTRIM(RTRIM([支付方式])) NOT IN (\'线下现金\', \'平台现金支付\') AND [支付方式] IS NOT NULL' },
                { name: '收钱吧', field: '[实收金额]', timeField: '[交易日期]', whereCondition: '[实收金额] IS NOT NULL AND [实收金额] > 0 AND [交易状态] = \'成功\'' },
                { name: '兴元售货机', field: '([支付金额] - ISNULL([退款金额], 0))', timeField: '[支付时间]', whereCondition: '[支付金额] IS NOT NULL AND ([支付金额] - ISNULL([退款金额], 0)) > 0 AND [机器名称] NOT LIKE \'%高岭%\'' },
                { name: '微信商户下单', field: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', timeField: '[交易时间]', whereCondition: '[订单金额] IS NOT NULL AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0' },
                { name: '微信收款商业版', field: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', timeField: '[交易时间]', whereCondition: '[订单金额] IS NOT NULL AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0' },
                { name: '月租车充值', field: '[交款金额]', timeField: '[交款时间]', whereCondition: '[交款金额] IS NOT NULL AND [交款金额] > 0' },
                { name: '智小盟', field: '[实收金额]', timeField: '[支付时间]', whereCondition: '[实收金额] IS NOT NULL AND [实收金额] > 0' }
            ],
            // 高岭：4个表
            gaoling: [
                { name: '快易洁洗车', field: '[返还总额]', timeField: '[日期]', whereCondition: '[返还总额] IS NOT NULL AND [返还总额] > 0' },
                { name: '车颜知己洗车', field: "(CASE WHEN [使用会员卡] = '否' AND [订单状态] = '已完成' THEN CAST([订单金额] AS FLOAT) WHEN [使用会员卡] = '是' AND [订单状态] = '已完成' THEN 7 ELSE 0 END)", timeField: '[启动时间]', whereCondition: "[订单状态] = '已完成' AND ([使用会员卡] = '否' OR [使用会员卡] = '是')" },
                { name: '超时占位费', field: 'CAST([应收金额] AS FLOAT)', timeField: '[支付时间]', whereCondition: '[应收金额] IS NOT NULL AND LTRIM(RTRIM([应收金额])) != \'\' AND ISNUMERIC([应收金额]) = 1 AND CAST([应收金额] AS FLOAT) > 0' },
                { name: '兴元售货机', field: '([支付金额] - ISNULL([退款金额], 0))', timeField: '[支付时间]', whereCondition: '[支付金额] IS NOT NULL AND ([支付金额] - ISNULL([退款金额], 0)) > 0 AND [机器名称] LIKE \'%高岭%\'' }
            ],
            // 全部：13个表
            all: [
                { name: '车海洋洗车充值', field: '[返还金额]', timeField: '[时间]', whereCondition: '[返还金额] IS NOT NULL AND [返还金额] > 0' },
                { name: '车海洋洗车消费', field: '[返还金额]', timeField: '[时间]', whereCondition: '[返还金额] IS NOT NULL' },
                { name: '车颜知己洗车', field: "(CASE WHEN [使用会员卡] = '否' AND [订单状态] = '已完成' THEN CAST([订单金额] AS FLOAT) WHEN [使用会员卡] = '是' AND [订单状态] = '已完成' THEN 7 ELSE 0 END)", timeField: '[启动时间]', whereCondition: "[订单状态] = '已完成' AND ([使用会员卡] = '否' OR [使用会员卡] = '是')" },
                { name: '红门缴费', field: '[交易金额]', timeField: '[缴费时间]', whereCondition: '[交易金额] IS NOT NULL AND [交易金额] > 0' },
                { name: '快易洁洗车', field: '[返还总额]', timeField: '[日期]', whereCondition: '[返还总额] IS NOT NULL AND [返还总额] > 0' },
                { name: '赛菲姆道闸', field: '[支付金额]', timeField: '[支付时间]', whereCondition: '[支付金额] IS NOT NULL AND [支付金额] > 0 AND LTRIM(RTRIM([支付方式])) NOT IN (\'线下现金\', \'平台现金支付\') AND [支付方式] IS NOT NULL' },
                { name: '收钱吧', field: '[实收金额]', timeField: '[交易日期]', whereCondition: '[实收金额] IS NOT NULL AND [实收金额] > 0 AND [交易状态] = \'成功\'' },
                { name: '兴元售货机', field: '([支付金额] - ISNULL([退款金额], 0))', timeField: '[支付时间]', whereCondition: '[支付金额] IS NOT NULL AND ([支付金额] - ISNULL([退款金额], 0)) > 0' },
                { name: '微信商户下单', field: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', timeField: '[交易时间]', whereCondition: '[订单金额] IS NOT NULL AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0' },
                { name: '微信收款商业版', field: '(CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))', timeField: '[交易时间]', whereCondition: '[订单金额] IS NOT NULL AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0' },
                { name: '月租车充值', field: '[交款金额]', timeField: '[交款时间]', whereCondition: '[交款金额] IS NOT NULL AND [交款金额] > 0' },
                { name: '智小盟', field: '[实收金额]', timeField: '[支付时间]', whereCondition: '[实收金额] IS NOT NULL AND [实收金额] > 0' },
                { name: '超时占位费', field: 'CAST([应收金额] AS FLOAT)', timeField: '[支付时间]', whereCondition: '[应收金额] IS NOT NULL AND LTRIM(RTRIM([应收金额])) != \'\' AND ISNUMERIC([应收金额]) = 1 AND CAST([应收金额] AS FLOAT) > 0' }
            ]
        };

        // 确定查询哪些表
        let targetTables = [];
        if (message.includes('四方坪')) {
            targetTables = comprehensiveBusinessTables.sifangping;
        } else if (message.includes('高岭')) {
            targetTables = comprehensiveBusinessTables.gaoling;
        } else {
            targetTables = comprehensiveBusinessTables.all;
        }

        // 检测查询类型
        const isDetail = message.includes('明细') || message.includes('列出') || message.includes('各项');
        const isAveragePerDay = message.includes('平均') && message.includes('每天');
        const isAveragePerMonth = message.includes('平均') && (message.includes('每月') || message.includes('每个月'));
        const isPerDay = !message.includes('平均') && message.includes('每天');
        const isPerMonth = !message.includes('平均') && (message.includes('每月') || message.includes('每个月'));
        const isWhichDay = message.includes('哪一天') || message.includes('哪一日') || message.includes('哪天') || message.includes('哪日');
        const isWhichMonth = message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月');
        const isMost = message.includes('最多') || message.includes('最大') || message.includes('最高');
        const isLeast = message.includes('最少') || message.includes('最小') || message.includes('最低');

        // 构建单个表的收入查询
        const buildTableQuery = (tableConfig, startDate, endDate, isDateGroup = false) => {
            const { name, field, timeField, whereCondition } = tableConfig;
            if (isDateGroup) {
                // 按日期分组
                return `
                    SELECT 
                        CAST(${timeField} AS DATE) AS 日期,
                        SUM(${field}) AS 收入
                    FROM [${name}]
                    WHERE ${whereCondition}
                      AND ${timeField} >= '${startDate}' AND ${timeField} < '${endDate}'
                    GROUP BY CAST(${timeField} AS DATE)
                `;
            } else {
                // 总和查询
                return `
                    ISNULL((SELECT SUM(${field}) FROM [${name}] 
                            WHERE ${whereCondition}
                              AND ${timeField} >= '${startDate}' AND ${timeField} < '${endDate}'), 0)
                `;
            }
        };

        // 构建所有表的总和查询
        const buildTotalQuery = (startDate, endDate) => {
            const parts = targetTables.map(table => buildTableQuery(table, startDate, endDate, false));
            return parts.join(' + ');
        };

        // 1. 平均每天查询
        if (isAveragePerDay && timeInfo.year) {
            const year = timeInfo.year;
            let startDate, endDate, days;
            
            if (timeInfo.month) {
                // 有月份：计算该月的平均每天（如"2025年12月四方坪平均每天综合业务收入多少"）
                const month = timeInfo.month;
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const nextMonth = month === 12 ? 1 : month + 1;
                const nextYear = month === 12 ? year + 1 : year;
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
                days = new Date(year, month, 0).getDate();
            } else {
                // 只有年份：计算整年的平均每天（如"2025年四方坪平均每天综合业务收入多少"）
                startDate = `${year}-01-01`;
                endDate = `${year + 1}-01-01`;
                // 计算该年的天数（闰年366天，平年365天）
                const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                days = isLeapYear ? 366 : 365;
            }

            const totalQuery = buildTotalQuery(startDate, endDate);
            const sql = `SELECT (${totalQuery}) / ${days} AS 平均每天${outputFieldName}`;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 2. 平均每月查询（如"2025年四方坪平均每月综合业务收入多少"）
        if (isAveragePerMonth && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const totalQuery = buildTotalQuery(startDate, endDate);
            const sql = `SELECT (${totalQuery}) / 12.0 AS 平均每月${outputFieldName}`;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 3. 每天查询（如"2025年12月四方坪每天综合业务收入"或"2025年四方坪每天综合业务收入"）
        if (isPerDay && timeInfo.year) {
            let startDate, endDate;

            if (timeInfo.month) {
                // 有月份：查询该月的每天（如"2025年12月四方坪每天综合业务收入"）
                const year = timeInfo.year;
                const month = timeInfo.month;
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const nextMonth = month === 12 ? 1 : month + 1;
                const nextYear = month === 12 ? year + 1 : year;
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            } else {
                // 只有年份：查询整年的每天（如"2025年四方坪每天综合业务收入"）
                const year = timeInfo.year;
                startDate = `${year}-01-01`;
                endDate = `${year + 1}-01-01`;
            }

            // 按日期分组
            const dateGroupQueries = targetTables.map(table => buildTableQuery(table, startDate, endDate, true));
            const unionQuery = dateGroupQueries.join(' UNION ALL ');

            const sql = `
                SELECT
                    日期,
                    SUM(收入) AS ${outputFieldName}
                FROM (
                    ${unionQuery}
                ) AS t
                GROUP BY 日期
                ORDER BY 日期
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 4. 每月查询（如"2025年四方坪每月综合业务收入"）
        if (isPerMonth && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            // 如果是明细查询，显示每个表的明细
            if (isDetail) {
                // 按月份和表名分组，显示明细
                const monthGroupQueries = targetTables.map(table => {
                    const { name, field, timeField, whereCondition } = table;
                    return `
                        SELECT 
                            CAST(YEAR(${timeField}) AS INT) AS 年,
                            CAST(MONTH(${timeField}) AS INT) AS 月,
                            '${name}' AS 表名,
                            ROUND(SUM(${field}), 2) AS 收入
                        FROM [${name}]
                        WHERE ${whereCondition}
                          AND ${timeField} >= '${startDate}' AND ${timeField} < '${endDate}'
                        GROUP BY YEAR(${timeField}), MONTH(${timeField})
                    `;
                });
                const unionQuery = monthGroupQueries.join(' UNION ALL ');

                const sql = `
                    SELECT 
                        年,
                        月,
                        表名,
                        收入
                    FROM (
                        ${unionQuery}
                    ) AS t
                    ORDER BY 年, 月, 表名
                `;
                return sql.replace(/\s+/g, ' ').trim();
            } else {
                // 按月份分组，显示汇总
                const monthGroupQueries = targetTables.map(table => {
                    const { name, field, timeField, whereCondition } = table;
                    return `
                        SELECT 
                            YEAR(${timeField}) AS 年,
                            MONTH(${timeField}) AS 月,
                            SUM(${field}) AS 收入
                        FROM [${name}]
                        WHERE ${whereCondition}
                          AND ${timeField} >= '${startDate}' AND ${timeField} < '${endDate}'
                        GROUP BY YEAR(${timeField}), MONTH(${timeField})
                    `;
                });
                const unionQuery = monthGroupQueries.join(' UNION ALL ');

                const sql = `
                    SELECT 
                        CAST(年 AS INT) AS 年,
                        CAST(月 AS INT) AS 月,
                        ROUND(SUM(收入), 2) AS ${outputFieldName}
                    FROM (
                        ${unionQuery}
                    ) AS t
                    GROUP BY 年, 月
                    ORDER BY 年, 月
                `;
                return sql.replace(/\s+/g, ' ').trim();
            }
        }

        // 5. 哪一天查询（如"2025年12月四方坪哪一天综合业务收入最多"或"2025年四方坪哪一天综合业务收入最多"）
        if (isWhichDay && timeInfo.year) {
            const year = timeInfo.year;
            let startDate, endDate;
            
            if (timeInfo.month) {
                // 有月份：查询该月内哪一天最多
            const month = timeInfo.month;
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            } else {
                // 只有年份：查询整年内哪一天最多
                startDate = `${year}-01-01`;
                endDate = `${year + 1}-01-01`;
            }

            const dateGroupQueries = targetTables.map(table => buildTableQuery(table, startDate, endDate, true));
            const unionQuery = dateGroupQueries.join(' UNION ALL ');

            const orderDir = isLeast ? 'ASC' : 'DESC';
            const sql = `
                SELECT TOP 1
                    日期,
                    SUM(收入) AS ${outputFieldName}
                FROM (
                    ${unionQuery}
                ) AS t
                GROUP BY 日期
                ORDER BY SUM(收入) ${orderDir}
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 6. 哪一月查询（如"2025年四方坪哪一月综合业务收入最多"）
        if (isWhichMonth && timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const monthGroupQueries = targetTables.map(table => {
                const { name, field, timeField, whereCondition } = table;
                return `
                    SELECT
                        YEAR(${timeField}) AS 年,
                        MONTH(${timeField}) AS 月,
                        SUM(${field}) AS 收入
                    FROM [${name}]
                    WHERE ${whereCondition}
                      AND ${timeField} >= '${startDate}' AND ${timeField} < '${endDate}'
                    GROUP BY YEAR(${timeField}), MONTH(${timeField})
                `;
            });
            const unionQuery = monthGroupQueries.join(' UNION ALL ');

            const orderDir = isLeast ? 'ASC' : 'DESC';
            const sql = `
                SELECT TOP 1
                    CAST(年 AS INT) AS 年,
                    CAST(月 AS INT) AS 月,
                    SUM(收入) AS ${outputFieldName}
                FROM (
                    ${unionQuery}
                ) AS t
                GROUP BY 年, 月
                ORDER BY SUM(收入) ${orderDir}
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 6.5. 最高的多少天查询（如"2025年四方坪综合业务收入最高的5天"或"2025年四方坪综合业务收入最低的10天"）
        if ((isMost || isLeast) && message.includes('天') && !isWhichDay) {
            // 提取天数
            let topN = 1;
            const dayMatch = message.match(/(\d+)\s*天/);
            if (dayMatch) {
                topN = parseInt(dayMatch[1]);
            } else if (message.includes('前几') || message.includes('前')) {
                topN = 5; // 默认前5
            }

            let startDate, endDate;
            if (timeInfo.year && timeInfo.month) {
                // 有月份：查询该月的top N天
                const year = timeInfo.year;
                const month = timeInfo.month;
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const nextMonth = month === 12 ? 1 : month + 1;
                const nextYear = month === 12 ? year + 1 : year;
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            } else if (timeInfo.year) {
                // 只有年份：查询整年的top N天
                const year = timeInfo.year;
                startDate = `${year}-01-01`;
                endDate = `${year + 1}-01-01`;
            } else {
                // 没有时间信息，返回错误
                return null;
            }

            const dateGroupQueries = targetTables.map(table => buildTableQuery(table, startDate, endDate, true));
            const unionQuery = dateGroupQueries.join(' UNION ALL ');

            const orderDir = isLeast ? 'ASC' : 'DESC';
            const sql = `
                SELECT TOP ${topN}
                    日期,
                    SUM(收入) AS ${outputFieldName}
                FROM (
                    ${unionQuery}
                ) AS t
                GROUP BY 日期
                ORDER BY SUM(收入) ${orderDir}
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 7. 明细查询（如"请列出2025年四方坪综合业务收入的各项明细"或"2025年12月1日四方坪综合业务收入明细"）
        if (isDetail && timeInfo.hasTime) {
            let startDate, endDate;
            
            if (timeInfo.year && timeInfo.month && timeInfo.day) {
                // 单日明细（如"2025年12月1日四方坪综合业务收入明细"）
                const year = timeInfo.year;
                const month = timeInfo.month;
                const day = timeInfo.day;
                startDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                // 单日查询：使用日期范围，endDate为次日
                const date = new Date(year, month - 1, day);
                date.setDate(date.getDate() + 1);
                const nextYear = date.getFullYear();
                const nextMonth = date.getMonth() + 1;
                const nextDay = date.getDate();
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
            } else if (timeInfo.year && timeInfo.month) {
                // 单月明细
                const year = timeInfo.year;
                const month = timeInfo.month;
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const nextMonth = month === 12 ? 1 : month + 1;
                const nextYear = month === 12 ? year + 1 : year;
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            } else if (timeInfo.year) {
                // 单年明细
                const year = timeInfo.year;
                startDate = `${year}-01-01`;
                endDate = `${year + 1}-01-01`;
            } else if (timeInfo.startDate && timeInfo.endDate) {
                // 日期范围明细
                startDate = timeInfo.startDate;
                endDate = timeInfo.endDate;
            } else {
                // 没有时间信息，查询所有数据
                startDate = null;
                endDate = null;
            }

            // 构建每个表的明细查询
            const detailQueries = targetTables.map(table => {
                const { name, field, timeField, whereCondition } = table;
                let timeCondition = '';
                if (startDate && endDate) {
                    timeCondition = ` AND ${timeField} >= '${startDate}' AND ${timeField} < '${endDate}'`;
                } else if (startDate) {
                    timeCondition = ` AND ${timeField} >= '${startDate}'`;
                } else if (endDate) {
                    timeCondition = ` AND ${timeField} < '${endDate}'`;
                }

                return `
                    SELECT 
                        '${name}' AS 表名,
                        ISNULL(SUM(${field}), 0) AS 收入
                    FROM [${name}]
                    WHERE ${whereCondition}${timeCondition}
                `;
            });

            const unionQuery = detailQueries.join(' UNION ALL ');

            const sql = `
                SELECT 
                    表名,
                    收入
                FROM (
                    ${unionQuery}
                ) AS t
                ORDER BY 收入 DESC
            `;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 8. 时间范围查询（如"2025年2月至2025年6月四方坪综合业务收入是多少"）
        // 优先级高于单月/单年查询
        if (timeInfo.startDate && timeInfo.endDate && !isDetail) {
            const totalQuery = buildTotalQuery(timeInfo.startDate, timeInfo.endDate);
            const sql = `SELECT (${totalQuery}) AS ${outputFieldName}`;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 9. 单月查询（如"2025年12月四方坪综合业务收入是多少"）
        if (timeInfo.year && timeInfo.month && !timeInfo.startDate) {
            const year = timeInfo.year;
            const month = timeInfo.month;
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

            const totalQuery = buildTotalQuery(startDate, endDate);
            const sql = `SELECT (${totalQuery}) AS ${outputFieldName}`;
            return sql.replace(/\s+/g, ' ').trim();
        }

        // 10. 单年查询（如"2025年四方坪综合业务收入是多少"）
        if (timeInfo.year && !timeInfo.month && !timeInfo.startDate) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            const totalQuery = buildTotalQuery(startDate, endDate);
            const sql = `SELECT (${totalQuery}) AS ${outputFieldName}`;
            return sql.replace(/\s+/g, ' ').trim();
        }
    }

    // 特殊处理：平均每把枪的查询（数据 ÷ 时间 ÷ 对象）
    const hasGunOrTerminal = message.includes('枪') || message.includes('终端');
    const hasAverage = message.includes('平均');
    if (hasGunOrTerminal && hasAverage && timeInfo.hasTime) {
        debugLog('检测到平均每把枪查询，使用特殊处理');

        // 提取查询字段（充电电量、充电服务费、充电费用等）
        let queryField = null;
        let telaidianColumn = null;  // 用于SUM的字段（可能包含CAST转换）
        let telaidianRawColumn = null;  // 原始字段名（用于WHERE条件）
        let didiColumn = null;  // 用于SUM的字段（可能包含CAST转换）
        let didiRawColumn = null;  // 原始字段名（用于WHERE条件）

        if (message.includes('充电电量') || message.includes('电量')) {
            queryField = '充电电量';
            telaidianRawColumn = '[充电电量(度)]';
            telaidianColumn = '[充电电量(度)]';
            didiRawColumn = '[充电量（度）]';
            didiColumn = 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)';
        } else if (message.includes('充电服务费') || message.includes('服务费')) {
            queryField = '充电服务费';
            telaidianRawColumn = '[充电服务费(元)]';
            telaidianColumn = 'CAST(LTRIM(RTRIM([充电服务费(元)])) AS FLOAT)';
            didiRawColumn = '[充电服务费（元）]';
            didiColumn = 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)';
        } else if (message.includes('充电电费') || (message.includes('电费') && message.includes('充电'))) {
            queryField = '充电电费';
            telaidianRawColumn = '[充电电费(元)]';
            telaidianColumn = 'CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT)';
            didiRawColumn = '[充电电费（元）]';
            didiColumn = 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)';
        } else if (message.includes('充电费用') || message.includes('费用') || message.includes('收入') || message.includes('金额')) {
            queryField = '充电费用';
            telaidianRawColumn = '[充电费用(元)]';
            telaidianColumn = '[充电费用(元)]';
            didiRawColumn = '[订单总额（元）]';
            didiColumn = '[订单总额（元）]';
        } else if (message.includes('充电时长') || message.includes('时长')) {
            queryField = '充电时长';
            telaidianRawColumn = '[充电时长(分钟)]';
            telaidianColumn = 'CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT)';
            didiRawColumn = '[充电时长（分钟）]';
            didiColumn = '[充电时长（分钟）]';
        } else {
            // 默认查询充电电量
            queryField = '充电电量';
            telaidianRawColumn = '[充电电量(度)]';
            telaidianColumn = '[充电电量(度)]';
            didiRawColumn = '[充电量（度）]';
            didiColumn = 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)';
        }

        // 计算时间（天数或月数）
        let timeDivider = 1;
        const hasPerMonth = message.includes('每个月') || message.includes('每月');
        if (hasPerMonth) {
            // 按月计算
            if (timeInfo.year && !timeInfo.month) {
                timeDivider = 12; // 一年12个月
            } else if (timeInfo.month) {
                timeDivider = 1; // 单月
            }
        } else {
            // 按天计算
            if (timeInfo.year && timeInfo.month) {
                // 计算指定月份的天数
                const year = timeInfo.year;
                const month = timeInfo.month;
                const daysInMonth = new Date(year, month, 0).getDate();
                timeDivider = daysInMonth;
            } else if (timeInfo.year) {
                // 计算指定年份的天数（闰年366天，平年365天）
                const year = timeInfo.year;
                const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                timeDivider = isLeapYear ? 366 : 365;
            } else if (timeInfo.startDate && timeInfo.endDate) {
                // 计算日期范围的天数
                const start = new Date(timeInfo.startDate);
                const end = new Date(timeInfo.endDate);
                timeDivider = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            }
        }

        // 计算枪数（固定枪数）
        let gunCount = 142; // 默认四方坪2025年及以后
        if (message.includes('高岭')) {
            gunCount = 36;
        } else if (message.includes('四方坪') || !message.includes('高岭')) {
            // 四方坪或未指定地点（默认四方坪）
            if (timeInfo.year) {
                if (timeInfo.year === 2018) {
                    gunCount = 30;
                } else if (timeInfo.year === 2019) {
                    gunCount = 79;
                } else if (timeInfo.year >= 2020 && timeInfo.year <= 2024) {
                    gunCount = 172;
                } else if (timeInfo.year >= 2025) {
                    gunCount = 142;
                }
            }
        }

        // 构建WHERE条件（四方坪/高岭筛选）
        let telaidianWhere = '';
        let didiWhere = '';
        if (message.includes('四方坪')) {
            telaidianWhere = "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
            didiWhere = ''; // 滴滴表没有高岭站点，默认都是四方坪
        } else if (message.includes('高岭')) {
            telaidianWhere = "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
            didiWhere = ''; // 滴滴表没有高岭站点
        }

        // 构建时间WHERE条件
        let telaidianTimeWhere = '';
        let didiTimeWhere = '';
        if (timeInfo.year && timeInfo.month) {
            const startDate = `${timeInfo.year}-${String(timeInfo.month).padStart(2, '0')}-01`;
            const nextMonth = timeInfo.month === 12 ? 1 : timeInfo.month + 1;
            const nextYear = timeInfo.month === 12 ? timeInfo.year + 1 : timeInfo.year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            telaidianTimeWhere = `AND [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}'`;
            didiTimeWhere = `AND [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}'`;
        } else if (timeInfo.year) {
            telaidianTimeWhere = `AND [充电结束时间] >= '${timeInfo.year}-01-01' AND [充电结束时间] < '${timeInfo.year + 1}-01-01'`;
            didiTimeWhere = `AND [充电完成时间] >= '${timeInfo.year}-01-01' AND [充电完成时间] < '${timeInfo.year + 1}-01-01'`;
        } else if (timeInfo.startDate && timeInfo.endDate) {
            telaidianTimeWhere = `AND [充电结束时间] >= '${timeInfo.startDate}' AND [充电结束时间] <= '${timeInfo.endDate} 23:59:59'`;
            didiTimeWhere = `AND [充电完成时间] >= '${timeInfo.startDate}' AND [充电完成时间] <= '${timeInfo.endDate} 23:59:59'`;
        }

        // 根据应用时间过滤规则后的tables，决定查询哪些表
        const shouldQueryTelaidian = tables.includes('特来电');
        const shouldQueryDidi = tables.includes('滴滴');

        // 构建SQL
        let dataSum = '';

        // 构建特来电表的WHERE条件（根据查询字段类型）
        let telaidianWhereCondition = '';
        if (queryField === '充电电量') {
            // 充电电量字段可能是数值类型，直接判断
            telaidianWhereCondition = `${telaidianRawColumn} IS NOT NULL AND ${telaidianRawColumn} > 0`;
        } else if (queryField === '充电服务费') {
            // 充电服务费字段是nvarchar，需要特殊处理
            telaidianWhereCondition = `${telaidianRawColumn} IS NOT NULL AND LTRIM(RTRIM(${telaidianRawColumn})) != '' AND ISNUMERIC(${telaidianRawColumn}) = 1 AND ${telaidianColumn} > 0`;
        } else if (queryField === '充电电费') {
            // 充电电费字段是nvarchar，需要特殊处理
            telaidianWhereCondition = `${telaidianRawColumn} IS NOT NULL AND LTRIM(RTRIM(${telaidianRawColumn})) != '' AND ISNUMERIC(${telaidianRawColumn}) = 1 AND ${telaidianColumn} > 0`;
        } else if (queryField === '充电费用') {
            // 充电费用字段可能是数值类型，直接判断
            telaidianWhereCondition = `${telaidianRawColumn} IS NOT NULL AND ${telaidianRawColumn} > 0`;
        } else if (queryField === '充电时长') {
            // 充电时长字段是nvarchar，需要特殊处理
            telaidianWhereCondition = `${telaidianRawColumn} IS NOT NULL AND LTRIM(RTRIM(${telaidianRawColumn})) != '' AND ISNUMERIC(${telaidianRawColumn}) = 1 AND ${telaidianColumn} > 0`;
        } else {
            // 默认处理
            telaidianWhereCondition = `${telaidianRawColumn} IS NOT NULL AND ${telaidianRawColumn} > 0`;
        }

        // 构建滴滴表的WHERE条件（根据查询字段类型）
        let didiWhereCondition = '';
        if (queryField === '充电电量') {
            // 充电电量字段是nvarchar，需要特殊处理
            didiWhereCondition = `${didiRawColumn} IS NOT NULL AND LTRIM(RTRIM(${didiRawColumn})) != '' AND ISNUMERIC(${didiRawColumn}) = 1 AND ${didiColumn} > 0`;
        } else if (queryField === '充电服务费') {
            // 充电服务费字段是nvarchar，需要特殊处理
            didiWhereCondition = `${didiRawColumn} IS NOT NULL AND LTRIM(RTRIM(${didiRawColumn})) != '' AND ISNUMERIC(${didiRawColumn}) = 1 AND ${didiColumn} > 0`;
        } else if (queryField === '充电电费') {
            // 充电电费字段是nvarchar，需要特殊处理
            didiWhereCondition = `${didiRawColumn} IS NOT NULL AND LTRIM(RTRIM(${didiRawColumn})) != '' AND ISNUMERIC(${didiRawColumn}) = 1 AND ${didiColumn} > 0`;
        } else if (queryField === '充电时长') {
            // 充电时长字段
            didiWhereCondition = `${didiRawColumn} IS NOT NULL AND ${didiColumn} > 0`;
        } else {
            // 其他字段（充电费用等）
            didiWhereCondition = `${didiRawColumn} IS NOT NULL AND ${didiColumn} > 0`;
        }

        if (shouldQueryTelaidian && shouldQueryDidi) {
            // 合并特来电和滴滴
            dataSum = `(ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE ${telaidianWhereCondition} AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL ${telaidianTimeWhere} ${telaidianWhere}), 0) + ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE ${didiWhereCondition} AND [场站名称] IS NOT NULL AND [充电枪ID] IS NOT NULL ${didiTimeWhere} ${didiWhere}), 0))`;
        } else if (shouldQueryTelaidian) {
            // 只查询特来电
            dataSum = `ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE ${telaidianWhereCondition} AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL ${telaidianTimeWhere} ${telaidianWhere}), 0)`;
        } else if (shouldQueryDidi) {
            // 只查询滴滴
            dataSum = `ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE ${didiWhereCondition} AND [场站名称] IS NOT NULL AND [充电枪ID] IS NOT NULL ${didiTimeWhere} ${didiWhere}), 0)`;
        }

        const sql = `SELECT (${dataSum} / NULLIF(${timeDivider}, 0) / NULLIF(${gunCount}, 0)) AS 平均值`;
        debugLog('生成的平均每把枪SQL', sql);
        return sql;
    }

    // 特殊处理：对比/比较查询（两个不同时间段的数据对比）
    const hasComparison = message.includes('对比') || message.includes('比较');
    if (hasComparison && timeInfo.hasTime) {
        debugLog('检测到对比/比较查询，使用特殊处理');

        // 提取两个时间段
        // 支持格式：2025年对比2024年、2025年11月对比2024年11月、2025年11月比较2024年11月等
        const yearPattern1 = /(\d{4})年.*?(?:对比|比较).*?(\d{4})年/;
        const monthPattern1 = /(\d{4})年(\d{1,2})月.*?(?:对比|比较).*?(\d{4})年(\d{1,2})月/;

        let period1 = null;
        let period2 = null;

        // 先尝试匹配月份对比
        const monthMatch = message.match(monthPattern1);
        if (monthMatch) {
            period1 = {
                year: parseInt(monthMatch[1]),
                month: parseInt(monthMatch[2]),
                startDate: `${monthMatch[1]}-${String(monthMatch[2]).padStart(2, '0')}-01`,
                endDate: null // 将在下面计算
            };
            period2 = {
                year: parseInt(monthMatch[3]),
                month: parseInt(monthMatch[4]),
                startDate: `${monthMatch[3]}-${String(monthMatch[4]).padStart(2, '0')}-01`,
                endDate: null
            };

            // 计算月份结束日期
            const nextMonth1 = period1.month === 12 ? 1 : period1.month + 1;
            const nextYear1 = period1.month === 12 ? period1.year + 1 : period1.year;
            period1.endDate = `${nextYear1}-${String(nextMonth1).padStart(2, '0')}-01`;

            const nextMonth2 = period2.month === 12 ? 1 : period2.month + 1;
            const nextYear2 = period2.month === 12 ? period2.year + 1 : period2.year;
            period2.endDate = `${nextYear2}-${String(nextMonth2).padStart(2, '0')}-01`;
        } else {
            // 尝试匹配年份对比
            const yearMatch = message.match(yearPattern1);
            if (yearMatch) {
                period1 = {
                    year: parseInt(yearMatch[1]),
                    startDate: `${yearMatch[1]}-01-01`,
                    endDate: `${parseInt(yearMatch[1]) + 1}-01-01`
                };
                period2 = {
                    year: parseInt(yearMatch[2]),
                    startDate: `${yearMatch[2]}-01-01`,
                    endDate: `${parseInt(yearMatch[2]) + 1}-01-01`
                };
            }
        }

        if (period1 && period2) {
            debugLog('提取的对比时间段', { period1, period2 });

            // 确定查询字段
            let queryField = '充电电量';
            let telaidianColumn = '[充电电量(度)]';
            let nengkeColumn = '[充电量]';
            let didiColumn = 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)';

            if (message.includes('充电服务费') || message.includes('服务费')) {
                queryField = '充电服务费';
                telaidianColumn = '[充电服务费(元)]';
                nengkeColumn = '[服务费]';
                didiColumn = 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)';
            } else if (message.includes('充电电费') || (message.includes('电费') && message.includes('充电'))) {
                queryField = '充电电费';
                telaidianColumn = 'CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT)';
                nengkeColumn = '[电费]';
                didiColumn = 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)';
            } else if (message.includes('充电费用') || message.includes('费用') || message.includes('收入') || message.includes('金额')) {
                queryField = '充电费用';
                telaidianColumn = '[充电费用(元)]';
                nengkeColumn = '[消费金额]';
                didiColumn = 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)';
            }

            // 构建WHERE条件（四方坪/高岭筛选）
            let telaidianWhere = '';
            let nengkeWhere = '';
            let didiWhere = '';
            if (message.includes('四方坪')) {
                telaidianWhere = "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
                nengkeWhere = ''; // 能科表没有高岭站点
                didiWhere = ''; // 滴滴表没有高岭站点
            } else if (message.includes('高岭')) {
                telaidianWhere = "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
                nengkeWhere = ''; // 能科表没有高岭站点
                didiWhere = ''; // 滴滴表没有高岭站点
            }

            // 根据时间过滤规则确定需要查询的表
            const shouldQueryTelaidian1 = tables.includes('特来电') && !(period1.year > 2026 || (period1.year === 2026 && period1.month && period1.month >= 2));
            const shouldQueryNengke1 = tables.includes('能科') && !(period1.year > 2024 || (period1.year === 2024 && period1.month && period1.month >= 5));
            const shouldQueryDidi1 = tables.includes('滴滴') && !(period1.year < 2025 || (period1.year === 2025 && period1.month && period1.month < 11));

            const shouldQueryTelaidian2 = tables.includes('特来电') && !(period2.year > 2026 || (period2.year === 2026 && period2.month && period2.month >= 2));
            const shouldQueryNengke2 = tables.includes('能科') && !(period2.year > 2024 || (period2.year === 2024 && period2.month && period2.month >= 5));
            const shouldQueryDidi2 = tables.includes('滴滴') && !(period2.year < 2025 || (period2.year === 2025 && period2.month && period2.month < 11));

            // 构建SQL - 使用简化的子查询结构，避免CROSS JOIN
            let period1Sum = '';
            let period2Sum = '';

            // 构建period1的查询
            const period1Parts = [];
            if (shouldQueryTelaidian1) {
                period1Parts.push(`ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE [充电结束时间] >= '${period1.startDate}' AND [充电结束时间] < '${period1.endDate}' AND ${telaidianColumn} IS NOT NULL AND ${telaidianColumn} > 0 ${telaidianWhere}), 0)`);
            }
            if (shouldQueryNengke1) {
                // 能科表的字段为float类型，直接判断非空和大于0
                const nengkeWhereCondition = queryField === '充电电量'
                    ? `[充电量] IS NOT NULL AND [充电量] > 0`
                    : queryField === '充电服务费'
                    ? `[服务费] IS NOT NULL AND [服务费] > 0`
                    : queryField === '充电电费'
                    ? `[电费] IS NOT NULL AND [电费] > 0`
                    : `[消费金额] IS NOT NULL AND [消费金额] > 0`;
                period1Parts.push(`ISNULL((SELECT SUM(${nengkeColumn}) FROM [能科] WHERE [结束日期时间] >= '${period1.startDate}' AND [结束日期时间] < '${period1.endDate}' AND ${nengkeWhereCondition} ${nengkeWhere}), 0)`);
            }
            if (shouldQueryDidi1) {
                // 滴滴表的字段是nvarchar类型，需要验证
                const didiFieldName = queryField === '充电电量' 
                    ? '[充电量（度）]' 
                    : queryField === '充电服务费' 
                    ? '[充电服务费（元）]' 
                    : queryField === '充电电费'
                    ? '[充电电费（元）]'
                    : '[订单总额（元）]';
                period1Parts.push(`ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE [充电完成时间] >= '${period1.startDate}' AND [充电完成时间] < '${period1.endDate}' AND ${didiFieldName} IS NOT NULL AND LTRIM(RTRIM(${didiFieldName})) != '' AND ISNUMERIC(${didiFieldName}) = 1 AND ${didiColumn} > 0 ${didiWhere}), 0)`);
            }
            period1Sum = period1Parts.length > 0 ? period1Parts.join(' + ') : '0';

            // 构建period2的查询
            const period2Parts = [];
            if (shouldQueryTelaidian2) {
                period2Parts.push(`ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE [充电结束时间] >= '${period2.startDate}' AND [充电结束时间] < '${period2.endDate}' AND ${telaidianColumn} IS NOT NULL AND ${telaidianColumn} > 0 ${telaidianWhere}), 0)`);
            }
            if (shouldQueryNengke2) {
                const nengkeWhereCondition = queryField === '充电电量'
                    ? `[充电量] IS NOT NULL AND [充电量] > 0`
                    : queryField === '充电服务费'
                    ? `[服务费] IS NOT NULL AND [服务费] > 0`
                    : queryField === '充电电费'
                    ? `[电费] IS NOT NULL AND [电费] > 0`
                    : `[消费金额] IS NOT NULL AND [消费金额] > 0`;
                period2Parts.push(`ISNULL((SELECT SUM(${nengkeColumn}) FROM [能科] WHERE [结束日期时间] >= '${period2.startDate}' AND [结束日期时间] < '${period2.endDate}' AND ${nengkeWhereCondition} ${nengkeWhere}), 0)`);
            }
            if (shouldQueryDidi2) {
                const didiFieldName = queryField === '充电电量' 
                    ? '[充电量（度）]' 
                    : queryField === '充电服务费' 
                    ? '[充电服务费（元）]' 
                    : queryField === '充电电费'
                    ? '[充电电费（元）]'
                    : '[订单总额（元）]';
                period2Parts.push(`ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE [充电完成时间] >= '${period2.startDate}' AND [充电完成时间] < '${period2.endDate}' AND ${didiFieldName} IS NOT NULL AND LTRIM(RTRIM(${didiFieldName})) != '' AND ISNUMERIC(${didiFieldName}) = 1 AND ${didiColumn} > 0 ${didiWhere}), 0)`);
            }
            period2Sum = period2Parts.length > 0 ? period2Parts.join(' + ') : '0';

            // 构建最终SQL - 只返回增减量，不计算百分比（避免复杂度）
            const sql = `SELECT (${period1Sum}) - (${period2Sum}) AS 增减量`;

            debugLog('生成的对比SQL', sql);
            return sql;
        }
    }

    // 特殊处理：平均每度电的查询（总服务费/总收入 ÷ 总电量）
    const hasPerKwhAverage = message.includes('平均') && (message.includes('每度电') || message.includes('每度'));
    if (hasPerKwhAverage && timeInfo.hasTime) {
        debugLog('检测到平均每度电查询，使用特殊处理');

        // 判断查询的是什么字段（服务费、收入、费用等）
        let numeratorField = '服务费'; // 分子字段
        let telaidianNumeratorColumn = 'CAST(LTRIM(RTRIM([充电服务费(元)])) AS FLOAT)'; // 特来电表服务费字段是nvarchar，需要转换
        let telaidianNumeratorRawColumn = '[充电服务费(元)]'; // 原始字段名（用于WHERE条件）
        let nengkeNumeratorColumn = '[服务费]';
        let didiNumeratorColumn = 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)'; // 滴滴表服务费字段是nvarchar，需要转换
        let didiNumeratorRawColumn = '[充电服务费（元）]'; // 原始字段名（用于WHERE条件）

        if (message.includes('服务费')) {
            numeratorField = '服务费';
            telaidianNumeratorColumn = 'CAST(LTRIM(RTRIM([充电服务费(元)])) AS FLOAT)'; // 需要转换
            telaidianNumeratorRawColumn = '[充电服务费(元)]';
            nengkeNumeratorColumn = '[服务费]';
            didiNumeratorColumn = 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)'; // 需要转换
            didiNumeratorRawColumn = '[充电服务费（元）]';
        } else if (message.includes('收入') || message.includes('费用') || message.includes('金额')) {
            numeratorField = '收入';
            telaidianNumeratorColumn = '[充电费用(元)]';
            telaidianNumeratorRawColumn = '[充电费用(元)]';
            nengkeNumeratorColumn = '[消费金额]'; // 能科表消费金额字段为float类型
            didiNumeratorColumn = 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)'; // 订单总额也需要转换
            didiNumeratorRawColumn = '[订单总额（元）]';
        }

        // 分母字段固定是充电电量
        const telaidianDenominatorColumn = '[充电电量(度)]';
        const nengkeDenominatorColumn = '[充电量]';
        const didiDenominatorColumn = 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)';

        // 构建WHERE条件（四方坪/高岭筛选）
        let telaidianWhere = '';
        let nengkeWhere = '';
        let didiWhere = '';
        if (message.includes('四方坪')) {
            telaidianWhere = "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
            nengkeWhere = ''; // 能科表没有高岭站点
            didiWhere = ''; // 滴滴表没有高岭站点
        } else if (message.includes('高岭')) {
            telaidianWhere = "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
            nengkeWhere = ''; // 能科表没有高岭站点
            didiWhere = ''; // 滴滴表没有高岭站点
        }

        // 构建时间WHERE条件
        let telaidianTimeWhere = '';
        let nengkeTimeWhere = '';
        let didiTimeWhere = '';
        if (timeInfo.year && timeInfo.month) {
            const startDate = `${timeInfo.year}-${String(timeInfo.month).padStart(2, '0')}-01`;
            const nextMonth = timeInfo.month === 12 ? 1 : timeInfo.month + 1;
            const nextYear = timeInfo.month === 12 ? timeInfo.year + 1 : timeInfo.year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            telaidianTimeWhere = `AND [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}'`;
            nengkeTimeWhere = `AND [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}'`;
            didiTimeWhere = `AND [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}'`;
        } else if (timeInfo.year) {
            telaidianTimeWhere = `AND [充电结束时间] >= '${timeInfo.year}-01-01' AND [充电结束时间] < '${timeInfo.year + 1}-01-01'`;
            nengkeTimeWhere = `AND [结束日期时间] >= '${timeInfo.year}-01-01' AND [结束日期时间] < '${timeInfo.year + 1}-01-01'`;
            didiTimeWhere = `AND [充电完成时间] >= '${timeInfo.year}-01-01' AND [充电完成时间] < '${timeInfo.year + 1}-01-01'`;
        } else if (timeInfo.startDate && timeInfo.endDate) {
            telaidianTimeWhere = `AND [充电结束时间] >= '${timeInfo.startDate}' AND [充电结束时间] <= '${timeInfo.endDate} 23:59:59'`;
            nengkeTimeWhere = `AND [结束日期时间] >= '${timeInfo.startDate}' AND [结束日期时间] <= '${timeInfo.endDate} 23:59:59'`;
            didiTimeWhere = `AND [充电完成时间] >= '${timeInfo.startDate}' AND [充电完成时间] <= '${timeInfo.endDate} 23:59:59'`;
        }

        // 根据应用时间过滤规则后的tables，决定查询哪些表
        const shouldQueryTelaidian = tables.includes('特来电');
        const shouldQueryNengke = tables.includes('能科');
        const shouldQueryDidi = tables.includes('滴滴');

        // 构建SQL - 同时计算分子和分母以提高性能
        let sqlParts = [];
        let tableAliasCounter = 1; // 动态分配别名

        if (shouldQueryTelaidian) {
            // 构建特来电表的WHERE条件（根据字段类型）
            let telaidianNumeratorWhere = '';
            if (numeratorField === '服务费') {
                // 充电服务费字段是nvarchar，需要特殊处理
                telaidianNumeratorWhere = `${telaidianNumeratorRawColumn} IS NOT NULL AND LTRIM(RTRIM(${telaidianNumeratorRawColumn})) != '' AND ISNUMERIC(${telaidianNumeratorRawColumn}) = 1 AND ${telaidianNumeratorColumn} > 0`;
            } else {
                // 充电费用字段可能是数值类型，直接判断
                telaidianNumeratorWhere = `${telaidianNumeratorRawColumn} IS NOT NULL AND ${telaidianNumeratorRawColumn} > 0`;
            }
            
            sqlParts.push({
                alias: `t${tableAliasCounter++}`,
                sql: `
                (SELECT
                    SUM(${telaidianNumeratorColumn}) AS 分子,
                    SUM(${telaidianDenominatorColumn}) AS 分母
                FROM [特来电]
                WHERE ${telaidianNumeratorWhere}
                    AND ${telaidianDenominatorColumn} IS NOT NULL AND ${telaidianDenominatorColumn} > 0
                    ${telaidianTimeWhere}
                    ${telaidianWhere}
                )`.trim()
            });
        }

        if (shouldQueryNengke) {
            // 能科表的服务费和消费金额字段为float类型，直接判断非空和大于0
            let nengkeNumeratorWhere = '';
            if (nengkeNumeratorColumn.includes('服务费')) {
                // 服务费字段：验证原始字段不为空且大于0
                nengkeNumeratorWhere = `[服务费] IS NOT NULL AND [服务费] > 0`;
            } else if (nengkeNumeratorColumn.includes('消费金额')) {
                // 消费金额字段：验证原始字段不为空且大于0
                nengkeNumeratorWhere = `[消费金额] IS NOT NULL AND [消费金额] > 0`;
            } else {
                // 其他字段（如充电量）：使用简单的验证
                nengkeNumeratorWhere = `${nengkeNumeratorColumn} IS NOT NULL AND ${nengkeNumeratorColumn} > 0`;
            }
            
            sqlParts.push({
                alias: `t${tableAliasCounter++}`,
                sql: `
                (SELECT
                    SUM(${nengkeNumeratorColumn}) AS 分子,
                    SUM(${nengkeDenominatorColumn}) AS 分母
                FROM [能科]
                WHERE ${nengkeNumeratorWhere}
                    AND ${nengkeDenominatorColumn} IS NOT NULL AND ${nengkeDenominatorColumn} > 0
                    ${nengkeTimeWhere}
                    ${nengkeWhere}
                )`.trim()
            });
        }

        if (shouldQueryDidi) {
            // 构建滴滴表的WHERE条件（根据字段类型）
            let didiNumeratorWhere = '';
            if (numeratorField === '服务费') {
                // 充电服务费字段是nvarchar，需要特殊处理
                didiNumeratorWhere = `${didiNumeratorRawColumn} IS NOT NULL AND LTRIM(RTRIM(${didiNumeratorRawColumn})) != '' AND ISNUMERIC(${didiNumeratorRawColumn}) = 1 AND ${didiNumeratorColumn} > 0`;
            } else {
                // 订单总额字段是nvarchar，需要特殊处理
                didiNumeratorWhere = `${didiNumeratorRawColumn} IS NOT NULL AND LTRIM(RTRIM(${didiNumeratorRawColumn})) != '' AND ISNUMERIC(${didiNumeratorRawColumn}) = 1 AND ${didiNumeratorColumn} > 0`;
            }

            sqlParts.push({
                alias: `t${tableAliasCounter++}`,
                sql: `
                (SELECT
                    SUM(${didiNumeratorColumn}) AS 分子,
                    SUM(${didiDenominatorColumn}) AS 分母
                FROM [滴滴]
                WHERE ${didiNumeratorWhere}
                    AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != ''
                    AND ISNUMERIC([充电量（度）]) = 1 AND ${didiDenominatorColumn} > 0
                    ${didiTimeWhere}
                    ${didiWhere}
                )`.trim()
            });
        }

        // 构建最终SQL
        let sql = '';
        if (sqlParts.length === 1) {
            // 只有一个表
            sql = `SELECT (ISNULL(分子, 0) / NULLIF(ISNULL(分母, 0), 0)) AS 平均值 FROM ${sqlParts[0].sql} AS ${sqlParts[0].alias}`;
        } else if (sqlParts.length > 1) {
            // 多个表，需要合并
            const fromClause = sqlParts.map(part => `${part.sql} AS ${part.alias}`).join(' CROSS JOIN ');
            const numeratorSum = sqlParts.map(part => `ISNULL(${part.alias}.分子, 0)`).join(' + ');
            const denominatorSum = sqlParts.map(part => `ISNULL(${part.alias}.分母, 0)`).join(' + ');
            sql = `SELECT ((${numeratorSum}) / NULLIF((${denominatorSum}), 0)) AS 平均值 FROM ${fromClause}`;
        }

        debugLog('生成的平均每度电SQL', sql);
        return sql;
    }

    // ========== 任务3：补充业务计算逻辑 ==========

    // 3.1 利润率计算（毛利率 = 毛利润 ÷ 成本 × 100%）
    const hasProfitRate = message.includes('利润率') || message.includes('收益率') || message.includes('毛利率');
    if (hasProfitRate && (message.includes('四方坪') || message.includes('高岭'))) {
        debugLog('检测到利润率计算逻辑');

        // 利润率 = (充电收入 - 电力局电费) ÷ 电力局电费 × 100
        // 这里我们返回百分比值（0-100），前端显示时加上%
        // 复用毛利润的计算逻辑，但最后除以成本并乘以100

        // 为了简化，这里只处理单年查询的利润率
        if (timeInfo.year && !timeInfo.month) {
            const year = timeInfo.year;
            const startDate = `${year}-01-01`;
            const endDate = `${year + 1}-01-01`;

            // 根据地点设置变压器和电站筛选条件
            let transformerCondition = '';
            let telaidianStationCondition = '';
            if (message.includes('四方坪')) {
                transformerCondition = "([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')";
                telaidianStationCondition = "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
            } else if (message.includes('高岭')) {
                transformerCondition = "([变压器编号] = '4350001671599')";
                telaidianStationCondition = "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
            }

            // 构建充电收入查询
            const chargingIncome = `ISNULL((SELECT SUM([充电费用(元)]) FROM [特来电] WHERE [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0 AND [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}' ${telaidianStationCondition}), 0) +
                                    ISNULL((SELECT SUM([消费金额]) FROM [能科] WHERE [消费金额] IS NOT NULL AND [消费金额] > 0 AND [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}'), 0) +
                                    ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)) FROM [滴滴] WHERE [订单总额（元）] IS NOT NULL AND LTRIM(RTRIM([订单总额（元）])) != '' AND ISNUMERIC([订单总额（元）]) = 1 AND CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT) > 0 AND [充电完成时间] >= '${startDate}' AND [充电完成时间] < '${endDate}'), 0)`;

            // 构建电力局电费查询
            const powerCost = `ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局] WHERE [年] = ${year} AND ${transformerCondition} AND [购电费] IS NOT NULL AND [输配电量电费] IS NOT NULL AND [力调电费] IS NOT NULL AND [基金及附加] IS NOT NULL AND [上网线损费用] IS NOT NULL AND [系统运行费用] IS NOT NULL AND [环境价值费用] IS NOT NULL), 0)`;

            const sql = `SELECT (((${chargingIncome}) - (${powerCost})) / NULLIF(${powerCost}, 0)) * 100 AS 利润率`;
            debugLog('生成的利润率SQL', sql);
            return sql.replace(/\s+/g, ' ').trim();
        }
    }

    // 3.2 充电效率计算（充电电量 ÷ 充电时长，单位：度/小时）
    const hasEfficiency = message.includes('效率') || message.includes('充电效率') ||
                          message.includes('单小时充电量') || message.includes('每小时充电量');
    if (hasEfficiency && timeInfo.hasTime) {
        debugLog('检测到充电效率计算逻辑');

        // 充电效率 = SUM(充电电量) ÷ SUM(充电时长/60)  -- 充电时长单位是分钟，转换为小时
        let telaidianColumn = '[充电电量(度)]';
        let nengkeColumn = '[充电量]';
        let didiColumn = 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)';

        // 构建WHERE条件（四方坪/高岭筛选）
        let telaidianWhere = '';
        let nengkeWhere = '';
        let didiWhere = '';
        if (message.includes('四方坪')) {
            telaidianWhere = "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
        } else if (message.includes('高岭')) {
            telaidianWhere = "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
        }

        // 构建时间WHERE条件
        let telaidianTimeWhere = '';
        let nengkeTimeWhere = '';
        let didiTimeWhere = '';
        if (timeInfo.year && timeInfo.month) {
            const startDate = `${timeInfo.year}-${String(timeInfo.month).padStart(2, '0')}-01`;
            const nextMonth = timeInfo.month === 12 ? 1 : timeInfo.month + 1;
            const nextYear = timeInfo.month === 12 ? timeInfo.year + 1 : timeInfo.year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            telaidianTimeWhere = `AND [充电结束时间] >= '${startDate}' AND [充电结束时间] < '${endDate}'`;
            nengkeTimeWhere = `AND [结束日期时间] >= '${startDate}' AND [结束日期时间] < '${endDate}'`;
            didiTimeWhere = `AND [充电完成时间] >= '${startDate}' AND [充电完成Time] < '${endDate}'`;
        } else if (timeInfo.year) {
            telaidianTimeWhere = `AND [充电结束时间] >= '${timeInfo.year}-01-01' AND [充电结束时间] < '${timeInfo.year + 1}-01-01'`;
            nengkeTimeWhere = `AND [结束日期时间] >= '${timeInfo.year}-01-01' AND [结束日期时间] < '${timeInfo.year + 1}-01-01'`;
            didiTimeWhere = `AND [充电完成时间] >= '${timeInfo.year}-01-01' AND [充电完成时间] < '${timeInfo.year + 1}-01-01'`;
        } else if (timeInfo.startDate && timeInfo.endDate) {
            telaidianTimeWhere = `AND [充电结束时间] >= '${timeInfo.startDate}' AND [充电结束时间] <= '${timeInfo.endDate} 23:59:59'`;
            nengkeTimeWhere = `AND [结束日期时间] >= '${timeInfo.startDate}' AND [结束日期时间] <= '${timeInfo.endDate} 23:59:59'`;
            didiTimeWhere = `AND [充电完成时间] >= '${timeInfo.startDate}' AND [充电完成时间] <= '${timeInfo.endDate} 23:59:59'`;
        }

        // 构建充电效率SQL
        const powerSum = `ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE ${telaidianColumn} IS NOT NULL AND ${telaidianColumn} > 0 ${telaidianTimeWhere} ${telaidianWhere}), 0) +
                         ISNULL((SELECT SUM(${nengkeColumn}) FROM [能科] WHERE ${nengkeColumn} IS NOT NULL AND ${nengkeColumn} > 0 ${nengkeTimeWhere} ${nengkeWhere}), 0) +
                         ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE ${didiColumn} IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND ${didiColumn} > 0 ${didiTimeWhere} ${didiWhere}), 0)`;

        const durationSum = `ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT)) FROM [特来电] WHERE [充电时长(分钟)] IS NOT NULL AND LTRIM(RTRIM([充电时长(分钟)])) != '' AND ISNUMERIC([充电时长(分钟)]) = 1 AND CAST(LTRIM(RTRIM([充电时长(分钟)])) AS FLOAT) > 0 ${telaidianTimeWhere} ${telaidianWhere}), 0) +
                            ISNULL((SELECT SUM(DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))) FROM [能科] WHERE [充电时长] IS NOT NULL ${nengkeTimeWhere} ${nengkeWhere}), 0)`;

        const sql = `SELECT (${powerSum}) / NULLIF((${durationSum}) / 60.0, 0) AS 充电效率_度每小时`;
        debugLog('生成的充电效率SQL', sql);
        return sql.replace(/\s+/g, ' ').trim();
    }

    // 3.3 同比/环比增长率
    const hasGrowthRate = message.includes('同比') || message.includes('环比') ||
                          (message.includes('增长') && message.includes('率'));
    if (hasGrowthRate && timeInfo.hasTime) {
        debugLog('检测到增长率计算逻辑');

        // 同比增长 = (今年 - 去年) ÷ 去年 × 100%
        // 环比增长 = (本月 - 上月) ÷ 上月 × 100%

        let currentPeriodStart, currentPeriodEnd, lastPeriodStart, lastPeriodEnd;
        let periodType = '';  // 'year' 或 'month'

        if (message.includes('同比') || message.includes('年')) {
            periodType = 'year';
            const year = timeInfo.year || new Date().getFullYear();
            currentPeriodStart = `${year}-01-01`;
            currentPeriodEnd = `${year + 1}-01-01`;
            lastPeriodStart = `${year - 1}-01-01`;
            lastPeriodEnd = `${year}-01-01`;
        } else if (message.includes('环比') || (timeInfo.month && !message.includes('同比'))) {
            periodType = 'month';
            const year = timeInfo.year || new Date().getFullYear();
            const month = timeInfo.month || new Date().getMonth() + 1;
            currentPeriodStart = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            currentPeriodEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

            const lastMonth = month === 1 ? 12 : month - 1;
            const lastMonthYear = month === 1 ? year - 1 : year;
            lastPeriodStart = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}-01`;
            const lastNextMonth = lastMonth === 12 ? 1 : lastMonth + 1;
            const lastNextYear = lastMonth === 12 ? lastMonthYear + 1 : lastMonthYear;
            lastPeriodEnd = `${lastNextYear}-${String(lastNextMonth).padStart(2, '0')}-01`;
        }

        if (periodType && currentPeriodStart && lastPeriodStart) {
            // 确定查询字段
            let queryField = '充电电量';
            let telaidianColumn = '[充电电量(度)]';
            let nengkeColumn = '[充电量]';
            let didiColumn = 'CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)';

            if (message.includes('充电服务费') || message.includes('服务费')) {
                queryField = '充电服务费';
                telaidianColumn = '[充电服务费(元)]';
                nengkeColumn = '[服务费]';
                didiColumn = 'CAST(LTRIM(RTRIM([充电服务费（元）])) AS FLOAT)';
            } else if (message.includes('充电电费') || (message.includes('电费') && message.includes('充电'))) {
                queryField = '充电电费';
                telaidianColumn = 'CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT)';
                nengkeColumn = '[电费]';
                didiColumn = 'CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)';
            } else if (message.includes('充电费用') || message.includes('费用') || message.includes('收入') || message.includes('金额')) {
                queryField = '充电费用';
                telaidianColumn = '[充电费用(元)]';
                nengkeColumn = '[消费金额]';
                didiColumn = 'CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)';
            }

            // 构建WHERE条件
            let telaidianWhere = '';
            let nengkeWhere = '';
            let didiWhere = '';
            if (message.includes('四方坪')) {
                telaidianWhere = "AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
            } else if (message.includes('高岭')) {
                telaidianWhere = "AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
            }

            // 计算当前期和上一期的数据
            const currentPeriodSum = `ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE ${telaidianColumn} IS NOT NULL AND ${telaidianColumn} > 0 AND [充电结束时间] >= '${currentPeriodStart}' AND [充电结束Time] < '${currentPeriodEnd}' ${telaidianWhere}), 0) +
                                      ISNULL((SELECT SUM(${nengkeColumn}) FROM [能科] WHERE ${nengkeColumn} IS NOT NULL AND ${nengkeColumn} > 0 AND [结束日期时间] >= '${currentPeriodStart}' AND [结束日期时间] < '${currentPeriodEnd}' ${nengkeWhere}), 0) +
                                      ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE ${didiColumn} IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND ${didiColumn} > 0 AND [充电完成时间] >= '${currentPeriodStart}' AND [充电完成时间] < '${currentPeriodEnd}' ${didiWhere}), 0)`;

            const lastPeriodSum = `ISNULL((SELECT SUM(${telaidianColumn}) FROM [特来电] WHERE ${telaidianColumn} IS NOT NULL AND ${telaidianColumn} > 0 AND [充电结束时间] >= '${lastPeriodStart}' AND [充电结束时间] < '${lastPeriodEnd}' ${telaidianWhere}), 0) +
                                   ISNULL((SELECT SUM(${nengkeColumn}) FROM [能科] WHERE ${nengkeColumn} IS NOT NULL AND ${nengkeColumn} > 0 AND [结束日期时间] >= '${lastPeriodStart}' AND [结束日期时间] < '${lastPeriodEnd}' ${nengkeWhere}), 0) +
                                   ISNULL((SELECT SUM(${didiColumn}) FROM [滴滴] WHERE ${didiColumn} IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND ${didiColumn} > 0 AND [充电完成时间] >= '${lastPeriodStart}' AND [充电完成时间] < '${lastPeriodEnd}' ${didiWhere}), 0)`;

            const sql = `SELECT (((${currentPeriodSum}) - (${lastPeriodSum})) / NULLIF(${lastPeriodSum}, 0)) * 100 AS 增长率`;
            debugLog('生成的增长率SQL', sql);
            return sql.replace(/\s+/g, ' ').trim();
        }
    }

    // ========== 任务3业务计算结束 ==========

    // 特殊处理：查询时间字段本身（最小时间、最大时间、最早时间、最晚时间）
    const isTimeFieldQuery = (
        (message.includes('最小时间') || message.includes('最早时间') || message.includes('最早的时间')) ||
        (message.includes('最大时间') || message.includes('最晚时间') || message.includes('最晚的时间'))
    );

    if (isTimeFieldQuery) {
        debugLog('检测到时间字段查询');
        const isMinTime = message.includes('最小时间') || message.includes('最早时间') || message.includes('最早的时间');
        const isMaxTime = message.includes('最大时间') || message.includes('最晚时间') || message.includes('最晚的时间');

        let sqlParts = [];
        for (const table of tables) {
            const actualTable = table.replace('_四方坪', '').replace('_高岭', '');
            if (!TABLE_FIELDS[actualTable]) {
                debugLog(`警告：表 [${actualTable}] 不在TABLE_FIELDS配置中，跳过时间查询`);
                continue;
            }

            const tableConfig = TABLE_FIELDS[actualTable];
            const timeField = tableConfig.timeField;

            if (!timeField) {
                debugLog(`警告：表 [${actualTable}] 没有配置timeField，跳过时间查询`);
                continue;
            }

            // 电力局表特殊处理（使用年+月字段）
            if (actualTable === '电力局') {
                if (isMinTime) {
                    sqlParts.push(`SELECT '${actualTable}' AS 表名, MIN(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') AS 最小时间 FROM [${actualTable}] WHERE [年] IS NOT NULL AND [月] IS NOT NULL`);
                } else if (isMaxTime) {
                    sqlParts.push(`SELECT '${actualTable}' AS 表名, MAX(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') AS 最大时间 FROM [${actualTable}] WHERE [年] IS NOT NULL AND [月] IS NOT NULL`);
                }
            } else {
                // 其他表使用时间字段
                if (isMinTime) {
                    sqlParts.push(`SELECT '${actualTable}' AS 表名, MIN([${timeField}]) AS 最小时间 FROM [${actualTable}] WHERE [${timeField}] IS NOT NULL`);
                } else if (isMaxTime) {
                    sqlParts.push(`SELECT '${actualTable}' AS 表名, MAX([${timeField}]) AS 最大时间 FROM [${actualTable}] WHERE [${timeField}] IS NOT NULL`);
                }
            }
        }

        if (sqlParts.length === 0) {
            throw new Error('无法生成时间查询SQL');
        }

        // 如果只有一个表，直接返回（但保留表名列以便识别）
        if (sqlParts.length === 1) {
            return sqlParts[0];
        }

        // 多个表，需要合并结果，保留表名列
        if (isMinTime) {
            return sqlParts.join(' UNION ALL ');
        } else {
            return sqlParts.join(' UNION ALL ');
        }
    }

    // 判断查询类型
    // isCount：明确要求记录数的查询（次数、个数、多少次）
    const isCount = message.includes('次数') || message.includes('个数') || message.includes('多少次');

    // "平均每个月/每年/每天"查询：计算总和然后除以月数/年数/天数（如"2025年平均每个月的充电服务费是多少？"）
    const isAveragePerPeriod = message.includes('平均') && (message.includes('每个月') || message.includes('每月') || message.includes('每年') || message.includes('每天'));

    // 复杂平均值计算（如"平均每把枪每天"）应该由AI处理，不使用简单的AVG
    // 注意：排除"平均每个月/每年"这类查询（已在isAveragePerPeriod中处理）
    const isComplexAvg = message.includes('平均') && message.includes('每把枪');
    const isAvg = message.includes('平均') && !isComplexAvg && !isAveragePerPeriod;
    const isMax = message.includes('最大') || message.includes('最高');
    const isMin = message.includes('最小') || message.includes('最低');

    // 前N / 前几 / 最多的N / 列出N 作为排名类查询的触发条件之一，支持任意数字
    const hasTopNPattern = /前(\d+|几)/.test(message) ||
                          /最多的(\d+)/.test(message) ||
                          /列出(\d+)/.test(message) ||
                          (/\d+(?:天|日)/.test(message) && (message.includes('最多') || message.includes('最少') || message.includes('列出')));

    // 检测是否是分组查询（按时间或其他维度分组）
    const isGroupBy = hasTopNPattern || message.includes('排名') ||
                      message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                      message.includes('最少') || message.includes('最小') || message.includes('最低') || message.includes('列出') ||
                      message.includes('哪些') || message.includes('哪个') || message.includes('哪把') ||
                      message.includes('哪一天') || message.includes('哪一日') || message.includes('哪天') || message.includes('哪日') ||
                      message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月') ||
                      message.includes('哪一年') || message.includes('哪年') ||
                      // 添加"每年"、"每月"、"每个月"、"每天"作为分组触发条件
                      // 但排除"平均每个月/每年"（已在isAveragePerPeriod中处理）
                      (!isAveragePerPeriod && (message.includes('每年') || message.includes('每月') || message.includes('每个月') || message.includes('每天')));

    // isSum：包含"总"、"合计"、"多少"的查询
    // 注意：如果已经是分组查询或平均查询，不应该被识别为简单的SUM
    const isSum = !isGroupBy && !isAveragePerPeriod && (message.includes('总') || message.includes('合计') || message.includes('多少'));

    // 如果是复杂平均值计算，应该由AI处理，而不是规则匹配
    // 这个检查已经在analyzeQuestionWithAI中处理了，这里不需要再检查

    // 判断查询字段
    let queryField = null;
    let queryColumn = null;

    for (const table of tables) {
        const actualTable = table.replace('_四方坪', '').replace('_高岭', '');
        if (!TABLE_FIELDS[actualTable]) continue;

        const fields = TABLE_FIELDS[actualTable].fields;
        for (const keyword in fields) {
            if (message.includes(keyword)) {
                queryField = keyword;
                queryColumn = fields[keyword].column;
                break;
            }
        }
        if (queryField) break;
    }

    if (!queryColumn) {
        // 默认查询金额/收入
        for (const table of tables) {
            const actualTable = table.replace('_四方坪', '').replace('_高岭', '');
            if (TABLE_FIELDS[actualTable] && TABLE_FIELDS[actualTable].fields['收入']) {
                queryColumn = TABLE_FIELDS[actualTable].fields['收入'].column;
                break;
            } else if (TABLE_FIELDS[actualTable] && TABLE_FIELDS[actualTable].fields['金额']) {
                queryColumn = TABLE_FIELDS[actualTable].fields['金额'].column;
                break;
            }
        }
    }

    if (!queryColumn) {
        throw new Error('无法识别要查询的字段，请在问题中包含相关关键词');
    }

    // 构建SQL
    let sqlParts = [];

    for (const table of tables) {
        let actualTable = table;
        let extraCondition = '';

        // 处理表名中的特殊标记（如特来电_四方坪、特来电_高岭）
        if (table === '特来电_四方坪' || table === '特来电_高岭') {
            actualTable = '特来电';
        }

        // 处理特来电表的四方坪和高岭筛选逻辑
        if (actualTable === '特来电') {
            // 如果包含"公司"或"飞狐"，或同时包含"四方坪"和"高岭"，不添加任何筛选条件，查询所有数据
            if (message.includes('公司') || message.includes('飞狐') || (message.includes('四方坪') && message.includes('高岭'))) {
                // 不添加任何条件，查询所有数据
                extraCondition = '';
            } else if (message.includes('四方坪')) {
                // 如果查询中有"四方坪"（但没有"高岭"），排除高岭的两个电站
                extraCondition = " AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
            } else if (message.includes('高岭')) {
                // 如果查询中有"高岭"（但没有"四方坪"），只查询高岭的两个电站
                extraCondition = " AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
            }
            // 如果查询中没有"四方坪"和"高岭"，不添加任何条件，查询所有数据
        }

        if (!TABLE_FIELDS[actualTable]) continue;

        const tableConfig = TABLE_FIELDS[actualTable];
        const timeField = tableConfig.timeField;
        
        // 为每个表查找对应的字段映射
        let tableQueryColumn = null;
        const fields = tableConfig.fields;
        
        // 优先匹配更具体的字段名（更长的关键词优先）
        const sortedKeywords = Object.keys(fields).sort((a, b) => b.length - a.length);
        for (const keyword of sortedKeywords) {
            if (message.includes(keyword)) {
                tableQueryColumn = fields[keyword].column;
                break;
            }
        }
        
        // 如果没找到，使用默认字段（收入或金额）
        if (!tableQueryColumn) {
            // 对于充电服务费查询，能科表使用'服务费'字段，滴滴表使用'充电服务费'字段
            if (message.includes('服务费') || message.includes('充电服务费')) {
                if (fields['充电服务费']) {
                    tableQueryColumn = fields['充电服务费'].column;
                } else if (fields['服务费']) {
                    tableQueryColumn = fields['服务费'].column;
                } else if (fields['收入']) {
                    tableQueryColumn = fields['收入'].column;
                } else if (fields['金额']) {
                    tableQueryColumn = fields['金额'].column;
                } else {
                    // 如果这个表没有匹配的字段，跳过
                    continue;
                }
            } else if (fields['收入']) {
                tableQueryColumn = fields['收入'].column;
            } else if (fields['金额']) {
                tableQueryColumn = fields['金额'].column;
            } else {
                // 如果这个表没有匹配的字段，跳过
                continue;
            }
        }
        
        let selectClause = '';
        let groupByClause = '';
        let orderByClause = '';
        let topClause = '';
        let whereClause = ''; // 提前声明whereClause，供活动优惠券特殊处理使用

        // 活动优惠券表的特殊处理
        if (actualTable === '活动优惠券' && (tableQueryColumn === '活动优惠券收入计算' || isCount)) {
            // 构建电站名称筛选条件
            let stationCondition = '';
            // 如果包含"公司"或"飞狐"，或同时包含"四方坪"和"高岭"，不添加任何筛选条件，查询所有数据
            if (message.includes('公司') || message.includes('飞狐') || (message.includes('四方坪') && message.includes('高岭'))) {
                // 不添加任何条件，查询所有数据
                stationCondition = '';
            } else if (message.includes('四方坪')) {
                // 四方坪站：不包含高岭的两个电站
                stationCondition = " AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
            } else if (message.includes('高岭')) {
                // 高岭站：只包含高岭的两个电站
                stationCondition = " AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
            }
            // 如果没有指定"四方坪"或"高岭"，不添加电站名称筛选条件，查询所有数据

            // 构建时间条件
            let timeCondition = '';
            if (timeInfo.hasTime && timeInfo.startDate) {
                if (timeInfo.startDate === timeInfo.endDate) {
                    timeCondition = ` AND CAST([收款时间] AS DATE) = '${timeInfo.startDate}'`;
                } else {
                    // 对于活动优惠券表，优先使用YEAR/MONTH函数，避免日期范围比较的问题
                    // 查询21、23显示YEAR函数有数据，但日期范围比较没有数据，说明日期范围比较有问题
                    if (timeInfo.year && !timeInfo.month && !timeInfo.day) {
                        // 整年查询：使用YEAR函数（与查询11、23一致，更可靠）
                        timeCondition = ` AND YEAR([收款时间]) = ${timeInfo.year}`;
                    } else if (timeInfo.year && timeInfo.month && !timeInfo.day) {
                        // 整月查询：使用YEAR和MONTH函数
                        timeCondition = ` AND YEAR([收款时间]) = ${timeInfo.year} AND MONTH([收款时间]) = ${timeInfo.month}`;
                    } else {
                        // 其他情况（日期范围）：使用CAST转换为DATE进行比较，避免时间部分问题
                        timeCondition = ` AND CAST([收款时间] AS DATE) >= '${timeInfo.startDate}' AND CAST([收款时间] AS DATE) <= '${timeInfo.endDate}'`;
                    }
                }
            } else {
                timeCondition = ' AND [收款时间] IS NOT NULL';
            }

            // 如果是COUNT查询，使用简化的WHERE条件
            if (isCount) {
                // COUNT查询：统计符合条件的记录数
                // 基础条件：确保关键字段不为空且不为空字符串（使用LTRIM(RTRIM())处理空格）
                whereClause = `WHERE [收款时间] IS NOT NULL AND LTRIM(RTRIM([收款时间])) != '' AND [费用类型] IS NOT NULL AND LTRIM(RTRIM([费用类型])) != '' AND [支付方式] IS NOT NULL AND LTRIM(RTRIM([支付方式])) != ''${stationCondition}${timeCondition}`;
                selectClause = `SELECT COUNT(*) AS 记录数`;
            } else {
                // 构建包含6种情况的SUM表达式
                // 注意：使用LTRIM(RTRIM())处理可能的空格
                // 卡券是否结算条件：IS NULL OR <> '是' OR <> '已结算' OR <> 'Y'（处理多种可能的"已结算"值）
                // 1. 费用类型='电费' AND 支付方式='代金券' AND 卡券类型='赠券' AND 卡券是否结算<>'是' -> 收款金额(元)
                // 2. 费用类型='服务费' AND 支付方式='代金券' AND 卡券类型='赠券' AND 卡券是否结算<>'是' -> 收款金额(元)
                // 3. 费用类型='电费' AND 支付方式='代金券' AND 卡券类型='卖券' AND 卡券是否结算<>'是' -> 卖券赠送金额(元)
                // 4. 费用类型='服务费' AND 支付方式='代金券' AND 卡券类型='卖券' AND 卡券是否结算<>'是' -> 卖券赠送金额(元)
                // 5. 费用类型='服务费' AND 支付方式='优惠券' AND 卡券是否结算<>'是' -> 收款金额(元)
                // 6. 费用类型='电费' AND 支付方式='优惠券' AND 卡券是否结算<>'是' -> 收款金额(元)
                const sumExpression = `(
                    ISNULL(SUM(CASE WHEN LTRIM(RTRIM([费用类型])) = '电费' AND LTRIM(RTRIM([支付方式])) = '代金券' AND LTRIM(RTRIM([卡券类型])) = '赠券' AND (LTRIM(RTRIM([卡券是否结算])) IS NULL OR LTRIM(RTRIM([卡券是否结算])) NOT IN ('是', '已结算', 'Y', 'y', 'YES', 'yes')) AND [收款金额(元)] IS NOT NULL AND LTRIM(RTRIM([收款金额(元)])) != '' AND ISNUMERIC(LTRIM(RTRIM([收款金额(元)]))) = 1 THEN CAST(LTRIM(RTRIM([收款金额(元)])) AS FLOAT) ELSE 0 END), 0) +
                    ISNULL(SUM(CASE WHEN LTRIM(RTRIM([费用类型])) = '服务费' AND LTRIM(RTRIM([支付方式])) = '代金券' AND LTRIM(RTRIM([卡券类型])) = '赠券' AND (LTRIM(RTRIM([卡券是否结算])) IS NULL OR LTRIM(RTRIM([卡券是否结算])) NOT IN ('是', '已结算', 'Y', 'y', 'YES', 'yes')) AND [收款金额(元)] IS NOT NULL AND LTRIM(RTRIM([收款金额(元)])) != '' AND ISNUMERIC(LTRIM(RTRIM([收款金额(元)]))) = 1 THEN CAST(LTRIM(RTRIM([收款金额(元)])) AS FLOAT) ELSE 0 END), 0) +
                    ISNULL(SUM(CASE WHEN LTRIM(RTRIM([费用类型])) = '电费' AND LTRIM(RTRIM([支付方式])) = '代金券' AND LTRIM(RTRIM([卡券类型])) = '卖券' AND (LTRIM(RTRIM([卡券是否结算])) IS NULL OR LTRIM(RTRIM([卡券是否结算])) NOT IN ('是', '已结算', 'Y', 'y', 'YES', 'yes')) AND [卖券赠送金额(元)] IS NOT NULL AND LTRIM(RTRIM([卖券赠送金额(元)])) != '' AND ISNUMERIC(LTRIM(RTRIM([卖券赠送金额(元)]))) = 1 THEN CAST(LTRIM(RTRIM([卖券赠送金额(元)])) AS FLOAT) ELSE 0 END), 0) +
                    ISNULL(SUM(CASE WHEN LTRIM(RTRIM([费用类型])) = '服务费' AND LTRIM(RTRIM([支付方式])) = '代金券' AND LTRIM(RTRIM([卡券类型])) = '卖券' AND (LTRIM(RTRIM([卡券是否结算])) IS NULL OR LTRIM(RTRIM([卡券是否结算])) NOT IN ('是', '已结算', 'Y', 'y', 'YES', 'yes')) AND [卖券赠送金额(元)] IS NOT NULL AND LTRIM(RTRIM([卖券赠送金额(元)])) != '' AND ISNUMERIC(LTRIM(RTRIM([卖券赠送金额(元)]))) = 1 THEN CAST(LTRIM(RTRIM([卖券赠送金额(元)])) AS FLOAT) ELSE 0 END), 0) +
                    ISNULL(SUM(CASE WHEN LTRIM(RTRIM([费用类型])) = '服务费' AND LTRIM(RTRIM([支付方式])) = '优惠券' AND (LTRIM(RTRIM([卡券是否结算])) IS NULL OR LTRIM(RTRIM([卡券是否结算])) NOT IN ('是', '已结算', 'Y', 'y', 'YES', 'yes')) AND [收款金额(元)] IS NOT NULL AND LTRIM(RTRIM([收款金额(元)])) != '' AND ISNUMERIC(LTRIM(RTRIM([收款金额(元)]))) = 1 THEN CAST(LTRIM(RTRIM([收款金额(元)])) AS FLOAT) ELSE 0 END), 0) +
                    ISNULL(SUM(CASE WHEN LTRIM(RTRIM([费用类型])) = '电费' AND LTRIM(RTRIM([支付方式])) = '优惠券' AND (LTRIM(RTRIM([卡券是否结算])) IS NULL OR LTRIM(RTRIM([卡券是否结算])) NOT IN ('是', '已结算', 'Y', 'y', 'YES', 'yes')) AND [收款金额(元)] IS NOT NULL AND LTRIM(RTRIM([收款金额(元)])) != '' AND ISNUMERIC(LTRIM(RTRIM([收款金额(元)]))) = 1 THEN CAST(LTRIM(RTRIM([收款金额(元)])) AS FLOAT) ELSE 0 END), 0)
                )`;

                if (isSum || !isGroupBy) {
                    selectClause = `SELECT ${sumExpression} AS 总计`;
                } else if (isGroupBy) {
                    // 分组查询暂不支持，使用总计
                    selectClause = `SELECT ${sumExpression} AS 总计`;
                } else {
                    selectClause = `SELECT ${sumExpression} AS 总计`;
                }

                // 构建WHERE子句
                // 基础条件：确保关键字段不为空且不为空字符串（使用LTRIM(RTRIM())处理空格）
                whereClause = `WHERE [收款时间] IS NOT NULL AND LTRIM(RTRIM([收款时间])) != '' AND [费用类型] IS NOT NULL AND LTRIM(RTRIM([费用类型])) != '' AND [支付方式] IS NOT NULL AND LTRIM(RTRIM([支付方式])) != ''${stationCondition}${timeCondition}`;
            }

            // 构建完整SQL
            let sql = `${selectClause} FROM [活动优惠券] ${whereClause}`;
            debugLog('活动优惠券表生成的SQL', {
                sql: sql,
                stationCondition: stationCondition,
                timeCondition: timeCondition,
                timeInfo: timeInfo,
                isCount: isCount
            });
            sqlParts.push(sql);
            continue; // 跳过后续处理
        }

        // 停车收入特殊处理：只查询红门缴费和赛菲姆道闸两张表，按照固定公式计算
        if (message.includes('停车收入') && (actualTable === '红门缴费' || actualTable === '赛菲姆道闸')) {
            const timeField = tableConfig.timeField;
            
            // 构建时间条件
            let timeCondition = '';
            if (timeInfo.hasTime && timeInfo.startDate) {
                if (timeInfo.startDate === timeInfo.endDate) {
                    timeCondition = ` AND CAST([${timeField}] AS DATE) = '${timeInfo.startDate}'`;
                } else {
                    timeCondition = ` AND [${timeField}] >= '${timeInfo.startDate}' AND [${timeField}] <= '${timeInfo.endDate} 23:59:59'`;
                }
            } else {
                timeCondition = ` AND [${timeField}] IS NOT NULL`;
            }

            if (actualTable === '红门缴费') {
                // 红门缴费：SUM([交易金额])
                selectClause = `SELECT SUM([交易金额]) AS 总计`;
                whereClause = `WHERE [交易金额] IS NOT NULL AND [交易金额] > 0${timeCondition}`;
            } else if (actualTable === '赛菲姆道闸') {
                // 赛菲姆道闸：SUM([支付金额])，排除线下现金和平台现金支付
                selectClause = `SELECT SUM([支付金额]) AS 总计`;
                whereClause = `WHERE [支付金额] IS NOT NULL AND [支付金额] > 0 AND LTRIM(RTRIM([支付方式])) NOT IN ('线下现金', '平台现金支付') AND [支付方式] IS NOT NULL${timeCondition}`;
            }

            // 构建完整SQL
            let sql = `${selectClause} FROM [${actualTable}] ${whereClause}`;
            debugLog('停车收入表生成的SQL', {
                table: actualTable,
                sql: sql,
                timeCondition: timeCondition,
                timeInfo: timeInfo
            });
            sqlParts.push(sql);
            continue; // 跳过后续处理
        }

        // 检测是否需要分组查询（如"前十"、"排名"等）
        if (isGroupBy) {
            // 不在这里使用TOP，在最后合并时使用TOP
            
            // 判断是否是按时间维度分组的查询（日期/月份/年份）
            // 除了"哪一天/哪一月/哪一年"这类问法，也支持"最多的N天"、"最大的N天"、"最少的N天"、"最小的N天"、"前N天"、"每天"等按天排名的说法
            // 也支持"最多的N个月"、"最大的N个月"等按月份排名的说法
            const isDateGroupBy =
                message.includes('哪一天') || message.includes('哪一日') || message.includes('哪天') || message.includes('哪日') || message.includes('每天') ||
                (message.includes('天') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                 message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)));
            const isMonthGroupBy = message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月') || message.includes('每月') || message.includes('每个月') ||
                (message.includes('月') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                 message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)));
            const isYearGroupBy = message.includes('哪一年') || message.includes('哪年') || message.includes('每年');
            const isTimeGroupBy = isDateGroupBy || isMonthGroupBy || isYearGroupBy;
            
            // 判断分组字段
            let groupByFields = '';
            if (isTimeGroupBy) {
                // 按时间维度分组：使用时间字段
                let groupByExpr = '';
                let selectTimeExpr = '';
                let timeAlias = '';
                
                if (isDateGroupBy) {
                    // 按日期分组
                    groupByExpr = `CAST([${timeField}] AS DATE)`;
                    selectTimeExpr = `CAST([${timeField}] AS DATE)`;
                    timeAlias = '日期';
                } else if (isMonthGroupBy) {
                    // 按月份分组
                    // 注意：GROUP BY和SELECT必须保持一致，使用相同的表达式以便UNION ALL合并
                    // 使用"YYYY-MM"格式来表示月份
                    // 例如：2025年1月显示为"2025-01"，2025年2月显示为"2025-02"
                    // 使用字符串拼接方式，兼容所有SQL Server版本
                    groupByExpr = `CAST(YEAR([${timeField}]) AS VARCHAR) + '-' + RIGHT('0' + CAST(MONTH([${timeField}]) AS VARCHAR), 2)`;
                    selectTimeExpr = `CAST(YEAR([${timeField}]) AS VARCHAR) + '-' + RIGHT('0' + CAST(MONTH([${timeField}]) AS VARCHAR), 2)`;
                    timeAlias = '日期';
                } else if (isYearGroupBy) {
                    // 按年份分组
                    groupByExpr = `YEAR([${timeField}])`;
                    selectTimeExpr = `YEAR([${timeField}])`;
                    timeAlias = '年份';
                }
                
                // 根据查询字段确定别名（注意：两个表的字段名不同，但这里使用统一的别名）
                let sumAlias = '总计';
                if (message.includes('充电电量') || message.includes('电量')) {
                    sumAlias = '总电量';
                } else if (message.includes('服务费')) {
                    sumAlias = '总服务费';
                } else if (message.includes('费用') || message.includes('金额') || message.includes('收入')) {
                    sumAlias = '总金额';
                } else if (message.includes('订单数量') || message.includes('订单数') || message.includes('多少单')) {
                    sumAlias = '订单数';
                }
                
                // 对于时间分组查询，需要检查字段是否需要类型转换
                // 特来电表的某些字段（充电电量、充电服务费、充电电费等）可能是nvarchar类型，需要转换
                // 能科表的字段通常是数值类型，直接使用即可
                // 滴滴表的某些字段已在字段配置中使用CAST转换
                let sumExpression = tableQueryColumn;

                // 检查是否是特来电表的字段名包含括号的字段（如[充电服务费(元)]、[充电电量(度)]、[充电电费(元)]、[充电费用(元)]等）
                // 这些字段可能是nvarchar类型，需要CAST转换
                if (actualTable === '特来电' && tableQueryColumn.includes('(') && !tableQueryColumn.includes('CAST')) {
                    // 字段名包含括号，可能是nvarchar类型，需要转换
                    sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
                }
                // 能科表的服务费和电费字段已经在字段配置中使用了CAST转换，直接使用即可
                // 滴滴表的服务费和充电电费字段已经在字段配置中使用了CAST转换，直接使用即可

                groupByFields = groupByExpr;
                selectClause = `SELECT ${selectTimeExpr} AS ${timeAlias}, SUM(${sumExpression}) AS ${sumAlias}`;
            } else if (message.includes('枪') || message.includes('终端')) {
                // 对于特来电表的充电电量字段和充电电费字段，如果字段可能是字符串类型，需要在SUM中转换
                // 能科表的充电量字段和电费字段是数值类型，不需要转换
                // 滴滴表的充电量字段和充电电费字段是nvarchar类型，需要转换（已在字段配置中处理）
                let sumExpression = tableQueryColumn;
                if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                    // 特来电表的充电电量字段可能是字符串类型，需要转换
                    sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
                } else if (actualTable === '特来电' && (tableQueryColumn === '[充电电费(元)]' || tableQueryColumn.includes('充电电费(元)'))) {
                    // 特来电表的充电电费字段可能是字符串类型，需要转换
                    sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
                }
                // 能科表的充电量字段和电费字段是数值类型，直接使用即可
                // 滴滴表的充电量字段和充电电费字段已在字段配置中使用CAST转换，直接使用即可
                
                if (actualTable === '特来电') {
                    // 特来电表：将电站名称和终端名称合并为一个字段
                    groupByFields = '[电站名称], [终端名称]';
                    selectClause = `SELECT [电站名称] + '&' + [终端名称] AS 充电枪标识, SUM(${sumExpression}) AS 总电量`;
                } else if (actualTable === '能科') {
                    groupByFields = '[充电桩名称]';
                    selectClause = `SELECT [充电桩名称] AS 充电枪标识, SUM(${sumExpression}) AS 总电量`;
                } else if (actualTable === '滴滴') {
                    // 滴滴表：将场站名称和充电枪ID合并为一个字段
                    groupByFields = '[场站名称], [充电枪ID]';
                    selectClause = `SELECT [场站名称] + '&' + [充电枪ID] AS 充电枪标识, SUM(${sumExpression}) AS 总电量`;
                } else {
                    // 其他表，使用默认分组
                    groupByFields = tableQueryColumn;
                    selectClause = `SELECT ${tableQueryColumn} AS 字段值, SUM(${sumExpression}) AS 总计`;
                }
            } else {
                // 没有指定分组字段，使用查询字段本身分组
                // 对于特来电表的充电电量字段和充电电费字段，如果字段可能是字符串类型，需要在SUM中转换
                // 能科表的充电量字段和电费字段是数值类型，不需要转换
                let sumExpression = tableQueryColumn;
                if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                    sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
                } else if (actualTable === '特来电' && (tableQueryColumn === '[充电电费(元)]' || tableQueryColumn.includes('充电电费(元)'))) {
                    sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
                }
                // 能科表的充电量字段和电费字段是数值类型，直接使用即可
                groupByFields = tableQueryColumn;
                selectClause = `SELECT ${tableQueryColumn} AS 字段值, SUM(${sumExpression}) AS 总计`;
            }
            
            groupByClause = `GROUP BY ${groupByFields}`;
            
            // 判断排序方向（但不在子查询中使用，在最后合并时排序）
            // 这里不添加ORDER BY，在最后合并时统一排序
        } else if (isSum) {
            // 对于特来电表的充电电量字段和充电电费字段，如果字段可能是字符串类型，需要在SUM中转换
            // 能科表的充电量字段和电费字段是数值类型，不需要转换
            // 滴滴表的充电量字段和充电电费字段是nvarchar类型，需要转换（已在字段配置中处理）
            let sumExpression = tableQueryColumn;
            if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            } else if (actualTable === '特来电' && (tableQueryColumn === '[充电电费(元)]' || tableQueryColumn.includes('充电电费(元)'))) {
                sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            }
            // 能科表的充电量字段和电费字段是数值类型，直接使用即可
            // 滴滴表的充电量字段和充电电费字段已在字段配置中使用CAST转换，直接使用即可
            selectClause = `SELECT SUM(${sumExpression}) AS 总计`;
        } else if (isAvg) {
            // 对于特来电表的充电电量字段，如果字段可能是字符串类型，需要在AVG中转换
            // 能科表的充电量字段是数值类型，不需要转换
            let avgExpression = tableQueryColumn;
            if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                avgExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            }
            // 能科表的充电量字段是数值类型，直接使用即可
            selectClause = `SELECT AVG(${avgExpression}) AS 平均值`;
        } else if (isMax) {
            // 对于特来电表的充电电量字段，如果字段可能是字符串类型，需要在MAX中转换
            // 能科表的充电量字段是数值类型，不需要转换
            let maxExpression = tableQueryColumn;
            if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                maxExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            }
            // 能科表的充电量字段是数值类型，直接使用即可
            selectClause = `SELECT MAX(${maxExpression}) AS 最大值`;
        } else if (isMin) {
            // 对于特来电表的充电电量字段，如果字段可能是字符串类型，需要在MIN中转换
            // 能科表的充电量字段是数值类型，不需要转换
            let minExpression = tableQueryColumn;
            if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                minExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            }
            // 能科表的充电量字段是数值类型，直接使用即可
            selectClause = `SELECT MIN(${minExpression}) AS 最小值`;
        } else if (isCount) {
            selectClause = `SELECT COUNT(*) AS 次数`;
        } else {
            // 默认使用SUM，对于特来电表的充电电量字段和充电电费字段，如果字段可能是字符串类型，需要在SUM中转换
            // 能科表的充电量字段和电费字段是数值类型，不需要转换
            // 滴滴表的充电量字段和充电电费字段是nvarchar类型，需要转换（已在字段配置中处理）
            let sumExpression = tableQueryColumn;
            if (actualTable === '特来电' && (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)'))) {
                sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            } else if (actualTable === '特来电' && (tableQueryColumn === '[充电电费(元)]' || tableQueryColumn.includes('充电电费(元)'))) {
                sumExpression = `CAST(LTRIM(RTRIM(${tableQueryColumn})) AS FLOAT)`;
            }
            // 能科表的充电量字段和电费字段是数值类型，直接使用即可
            // 滴滴表的充电量字段和充电电费字段已在字段配置中使用CAST转换，直接使用即可
            selectClause = `SELECT SUM(${sumExpression}) AS 总计`;
        }

        // 构建WHERE条件
        // 对于计算字段（如CAST表达式），需要检查原始字段
        // whereClause已在前面声明，如果不是活动优惠券表，需要在这里初始化
        // 注意：活动优惠券表的特殊处理使用了continue，不会执行到这里
        
        // 电力局表的特殊处理
        if (actualTable === '电力局') {
            // 电力局表的电费是多个字段相加，需要检查所有相关字段
            if (tableQueryColumn.includes('购电费') || tableQueryColumn.includes('输配电量电费')) {
                // 电费计算字段：检查所有相关字段不为空
                whereClause = `WHERE [购电费] IS NOT NULL AND [输配电量电费] IS NOT NULL AND [力调电费] IS NOT NULL AND [基金及附加] IS NOT NULL AND [上网线损费用] IS NOT NULL AND [系统运行费用] IS NOT NULL AND [环境价值费用] IS NOT NULL`;
            } else if (tableQueryColumn === '[电量]') {
                // 电量字段：检查不为空且大于0
                whereClause = `WHERE [电量] IS NOT NULL AND [电量] > 0`;
            } else {
                // 其他字段：检查不为空
                whereClause = `WHERE ${tableQueryColumn} IS NOT NULL`;
            }
        } else if (actualTable === '车颜知己洗车' && tableQueryColumn.includes('CASE WHEN')) {
            // 车颜知己洗车表的特殊处理：需要检查订单状态和使用会员卡字段
            // CASE WHEN 表达式：只统计"已完成"状态的订单
            // 对于非会员卡：需要检查订单金额不为空且为有效数字
            // 对于会员卡：只需要检查使用会员卡字段不为空（计算逻辑是记录数 * 7）
            whereClause = `WHERE [启动时间] IS NOT NULL AND [订单状态] = '已完成' AND [使用会员卡] IS NOT NULL AND (([使用会员卡] = '否' AND [订单金额] IS NOT NULL AND LTRIM(RTRIM([订单金额])) != '' AND ISNUMERIC([订单金额]) = 1) OR [使用会员卡] = '是')`;
        } else if (actualTable === '特来电' && tableQueryColumn.includes('(') && !tableQueryColumn.includes('CAST')) {
            // 特来电表的字段名包含括号的字段（如[充电电量(度)]、[充电服务费(元)]、[充电费用(元)]、[充电电费(元)]等）
            // 这些字段可能是nvarchar类型，需要额外的验证
            // 性能优化：在WHERE条件中只做基本验证，避免使用CAST函数（会导致无法使用索引）
            // 对于充电电量字段，可能是数值类型，直接判断即可
            if (tableQueryColumn === '[充电电量(度)]' || tableQueryColumn.includes('充电电量(度)')) {
                // 充电电量字段可能是数值类型，使用简单条件
                whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND ${tableQueryColumn} > 0`;
            } else {
                // 其他字段（充电服务费、充电电费等）可能是nvarchar类型
                // 在WHERE中只做基本验证，CAST转换在SUM中完成，避免性能问题
                whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND LTRIM(RTRIM(${tableQueryColumn})) != '' AND ISNUMERIC(${tableQueryColumn}) = 1`;
            }
        } else if (actualTable === '能科' && (tableQueryColumn === '[充电量]' || tableQueryColumn.includes('充电量'))) {
            // 能科表的充电量字段：根据实际测试，字段是数值类型，使用简单的验证即可
            // 第一个能正常工作的查询只使用了: [充电量] IS NOT NULL AND [充电量] > 0
            whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND ${tableQueryColumn} > 0`;
        } else if (actualTable === '能科' && (tableQueryColumn.includes('服务费') || tableQueryColumn.includes('消费金额') || tableQueryColumn === '[电费]' || tableQueryColumn.includes('电费'))) {
            // 能科表的服务费、电费和消费金额字段为float类型，直接判断非空和大于0
            whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND ${tableQueryColumn} > 0`;
        } else if (actualTable === '滴滴' && tableQueryColumn.includes('CAST')) {
            // 滴滴表的某些字段是nvarchar类型，已配置为CAST表达式
            // 字段配置中使用了CAST表达式（如充电电量、充电服务费、订单总额），需要验证原始字段
            // 从CAST表达式中提取原始字段名
            const castMatch = tableQueryColumn.match(/CAST\(LTRIM\(RTRIM\(\[([^\]]+)\]\)\) AS FLOAT\)/);
            if (castMatch) {
                const rawField = `[${castMatch[1]}]`;
                whereClause = `WHERE ${rawField} IS NOT NULL AND LTRIM(RTRIM(${rawField})) != '' AND ISNUMERIC(${rawField}) = 1 AND ${tableQueryColumn} > 0`;
            } else {
                // 如果无法提取原始字段，使用安全的默认条件
                whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND ${tableQueryColumn} > 0`;
            }
        } else if (tableQueryColumn.includes('CAST')) {
            // 其他表的CAST表达式：从表达式中提取原始字段
            const castMatch = tableQueryColumn.match(/CAST\([^[]*\[([^\]]+)\]/);
            if (castMatch) {
                const rawField = `[${castMatch[1]}]`;
                whereClause = `WHERE ${rawField} IS NOT NULL AND ${tableQueryColumn} > 0`;
            } else {
                // 如果无法提取原始字段，使用安全的默认条件
                whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND ${tableQueryColumn} > 0`;
            }
        } else if (actualTable === '车海洋洗车消费' && tableQueryColumn === '[返还金额]') {
            // 车海洋洗车消费表的返还金额字段：只检查非空，不检查大于0
            whereClause = `WHERE ${tableQueryColumn} IS NOT NULL`;
        } else {
            // 普通字段：直接检查
            whereClause = `WHERE ${tableQueryColumn} IS NOT NULL AND ${tableQueryColumn} > 0`;
        }

        // 添加时间条件
        if (timeInfo.hasTime && timeInfo.startDate) {
            // 电力局表使用"年"和"月"字段，而不是日期字段
            if (actualTable === '电力局') {
                const tableConfig = TABLE_FIELDS[actualTable];
                const yearField = tableConfig.timeField; // '年'
                const monthField = tableConfig.monthField; // '月'
                
                if (timeInfo.year) {
                    whereClause += ` AND [${yearField}] = ${timeInfo.year}`;
                    if (timeInfo.month) {
                        whereClause += ` AND [${monthField}] = ${timeInfo.month}`;
                    }
                }
            } else {
                // 其他表使用日期字段
                if (timeInfo.startDate === timeInfo.endDate) {
                    whereClause += ` AND CAST([${timeField}] AS DATE) = '${timeInfo.startDate}'`;
                } else {
                    // 对于月份查询，使用 < 'nextMonth-01' 格式（与示例查询一致）
                    // 对于全年查询，使用 < 'nextYear-01-01' 格式
                    if (timeInfo.year && timeInfo.month && !timeInfo.day) {
                        // 月份查询：如2025年12月 -> >= '2025-12-01' AND < '2026-01-01'
                        const nextMonth = timeInfo.month === 12 ? 1 : timeInfo.month + 1;
                        const nextYear = timeInfo.month === 12 ? timeInfo.year + 1 : timeInfo.year;
                        whereClause += ` AND [${timeField}] >= '${timeInfo.startDate}' AND [${timeField}] < '${nextYear}-${String(nextMonth).padStart(2, '0')}-01'`;
                    } else if (timeInfo.year && !timeInfo.month) {
                        // 全年查询：如2025年 -> >= '2025-01-01' AND < '2026-01-01'
                        whereClause += ` AND [${timeField}] >= '${timeInfo.startDate}' AND [${timeField}] < '${timeInfo.year + 1}-01-01'`;
                    } else {
                        // 其他情况（日期范围）：使用原来的格式
                        whereClause += ` AND [${timeField}] >= '${timeInfo.startDate}' AND [${timeField}] <= '${timeInfo.endDate} 23:59:59'`;
                    }
                }
            }
        }
        // 注意：当没有时间信息时，不添加时间字段的非空检查，查询数据库的所有数据

        // 添加特殊条件
        // 赛菲姆道闸：支付方式过滤
        // 注意：如果是"停车收入"查询，已经在特殊处理中设置了排除线下现金和平台现金支付的逻辑，这里不再重复处理
        if (actualTable === '赛菲姆道闸' && !message.includes('停车收入')) {
            whereClause += " AND ([支付方式] = '微信支付' OR [支付方式] = '支付宝支付')";
        }

        // 收钱吧：交易状态过滤
        if (actualTable === '收钱吧') {
            whereClause += " AND [交易状态] = '成功'";
        }

        // 电力局表：变压器编号筛选（四方坪、高岭）
        if (actualTable === '电力局') {
            if (message.includes('四方坪')) {
                // 四方坪：3118481453 和 3111439077
                whereClause += " AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')";
            } else if (message.includes('高岭')) {
                // 高岭：4350001671599
                whereClause += " AND [变压器编号] = '4350001671599'";
            }
            // 如果查询中没有"四方坪"和"高岭"，不添加任何条件，查询所有数据
        }

        // 添加额外条件（四方坪、高岭）- 特来电表
        whereClause += extraCondition;
        
        // 对于分组查询，需要添加分组字段的非空条件
        if (isGroupBy) {
            // 判断是否是按时间维度分组的查询
            const isDateGroupBy = message.includes('哪一天') || message.includes('哪一日') || message.includes('哪天') || message.includes('哪日') || message.includes('每天') ||
                (message.includes('天') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                 message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)));
            const isMonthGroupBy = message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月') || message.includes('每月') || message.includes('每个月') ||
                (message.includes('月') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                 message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)));
            const isYearGroupBy = message.includes('哪一年') || message.includes('哪年') || message.includes('每年');
            const isTimeGroupBy = isDateGroupBy || isMonthGroupBy || isYearGroupBy;
            
            if (message.includes('枪') || message.includes('终端')) {
                if (actualTable === '特来电') {
                    whereClause += ` AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL`;
                } else if (actualTable === '能科') {
                    whereClause += ` AND [充电桩名称] IS NOT NULL`;
                } else if (actualTable === '滴滴') {
                    whereClause += ` AND [场站名称] IS NOT NULL AND [充电枪ID] IS NOT NULL`;
                }
            }
        }

        // 构建SQL
        let sql = `${selectClause} FROM [${actualTable}] ${whereClause}`;
        if (groupByClause) {
            sql += ` ${groupByClause}`;
        }
        // 注意：对于分组查询，不在子查询中使用ORDER BY，避免与UNION ALL冲突
        // ORDER BY只在最后合并时使用
        
        sqlParts.push(sql);
    }

    let finalSQL = '';
    
    // 如果是分组查询，需要特殊处理
    if (isGroupBy) {
        // 判断是否是按时间维度分组的查询
        // 除了"哪一天/哪一月/哪一年"这类问法，也支持"最多的N天"、"最大的N天"、"最少的N天"、"最小的N天"、"前N天"、"每天"等按天排名的说法
        // 也支持"最多的N个月"、"最大的N个月"等按月份排名的说法
        const isDateGroupBy = message.includes('哪一天') || message.includes('哪一日') || message.includes('哪天') || message.includes('哪日') || message.includes('每天') ||
                              (message.includes('天') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                               message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)));
        const isMonthGroupBy = message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月') || message.includes('每月') || message.includes('每个月') ||
                              (message.includes('月') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
                               message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)));
        const isYearGroupBy = message.includes('哪一年') || message.includes('哪年') || message.includes('每年');
        const isTimeGroupBy = isDateGroupBy || isMonthGroupBy || isYearGroupBy;
        
        // 对于分组查询，如果有多个表，需要合并结果后再排序
        if (sqlParts.length > 1) {
            let unionSQL = sqlParts.join(' UNION ALL ');
            
            // 如果是时间分组查询，需要先按时间合并（相同时间的数据相加），然后再排序
            if (isTimeGroupBy) {
                // 根据查询类型确定时间字段别名
                // 注意：按月份分组使用"YYYY-MM"格式，按日期分组使用"YYYY-MM-DD"格式，别名都是'日期'
                let timeAlias = '日期';
                let groupByTimeAlias = '日期';
                if (isYearGroupBy) {
                    timeAlias = '年份';
                    groupByTimeAlias = '年份';
                }
                // 按月份分组使用"YYYY-MM"格式，按日期分组使用"YYYY-MM-DD"格式
                
                // 根据查询字段确定别名
                let sumAlias = '总计';
                let orderByField = '总计';
                if (message.includes('充电电量') || message.includes('电量')) {
                    sumAlias = '总电量';
                    orderByField = '总电量';
                } else if (message.includes('服务费')) {
                    sumAlias = '总服务费';
                    orderByField = '总服务费';
                } else if (message.includes('费用') || message.includes('金额') || message.includes('收入')) {
                    sumAlias = '总金额';
                    orderByField = '总金额';
                } else if (message.includes('订单数量') || message.includes('订单数') || message.includes('多少单')) {
                    sumAlias = '订单数';
                    orderByField = '订单数';
                }
                
                // 按时间合并：SELECT 时间字段, SUM(别名) AS 别名 FROM (UNION ALL的结果) GROUP BY 时间字段
                const extractedNum = extractNumberFromMessage(message);
                // 如果问"每年"、"每月"等列出所有时间段的问题，不使用TOP限制，否则默认取1条（哪一天/哪一月/哪一年）
                const isListAll = message.includes('每年') || message.includes('每月') || message.includes('每个月') || message.includes('每天');
                const topNum = extractedNum !== null ? extractedNum : (isListAll ? 999 : 1);
                // 判断排序方向
                let orderDir = 'DESC';
                if (message.includes('最少') || message.includes('最低') || message.includes('最小')) {
                    orderDir = 'ASC';
                }
                // 如果需要列出所有，不使用TOP限制
                if (isListAll && extractedNum === null) {
                    finalSQL = `SELECT ${timeAlias}, SUM(${sumAlias}) AS ${sumAlias} FROM (${unionSQL}) AS combined GROUP BY ${groupByTimeAlias} ORDER BY ${timeAlias}`;
                } else {
                    finalSQL = `SELECT TOP ${topNum} ${timeAlias}, SUM(${sumAlias}) AS ${sumAlias} FROM (${unionSQL}) AS combined GROUP BY ${groupByTimeAlias} ORDER BY ${sumAlias} ${orderDir}`;
                }
            } else {
                // 涉及枪/终端的查询，字段已经统一为：充电枪标识, 总电量
                // 特来电表：SELECT [电站名称] + '&' + [终端名称] AS 充电枪标识, SUM(...) AS 总电量
                // 能科表：SELECT [充电桩名称] AS 充电枪标识, SUM(...) AS 总电量
                // 两个表的字段结构已经一致，可以直接UNION ALL
                // 重新排序并取TOP
                const extractedNum = extractNumberFromMessage(message);
                const topNum = extractedNum !== null ? extractedNum : 10;
                // 判断排序方向
                let orderDir = 'DESC';
                if (message.includes('最少') || message.includes('最低') || message.includes('最小')) {
                    orderDir = 'ASC';
                }
                finalSQL = `SELECT TOP ${topNum} * FROM (${unionSQL}) AS combined ORDER BY 总电量 ${orderDir}`;
            }
        } else {
            // 单个表，直接添加TOP和ORDER BY
            const extractedNum = extractNumberFromMessage(message);
            // 如果问"每年"、"每月"等列出所有时间段的问题，不使用TOP限制
            const isListAll = message.includes('每年') || message.includes('每月') || message.includes('每个月') || message.includes('每天');
            const topNum = extractedNum !== null ? extractedNum : (isTimeGroupBy ? (isListAll ? 999 : 1) : 10);
            const sql = sqlParts[0];
            // 判断排序方向
            let orderDir = 'DESC';
            if (message.includes('最少') || message.includes('最低') || message.includes('最小')) {
                orderDir = 'ASC';
            }
            // 对于时间分组查询，根据查询字段确定排序字段
            let orderByField = '总电量';
            if (isTimeGroupBy) {
                if (message.includes('充电电量') || message.includes('电量')) {
                    orderByField = '总电量';
                } else if (message.includes('服务费')) {
                    orderByField = '总服务费';
                } else if (message.includes('费用') || message.includes('金额') || message.includes('收入')) {
                    orderByField = '总金额';
                } else if (message.includes('订单数量') || message.includes('订单数') || message.includes('多少单')) {
                    orderByField = '订单数';
                } else {
                    orderByField = '总计';
                }
            } else if (message.includes('枪') || message.includes('终端')) {
                orderByField = '总电量';
            } else {
                orderByField = '总计';
            }
            // 如果需要列出所有时间段，按时间排序而非按数值排序
            // 注意：按月份分组使用"YYYY-MM"格式，按日期分组使用"YYYY-MM-DD"格式，别名都是'日期'
            if (isTimeGroupBy && isListAll && extractedNum === null) {
                const timeAlias = isYearGroupBy ? '年份' : '日期';
                finalSQL = `SELECT * FROM (${sql}) AS t ORDER BY ${timeAlias}`;
            } else {
                finalSQL = `SELECT TOP ${topNum} * FROM (${sql}) AS t ORDER BY ${orderByField} ${orderDir}`;
            }
        }
    } else {
        finalSQL = sqlParts.join(' UNION ALL ');

        // 如果有多个表，需要再次聚合
        if (sqlParts.length > 1) {
            if (isSum) {
                finalSQL = `SELECT SUM(总计) AS 总计 FROM (${finalSQL}) AS combined`;
            } else if (isAveragePerPeriod) {
                // "平均每个月/每年/每天"查询：先计算总和，然后除以月数/年数/天数
                // 确定除数（月数、年数或天数）
                let divisor = 12; // 默认一年12个月
                if (message.includes('每天')) {
                    // 计算天数
                    if (timeInfo.year && timeInfo.month) {
                        // 计算指定月份的天数
                        const year = timeInfo.year;
                        const month = timeInfo.month;
                        const daysInMonth = new Date(year, month, 0).getDate();
                        divisor = daysInMonth;
                    } else if (timeInfo.year) {
                        // 计算指定年份的天数（闰年366天，平年365天）
                        const year = timeInfo.year;
                        const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                        divisor = isLeapYear ? 366 : 365;
                    } else if (timeInfo.startDate && timeInfo.endDate) {
                        // 计算日期范围的天数
                        const start = new Date(timeInfo.startDate);
                        const end = new Date(timeInfo.endDate);
                        divisor = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
                    }
                } else if (timeInfo.year && !timeInfo.month) {
                    // 如果指定了年份但没有月份，说明是整年的平均每个月
                    divisor = 12;
                } else if (message.includes('每年')) {
                    // 如果是"每年"，需要计算跨越的年份数
                    // 暂时默认为1年，实际应该根据startDate和endDate计算
                    divisor = 1;
                }
                finalSQL = `SELECT SUM(总计) / ${divisor} AS 平均值 FROM (${finalSQL}) AS combined`;
            } else if (isAvg) {
                finalSQL = `SELECT AVG(平均值) AS 平均值 FROM (${finalSQL}) AS combined`;
            } else if (isMax) {
                finalSQL = `SELECT MAX(最大值) AS 最大值 FROM (${finalSQL}) AS combined`;
            } else if (isMin) {
                finalSQL = `SELECT MIN(最小值) AS 最小值 FROM (${finalSQL}) AS combined`;
            } else if (isCount) {
                finalSQL = `SELECT SUM(次数) AS 次数 FROM (${finalSQL}) AS combined`;
            }
        } else if (isAveragePerPeriod) {
            // 单表的"平均每个月/每年/每天"查询
            let divisor = 12;
            if (message.includes('每天')) {
                // 计算天数
                if (timeInfo.year && timeInfo.month) {
                    // 计算指定月份的天数
                    const year = timeInfo.year;
                    const month = timeInfo.month;
                    const daysInMonth = new Date(year, month, 0).getDate();
                    divisor = daysInMonth;
                } else if (timeInfo.year) {
                    // 计算指定年份的天数（闰年366天，平年365天）
                    const year = timeInfo.year;
                    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                    divisor = isLeapYear ? 366 : 365;
                } else if (timeInfo.startDate && timeInfo.endDate) {
                    // 计算日期范围的天数
                    const start = new Date(timeInfo.startDate);
                    const end = new Date(timeInfo.endDate);
                    divisor = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
                }
            } else if (timeInfo.year && !timeInfo.month) {
                divisor = 12;
            } else if (message.includes('每年')) {
                divisor = 1;
            }
            finalSQL = `SELECT SUM(总计) / ${divisor} AS 平均值 FROM (${finalSQL}) AS combined`;
        }
    }

    debugLog('生成的SQL', finalSQL);
    return finalSQL;
}

// 使用DeepSeek分析问题并生成SQL
async function analyzeQuestionWithAI(message, tables, metadata = {}) {
    // 1. 毛利 / 毛利润相关问题：统一走规则匹配，保证和文档示例、单年查询逻辑完全一致，且避免调用外部AI超时
    if (message.includes('毛利') || message.includes('毛利润')) {
        debugLog('检测到毛利/毛利润相关问题，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 1.5. 电量损耗相关问题：统一走规则匹配，保证计算逻辑正确（电力局只有月数据，不能直接计算每一天）
    if (message.includes('电量损耗') && (message.includes('四方坪') || message.includes('高岭'))) {
        debugLog('检测到电量损耗相关问题，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 1.6. 综合业务收入/金额/流水相关问题：统一走规则匹配，保证计算逻辑正确
    // 注意："综合收入"是"综合业务收入"的简称，也应该识别
    // 但注意：如果包含"充电"关键词，应该查询充电表，而不是综合业务收入表
    if ((message.includes('综合业务收入') || message.includes('综合业务金额') || message.includes('综合业务流水') || message.includes('综合收入')) && !message.includes('充电')) {
        debugLog('检测到综合业务相关问题，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 2. 停车收入相关问题：统一走规则匹配，按照固定公式计算（红门缴费 + 赛菲姆道闸，排除线下现金和平台现金支付）
    if (message.includes('停车收入')) {
        debugLog('检测到停车收入相关问题，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 3. 枪/终端相关的平均值查询：统一走规则匹配（包含固定枪数、时间过滤规则等复杂逻辑）
    const hasGunOrTerminal = message.includes('枪') || message.includes('终端');
    const hasAverage = message.includes('平均');
    if (hasGunOrTerminal && hasAverage) {
        debugLog('检测到枪/终端相关的平均值查询，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 4. 平均每度电的查询：统一走规则匹配（需要计算总服务费÷总电量，不是简单的AVG）
    const hasPerKwhAverage = message.includes('平均') && (message.includes('每度电') || message.includes('每度'));
    if (hasPerKwhAverage) {
        debugLog('检测到平均每度电查询，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 检查是否是活动优惠券表的查询，如果是，强制使用规则匹配（因为计算逻辑复杂，AI可能无法正确生成）
    if (tables.includes('活动优惠券')) {
        debugLog('检测到活动优惠券表查询，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 检查是否是四方坪的时间维度查询（哪一天/哪一月/哪一年/每年/每月/每天），且涉及充电表
    // 这类查询需要正确合并多个表的数据，使用规则匹配更可靠
    // 即使只有单个充电表，也应该使用规则匹配，因为AI可能生成错误的分组SQL
    // 注意：排除"平均每个月"、"平均每年"、"平均每天"这类查询（这些不需要分组，只需要总和除以月数/年数/天数）
    const isAveragePerPeriod = message.includes('平均') && (message.includes('每个月') || message.includes('每月') || message.includes('每年') || message.includes('每天'));
    const isTimeDimensionQuery = !isAveragePerPeriod && (
        message.includes('哪一天') || message.includes('哪一日') || message.includes('哪天') || message.includes('哪日') ||
        message.includes('哪一月') || message.includes('哪个月') || message.includes('哪月') ||
        message.includes('哪一年') || message.includes('哪年') ||
        message.includes('每年') || message.includes('每月') || message.includes('每个月') || message.includes('每天') ||
        (message.includes('天') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
         message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message))) ||
        (message.includes('月') && (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
         message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)))
    );
    const hasChargingTables = (tables.includes('特来电') || tables.includes('能科') || tables.includes('滴滴'));
    if (hasChargingTables && isTimeDimensionQuery) {
        debugLog('检测到充电表的时间维度查询，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 检查是否是"平均每个月/每年/每天"查询（如"2025年平均每个月的充电服务费是多少"）
    // 这类查询需要计算总和然后除以月数/年数/天数，不需要分组
    if (hasChargingTables && isAveragePerPeriod) {
        debugLog('检测到平均每个月/每年/每天查询，使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 额外优化：按"天"排名查询（例如"充电服务费最多的15天"、"充电电量最多的11天"、"充电费用最大的6天"等），
    // 需要合并充电表（特来电+能科+滴滴，根据时间过滤规则），优先使用规则生成SQL，避免AI生成错误SQL
    // 这类查询的关键特征：包含"天"和"最多/最大/最高/最少/最小/最低/前N"等排名关键词
    const isDailyTopQuery = 
        message.includes('天') &&
        (message.includes('最多') || message.includes('最大') || message.includes('最高') ||
         message.includes('最少') || message.includes('最小') || message.includes('最低') || /前(\d+|几)/.test(message)) &&
        (message.includes('充电电量') || message.includes('电量') || 
         message.includes('充电服务费') || message.includes('服务费') ||
         message.includes('充电费用') || message.includes('费用') || message.includes('收入') || message.includes('金额'));
    if (hasChargingTables && isDailyTopQuery) {
        debugLog('检测到按天排名查询（充电表），使用规则匹配生成SQL');
        return generateSQLByRules(message, tables);
    }

    // 检查是否是复杂平均值计算（如"平均每把枪每天"），这种查询必须由AI处理
    const isComplexAvg = (message.includes('平均') && (message.includes('每把枪') || message.includes('每天') || message.includes('每月') || message.includes('每个月')));

    if (!ENABLE_DEEPSEEK) {
        // 如果是复杂平均值计算，但DeepSeek被禁用，抛出错误提示
        if (isComplexAvg) {
            throw new Error('复杂平均值计算需要启用DeepSeek AI');
        }
        debugLog('DeepSeek已禁用，使用规则匹配');
        return generateSQLByRules(message, tables);
    }

    // 如果是复杂平均值计算，直接使用AI，不尝试规则匹配
    if (isComplexAvg) {
        debugLog('检测到复杂平均值计算，直接使用AI处理');
    }

    try {
        debugLog('开始调用DeepSeek API分析问题');

        // 获取所有表的时间范围
        let timeRangesInfo = '';
        try {
            const timeRanges = await getTableTimeRanges();
            timeRangesInfo = '\n\n**数据库表的时间范围**：\n';
            for (const [tableName, range] of Object.entries(timeRanges)) {
                if (range.error) {
                    timeRangesInfo += `- [${tableName}]：无法获取时间范围（${range.message}）\n`;
                } else {
                    timeRangesInfo += `- [${tableName}]：${range.formatted}\n`;
                }
            }
            timeRangesInfo += '\n**重要提示**：在生成SQL时，请确保查询的时间范围在上述数据范围内，否则可能查询不到数据。\n';
        } catch (error) {
            console.error('获取时间范围失败:', error);
            timeRangesInfo = '\n\n**注意**：无法获取数据库表的时间范围信息。\n';
        }

        // 构建系统提示词，包含所有表的详细信息
        let tableInfo = '';
        for (const table of tables) {
            if (TABLE_FIELDS[table]) {
                const config = TABLE_FIELDS[table];
                tableInfo += `\n\n表名：[${table}]`;
                tableInfo += `\n  时间字段：[${config.timeField}]`;
                tableInfo += `\n  字段映射（用户关键词 -> 实际字段名）：`;

                // 列出所有字段映射
                for (const keyword in config.fields) {
                    const fieldInfo = config.fields[keyword];
                    tableInfo += `\n    "${keyword}" -> ${fieldInfo.column}`;
                }

                // 添加特殊条件说明
                if (table === '特来电') {
                    tableInfo += `\n  **重要WHERE条件（根据查询内容自动筛选）**：
      - 如果查询中没有"四方坪"和"高岭"关键词：查询所有数据（不添加筛选条件）
      - 如果查询中有"四方坪"关键词：添加条件 [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
      - 如果查询中有"高岭"关键词：添加条件 ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')`;
                }
                if (table === '电力局') {
                    tableInfo += `\n  **重要说明**：
      - 时间字段：使用 [年] 和 [月] 字段，不是日期字段
      - 电量字段：使用 [电量]
      - 电费字段：使用 ([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用])
      - **重要WHERE条件（根据查询内容自动筛选）**：
        * 如果查询中没有"四方坪"和"高岭"关键词：查询所有数据（不添加筛选条件）
        * 如果查询中有"四方坪"关键词：添加条件 ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')
        * 如果查询中有"高岭"关键词：添加条件 [变压器编号] = '4350001671599'
      - 时间筛选示例：
        * 查询2024年：WHERE [年] = 2024
        * 查询2024年12月：WHERE [年] = 2024 AND [月] = 12
        * 查询2024年1月至12月：WHERE [年] = 2024 AND [月] >= 1 AND [月] <= 12`;
                }
                if (table === '赛菲姆道闸') {
                    tableInfo += `\n  WHERE条件：[支付方式] = '微信支付' OR [支付方式] = '支付宝支付'`;
                }
                if (table === '收钱吧') {
                    tableInfo += `\n  WHERE条件：[交易状态] = '成功'`;
                }
            }
        }

        // 添加订单数量查询说明
        let orderCountNote = '';
        if (tables.includes('特来电') || tables.includes('能科')) {
            orderCountNote = `\n\n**订单数量查询特别说明**：
- 特来电表：使用 COUNT([订单编号]) 统计订单数
- 能科表：使用 COUNT([卡号]) 统计订单数`;
        }

        // 添加终端/枪查询说明
        let terminalNote = '';
        if ((tables.includes('特来电') || tables.includes('滴滴')) && (message.includes('枪') || message.includes('终端'))) {
            terminalNote = `\n\n**终端/枪查询特别说明**：
- **重要**：凡是涉及到枪或充电枪或终端的问题，需要根据时间过滤规则在特来电表和滴滴表中查询数据
  - 特来电表：使用 [电站名称] + [终端名称] 组合作为唯一标识（因为不同电站可能有相同的终端名称）
  - 滴滴表：使用 [场站名称] + [充电枪ID] 组合作为唯一标识
- **查询示例（仅特来电表）**："哪把枪充电电量最多"
  SELECT TOP 1 [电站名称], [终端名称], SUM([充电电量(度)]) AS 总电量
  FROM [特来电]
  WHERE [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL AND [充电电量(度)] > 0
  GROUP BY [电站名称], [终端名称]
  ORDER BY 总电量 DESC

- **查询示例（仅滴滴表）**："2026年2月哪把枪充电电量最多"（根据时间过滤规则，2026年2月只查询滴滴表）
  SELECT TOP 1 [场站名称], [充电枪ID], SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) AS 总电量
  FROM [滴滴]
  WHERE [充电完成时间] >= '2026-02-01' AND [充电完成时间] < '2026-03-01'
    AND [场站名称] IS NOT NULL AND [充电枪ID] IS NOT NULL
    AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
  GROUP BY [场站名称], [充电枪ID]
  ORDER BY 总电量 DESC

- **查询示例（合并查询）**："2025年11月哪把枪充电电量最多"（根据时间过滤规则，2025年11月需要查询特来电和滴滴表）
  SELECT TOP 1 场站名称, 充电枪ID, 总电量 FROM (
    SELECT [电站名称] AS 场站名称, [终端名称] AS 充电枪ID, SUM([充电电量(度)]) AS 总电量
    FROM [特来电]
    WHERE [充电结束时间] >= '2025-11-01' AND [充电结束时间] < '2025-12-01'
      AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL AND [充电电量(度)] > 0
    GROUP BY [电站名称], [终端名称]
    UNION ALL
    SELECT [场站名称], [充电枪ID], SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) AS 总电量
    FROM [滴滴]
    WHERE [充电完成时间] >= '2025-11-01' AND [充电完成时间] < '2025-12-01'
      AND [场站名称] IS NOT NULL AND [充电枪ID] IS NOT NULL
      AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
    GROUP BY [场站名称], [充电枪ID]
  ) AS 合并结果
  ORDER BY 总电量 DESC

- **平均值计算**：请参考"特殊查询逻辑A"中的详细说明，必须遵循"数据 ÷ 时间 ÷ 对象"的公式

- **重要**：结果必须同时显示场站名称/电站名称和充电枪ID/终端名称`;
        }

        // 添加充电电量查询示例说明
        let chargingNote = '';
        if (tables.includes('特来电') || tables.includes('能科') || tables.includes('滴滴')) {
            chargingNote = `\n\n**充电电量查询特别说明**：
- **重要**：查询"充电电量"时，必须使用正确的字段名：
  - 特来电表：使用 [充电电量(度)]
  - 能科表：使用 [充电量]（注意：能科表的字段名是 [充电量]，不是 [充电电量]）
  - 滴滴表：使用 CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)（注意：括号是中文括号，字段类型是nvarchar需要转换）
- **重要**：必须首先应用时间过滤规则，根据查询时间决定需要查询哪些表
- **重要**：当查询包含具体车牌号时（如"湘AFX0922的充电电量"），三个表都需要添加车牌号筛选条件：
  - 特来电表：使用 [判定车牌号] 字段
  - 能科表：使用 [车牌号] 字段
  - 滴滴表：使用 [车牌号] 字段
- **简单查询示例**："2024年充电电量是多少"
  * **时间过滤规则应用**：2024年需要查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
  SELECT
      (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0), 0) +
       ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0)) AS 总充电电量
- **四方坪查询示例**："2024年四方坪充电电量是多少"
  * **时间过滤规则应用**：2024年只查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
  SELECT
      (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
       ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0)) AS 总充电电量
- **四方坪查询示例（无时间信息）**："四方坪充电电量是多少"
  * **重要**：当没有时间信息时，查询数据库的所有数据，不需要判断时间字段是否为空
  * **时间过滤规则应用**：根据当前时间，可能需要查询特来电、能科、滴滴三个表
  SELECT
      (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
       ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [充电量] IS NOT NULL AND [充电量] > 0), 0) +
       ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴] WHERE [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0), 0)) AS 总充电电量
  * **关键点**：当没有时间条件时，不添加时间字段的非空检查，查询所有数据
- **四方坪查询示例（包含滴滴表）**："2025年11月四方坪充电电量是多少"
  * **时间过滤规则应用**：2025年11月需要查询特来电和滴滴表（不查询能科表，因为能科表2024年5月后没有数据）
  SELECT
      (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2025-11-01' AND [充电结束时间] < '2025-12-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
       ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴] WHERE [充电完成时间] >= '2025-11-01' AND [充电完成时间] < '2025-12-01' AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0), 0)) AS 总充电电量
- **性能说明**：使用子查询直接计算，避免CROSS JOIN，提高查询效率。必须使用日期范围，不要使用YEAR()函数。`;
        }

        // 添加充电电费查询示例说明
        let chargingFeeNote = '';
        if (tables.includes('特来电') || tables.includes('能科') || tables.includes('滴滴')) {
            chargingFeeNote = `\n\n**充电电费查询特别说明**：
- **重要**：查询"充电电费"时，必须使用正确的字段名：
  - 特来电表：使用 CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT)（注意：字段类型是nvarchar需要转换）
  - 能科表：使用 [电费]（注意：能科表的字段名是 [电费]，不是 [充电电费]）
  - 滴滴表：使用 CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)（注意：括号是中文括号，字段类型是nvarchar需要转换）
- **重要**：必须首先应用时间过滤规则，根据查询时间决定需要查询哪些表
- **简单查询示例**："2024年充电电费收入是多少"
  * **时间过滤规则应用**：2024年需要查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
  SELECT
      (ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT)) FROM [特来电] WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01' AND [充电电费(元)] IS NOT NULL AND LTRIM(RTRIM([充电电费(元)])) != '' AND ISNUMERIC([充电电费(元)]) = 1 AND CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT) > 0), 0) +
       ISNULL((SELECT SUM([电费]) FROM [能科] WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01' AND [电费] IS NOT NULL AND [电费] > 0), 0)) AS 总充电电费收入
- **四方坪查询示例**："2025年四方坪充电电费收入是多少"
  * **时间过滤规则应用**：2025年需要查询特来电和滴滴表（不查询能科表，因为能科表2024年5月后没有数据）
  SELECT
      (ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT)) FROM [特来电] WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2026-01-01' AND [充电电费(元)] IS NOT NULL AND LTRIM(RTRIM([充电电费(元)])) != '' AND ISNUMERIC([充电电费(元)]) = 1 AND CAST(LTRIM(RTRIM([充电电费(元)])) AS FLOAT) > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
       ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT)) FROM [滴滴] WHERE [充电完成时间] >= '2025-01-01' AND [充电完成时间] < '2026-01-01' AND [充电电费（元）] IS NOT NULL AND LTRIM(RTRIM([充电电费（元）])) != '' AND ISNUMERIC([充电电费（元）]) = 1 AND CAST(LTRIM(RTRIM([充电电费（元）])) AS FLOAT) > 0), 0)) AS 总充电电费收入
- **性能说明**：使用子查询直接计算，避免CROSS JOIN，提高查询效率。必须使用日期范围，不要使用YEAR()函数。必须对nvarchar类型字段进行类型转换和验证。`;
        }

        // 添加微信收入查询示例说明
        let weixinNote = '';
        if (tables.includes('微信商户下单') || tables.includes('微信收款商业版')) {
            weixinNote = `\n\n**微信收入查询特别说明**：
- **重要**：查询"微信收入"时，涉及两个表：微信商户下单 和 微信收款商业版
- **重要**：两个表的收入字段都是计算字段，必须使用完整的计算表达式，不能使用错误的列名如"微信收款商业版收入"
- **正确字段名**：
  - 微信商户下单表：使用 (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))
  - 微信收款商业版表：使用 (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))
- **重要**：在SELECT子句中必须使用实际的计算表达式，如 SUM((CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)))
- **错误示例**（不要这样做）：
  SELECT SUM([微信收款商业版收入]) FROM [微信收款商业版]  -- 错误！不存在这个列名
- **正确示例**："上个月微信收入多少"（假设上个月是2024年11月）
  SELECT 
      (ISNULL(t1.微信商户下单收入, 0) + ISNULL(t2.微信收款商业版收入, 0)) AS 总微信收入
  FROM (
      SELECT SUM((CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))) AS 微信商户下单收入
      FROM [微信商户下单]
      WHERE [交易时间] >= '2024-11-01' AND [交易时间] < '2024-12-01'
        AND [订单金额] IS NOT NULL
        AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0
  ) AS t1
  CROSS JOIN (
      SELECT SUM((CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))) AS 微信收款商业版收入
      FROM [微信收款商业版]
      WHERE [交易时间] >= '2024-11-01' AND [交易时间] < '2024-12-01'
        AND [订单金额] IS NOT NULL
        AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0
  ) AS t2
- **年度查询示例**："2024年微信收入多少"
  SELECT 
      (ISNULL(t1.微信商户下单收入, 0) + ISNULL(t2.微信收款商业版收入, 0)) AS 总微信收入
  FROM (
      SELECT SUM((CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))) AS 微信商户下单收入
      FROM [微信商户下单]
      WHERE YEAR([交易时间]) = 2024
        AND [订单金额] IS NOT NULL
        AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0
  ) AS t1
  CROSS JOIN (
      SELECT SUM((CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0))) AS 微信收款商业版收入
      FROM [微信收款商业版]
      WHERE YEAR([交易时间]) = 2024
        AND [订单金额] IS NOT NULL
        AND (CAST([订单金额] AS FLOAT) - ISNULL(CAST([退款金额] AS FLOAT), 0)) > 0
  ) AS t2
- **关键规则**：
  * 必须使用完整的计算表达式，不能使用别名作为列名
  * 两个表的时间字段都是 [交易时间]
  * 必须过滤空值和无效数据
  * 退款金额字段可能为NULL或空字符串，必须使用ISNULL处理`;
        }

        const systemPrompt = `你是一个SQL查询助手，专门帮助用户根据自然语言问题生成SQL Server 2008 R2查询语句。

数据库版本：SQL Server 2008 R2（不支持2012+的新函数）
数据库名称：chargingdata
${timeRangesInfo}
可用的表和字段信息：${tableInfo}${orderCountNote}${terminalNote}${chargingNote}${chargingFeeNote}${weixinNote}

**⚠️ 重要提醒（请务必遵守）**：
1. CONVERT函数必须有3个参数：CONVERT(VARCHAR(10), [时间字段], 120) AS 日期
   - ❌ 错误：CONVERT(VARCHAR(10), 120) AS 日期 -- 缺少源字段！
   - ✅ 正确：CONVERT(VARCHAR(10), [充电结束时间], 120) AS 日期
2. 按日期分组用：CONVERT(VARCHAR(10), [时间字段], 120)
3. 按月份分组用：CAST(YEAR([时间字段]) AS VARCHAR) + '-' + RIGHT('0' + CAST(MONTH([时间字段]) AS VARCHAR), 2)
   - **重要**：月份必须显示为 "YYYY-MM" 格式，不要显示 "YYYY-MM-01"！
   - ✅ 正确：CAST(YEAR([充电结束时间]) AS VARCHAR) + '-' + RIGHT('0' + CAST(MONTH([充电结束时间]) AS VARCHAR), 2) AS 日期
   - ❌ 错误：CONVERT(VARCHAR(7), [充电结束时间], 120) AS 日期 -- 会生成 "YYYY-MM-01"
4. 禁止在WHERE中使用YEAR()函数筛选年份，必须用日期范围

重要规则：
1. **必须使用字段映射中的实际字段名**，不要自己猜测字段名
2. 例如："充电电量" 在特来电表中对应 [充电电量(度)]，在能科表中对应 [充电量]，在滴滴表中对应 [充电量（度）]
   - **重要**：在SELECT子句中必须使用实际字段名，如 SUM([充电量])，不要使用错误的别名如"能科电量"
   - 可以给字段起别名，如 SUM([充电量]) AS 能科电量总和，但字段名本身必须是 [充电量]
   - 滴滴表的字段名：[充电量（度）]（注意括号是中文括号）
3. 例如："收入" 在特来电表中对应 [充电费用(元)]，在能科表中对应 [消费金额]，在滴滴表中对应 [订单总额（元）]，在收钱吧表中对应 [实收金额]
4. **时间过滤规则（最高优先级）**：凡是需要在"滴滴"、"特来电"和"能科"这三个表中查询数据时，必须首先应用时间过滤规则：
   - **能科表**：2024年5月（含）以后没有数据，即当查询时间在2024年5月（含）以后时，就不需要再去"能科"表中查询数据
   - **特来电表**：2026年2月（含）以后没有数据，即当查询时间在2026年2月（含）以后时，就不需要再去"特来电"表中查询数据
   - **滴滴表**：2025年11月（含）之前没有数据，即当查询时间在2025年11月（含）之前时，就不需要去"滴滴"表中查询数据
   - **重要**：当查询时间同时包含这三个时间段时，就必须要在"滴滴"、"特来电"和"能科"这三个表中同时查询
   - **示例**：
     * 查询2024年4月数据：查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     * 查询2024年5月及以后数据：只查询特来电表（不查询能科表，因为能科表2024年5月后没有数据；不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     * 查询2025年10月数据：只查询特来电表（不查询能科表，因为能科表2024年5月后没有数据；不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     * 查询2025年11月数据：查询特来电和滴滴表（不查询能科表，因为能科表2024年5月后没有数据）
     * 查询2025年12月数据：查询特来电和滴滴表（不查询能科表，因为能科表2024年5月后没有数据）
     * 查询2026年1月数据：查询特来电和滴滴表（能科表2024年5月后没有数据，特来电表2026年2月之前还有数据）
     * 查询2026年2月及以后数据：只查询滴滴表（不查询特来电表，因为特来电表2026年2月后没有数据；不查询能科表，因为能科表2024年5月后没有数据）
4. **所有查询必须过滤空值、0值和空字符串**：WHERE column IS NOT NULL AND column != '' AND column > 0
   - **特殊例外**：车海洋洗车消费表的[返还金额]字段：只检查非空，不检查大于0，即 WHERE [返还金额] IS NOT NULL（不要添加 > 0 条件）
5. 表名和字段名都需要用方括号括起来：[表名]、[字段名]
6. 如果涉及多个表，需要使用UNION ALL合并
7. **表名必须完全准确**，不要添加"表"字。例如使用 [特来电] 而不是 [特来电表]
8. **只能使用字段映射中列出的字段名**，不要使用任何未列出的字段
9. **禁止使用SQL Server 2012+的函数**，例如：DATEFROMPARTS, EOMONTH, FORMAT等
   - **日期转换**：不要使用CAST(... AS DATE)在GROUP BY中，使用CONVERT(VARCHAR(10), [时间字段], 120)代替
   - **CONVERT函数参数顺序（极其重要）**：
     * 第1个参数：VARCHAR(10)（目标数据类型，必须指定长度）
     * 第2个参数：[时间字段]（源字段，要转换的字段）
     * 第3个参数：120（格式代码，表示YYYY-MM-DD）
     * 完整写法：CONVERT(VARCHAR(10), [充电结束时间], 120) AS 日期
     * ❌ 错误：CONVERT(VARCHAR(10), 120) AS 日期 -- 缺少源字段！
   - **原因**：CAST AS DATE在SQL Server 2008 R2的GROUP BY中可能导致语法错误
10. **性能优化（极其重要，避免超时）**：
    - **禁止使用YEAR()函数进行年份筛选**，必须使用日期范围代替
    - **禁止使用复杂的CROSS JOIN**，对于对比查询直接使用减法
    - **对比查询只返回增减量**，不要计算增长率百分比（会增加复杂度）
    - **使用ISNULL包装所有可能为NULL的子查询结果**
    - 示例（正确）：[充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01'
    - 示例（错误，会超时）：YEAR([充电结束时间]) = 2024
11. 时间筛选使用传统方式：
    - 某一天：CAST([时间字段] AS DATE) = '2024-12-13'（只在WHERE中使用）
    - 某个月：[时间字段] >= '2024-12-01' AND [时间字段] < '2025-01-01'
    - **某一年（重要：必须使用日期范围，不要使用YEAR()函数）**：[时间字段] >= '2024-01-01' AND [时间字段] < '2025-01-01'
      * **性能说明**：使用日期范围可以利用索引，查询速度快；使用YEAR函数会导致无法使用索引，大数据量时会超时
    - **按日期分组（重要）**：使用CONVERT(VARCHAR(10), [时间字段], 120)转换为日期字符串
      * **参数顺序**：CONVERT(第1个=数据类型, 第2个=源字段, 第3个=格式代码) AS 别名
      * **完整写法**：CONVERT(VARCHAR(10), [充电结束时间], 120) AS 日期
      * **常见错误**：CONVERT(VARCHAR(10), 120) -- ❌ 缺少源字段！
      * VARCHAR必须指定长度(10)
      * 120是格式代码，必须放在第3个参数位置
      * 不要使用CAST(... AS DATE)在GROUP BY中，会导致语法错误
      * GROUP BY子句必须重复CONVERT表达式，不能使用别名
      * 示例：
        SELECT CONVERT(VARCHAR(10), [充电结束时间], 120) AS 日期, SUM(...) AS 总计
        FROM [表名]
        GROUP BY CONVERT(VARCHAR(10), [充电结束时间], 120)
    - **相对时间表达式**：
      * "今年"：当前年份
        - 如果当前是2025年：[时间字段] >= '2025-01-01' AND [时间字段] < '2026-01-01'
      * "去年"：当前年份 - 1
        - 如果当前是2025年，去年是2024年：[时间字段] >= '2024-01-01' AND [时间字段] < '2025-01-01'
      * "前年"：当前年份 - 2
        - 如果当前是2025年，前年是2023年：[时间字段] >= '2023-01-01' AND [时间字段] < '2024-01-01'
        - **重要**：前年 = YEAR(GETDATE()) - 2，必须使用日期范围，不要使用YEAR()函数
      * "上个月"或"上月"：需要计算上个月的日期范围
        - 如果当前是2024年12月，上个月是2024年11月：[时间字段] >= '2024-11-01' AND [时间字段] < '2024-12-01'
        - 如果当前是2025年1月，上个月是2024年12月：[时间字段] >= '2024-12-01' AND [时间字段] < '2025-01-01'
        - 计算公式：上个月 = 当前月份 - 1，如果当前月份是1月，则上个月是去年12月
      * "这个月"或"本月"：当前月份
        - 如果当前是2024年12月：[时间字段] >= '2024-12-01' AND [时间字段] < '2025-01-01'
      * 获取当前日期使用：GETDATE()
      * 获取当前年份使用：YEAR(GETDATE())
      * 获取当前月份使用：MONTH(GETDATE())
      * **注意**：YEAR()和MONTH()只能用于GETDATE()获取当前值，不要用于字段筛选
12. 月份最后一天使用：DATEADD(DAY, -1, DATEADD(MONTH, 1, '2024-12-01'))
13. **nvarchar类型字段需要转换**：
    - **微信表**：订单金额和退款金额字段是nvarchar类型，需要转换：CAST([订单金额] AS FLOAT)
    - **超时占位费表**：应收金额字段是nvarchar类型，需要转换：CAST([应收金额] AS FLOAT)
    - 使用CAST转换时，必须处理NULL值和无效数据，使用ISNULL或CASE WHEN进行验证

特殊查询逻辑：
A. **平均值计算**（重要：所有平均值计算必须遵循此逻辑）：
   - **核心公式**：数据 ÷ 时间 ÷ 对象
   - **如果没有对象**：数据 ÷ 时间
   - **重要**：平均值计算的SQL中，SELECT子句只能包含聚合函数（SUM、COUNT等）和计算结果，**绝对不能包含时间字段**（如[充电结束时间]）或其他非聚合字段
   - **重要规则**：如果查询中包含"枪"或"终端"关键词，**需要根据时间过滤规则在特来电表和滴滴表中查询，不查询能科表**
   - **时间计算规则**：
     * 如果问题中包含"每个月"、"每月"等关键词 → 时间以月数计算（如2025年有12个月）
     * 如果问题中没有"每个月"等关键词 → 时间以天数计算（如2025年有365天，闰年366天）
     * **注意**：时间只是作为除数使用，不要在SELECT中包含时间字段
   - **对象计算规则（枪数）**：
     * **如果查询中包含"枪"或"终端"关键词**：
       - **需要根据时间过滤规则在特来电表和滴滴表中查询，不查询能科表**
       - **特来电表使用固定枪数，不再使用COUNT(DISTINCT)统计**：
         * 四方坪：
           - 2018年：30把
           - 2019年：79把
           - 2020-2024年：172把
           - 2025年及之后：142把
         * 高岭：一直为36把
       - **滴滴表使用COUNT(DISTINCT)统计枪数**：
         * 使用 COUNT(DISTINCT [充电枪ID]) 统计实际枪数
         * 需要根据时间过滤规则判断是否查询滴滴表
       - **时间过滤规则（重要）**：
         * 2025年11月之前：只查询特来电表
         * 2025年11月-2026年1月：查询特来电表 + 滴滴表
         * 2026年2月及之后：只查询滴滴表
         * 如果查询包含"四方坪"关键词，使用四方坪的固定枪数
         * 如果查询包含"高岭"关键词，使用高岭的固定枪数（36把）
         * 如果查询不包含地点关键词，需要根据年份判断：
           - 如果查询的是四方坪数据（通过电站名称筛选），使用四方坪的固定枪数
           - 如果查询的是高岭数据，使用高岭的固定枪数（36把）
     * **如果查询中不包含"枪"或"终端"关键词**：
       - 可以查询特来电表和能科表
       - 特来电表使用固定枪数
       - 能科表使用 COUNT(DISTINCT [充电桩名称]) 统计
       - 如果涉及两个表，需要分别计算后相加
   - **示例1**："2025年平均每把枪的充电服务费是多少？"
     * **重要**：查询中包含"枪"关键词，只查询特来电表，不查询能科表
     * 数据：2025年特来电表所有充电服务费的总和
     * 时间：2025年的天数（365或366）
     * 对象：枪的个数（特来电：根据年份使用固定枪数）
     * 公式：数据 ÷ 时间 ÷ 对象
     * **重要**：SELECT子句只包含计算结果，不包含时间字段
     * **重要**：使用日期范围筛选（性能优化），不要使用YEAR()函数
     * SQL示例（只查询特来电表，四方坪，2025年，优化版）：
       SELECT 
           ISNULL(SUM([充电服务费(元)]), 0) / 
           NULLIF(365, 0) / 
           NULLIF(142, 0) AS 平均值
       FROM [特来电]
       WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2026-01-01'
         AND [充电服务费(元)] IS NOT NULL AND [充电服务费(元)] > 0
         AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL
         AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' 
         AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
     * 说明：2025年四方坪固定枪数为142把，直接使用数字142，不再统计
     * **注意**：SELECT中只包含聚合函数（SUM），不包含时间字段，不查询能科表
     * **性能说明**：使用日期范围 '>= 2025-01-01 AND < 2026-01-01' 可以利用索引，比 YEAR()函数快得多
   - **示例2**："2025年平均每把枪每个月的充电服务费是多少？"
     * **注意**：查询中包含"枪"关键词，只查询特来电表，不查询能科表
     * 数据：2025年特来电表所有充电服务费的总和
     * 时间：2025年的月数（12个月）
     * 对象：枪的个数（特来电：2025年四方坪固定枪数142把）
     * **重要**：使用日期范围筛选（性能优化），不要使用YEAR()函数
     * SQL示例（只查询特来电表，四方坪，2025年，优化版）：
       SELECT 
           ISNULL(SUM([充电服务费(元)]), 0) / 
           NULLIF(12, 0) / 
           NULLIF(142, 0) AS 平均值
       FROM [特来电]
       WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2026-01-01'
         AND [充电服务费(元)] IS NOT NULL AND [充电服务费(元)] > 0
         AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL
         AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' 
         AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
     * **性能说明**：使用日期范围 '>= 2025-01-01 AND < 2026-01-01' 可以利用索引，比 YEAR()函数快得多
   - **示例3**："2025年12月四方坪平均每把枪的充电电量多少？"
     * **重要**：查询中包含"枪"关键词，需要根据时间过滤规则在特来电表和滴滴表中查询
     * **时间过滤规则应用**：2025年12月需要查询特来电表 + 滴滴表（因为2025年12月在滴滴表数据范围内）
     * 数据：2025年12月特来电表和滴滴表的充电电量总和
     * 时间：2025年12月的天数（31天）
     * 对象：枪的个数（四方坪2025年固定枪数142把，包含特来电和滴滴）
     * 公式：(特来电数据 + 滴滴数据) ÷ 时间 ÷ 对象
     * SQL示例（查询特来电 + 滴滴，四方坪，2025年12月）：
       SELECT
           ((ISNULL((SELECT SUM([充电电量(度)])
                     FROM [特来电]
                     WHERE [充电结束时间] >= '2025-12-01' AND [充电结束时间] < '2026-01-01'
                       AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
                       AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL
                       AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
                       AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
             ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT))
                     FROM [滴滴]
                     WHERE [充电完成时间] >= '2025-12-01' AND [充电完成时间] < '2026-01-01'
                       AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != ''
                       AND ISNUMERIC([充电量（度）]) = 1
                       AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
                       AND [场站名称] IS NOT NULL AND [充电枪ID] IS NOT NULL), 0)) /
            NULLIF(31, 0) /
            NULLIF(142, 0)) AS 平均值
     * 说明：
       - 2025年12月需要合并特来电和滴滴两个表的数据
       - 四方坪2025年固定枪数142把（包含特来电和滴滴的总枪数）
       - 滴滴表的[充电量（度）]字段是nvarchar类型，需要转换为FLOAT
       - 使用ISNULL确保NULL值不影响计算
       - 不查询能科表（因为能科表2024年5月以后没有数据）
   - **示例4**："高岭2023年平均每把枪的充电服务费是多少？"
     * **重要**：查询中包含"枪"关键词，只查询特来电表，不查询能科表
     * 高岭固定枪数：36把（所有年份都是36把）
     * **重要**：使用日期范围筛选（性能优化），不要使用YEAR()函数
     * SQL示例（优化版）：
       SELECT 
           ISNULL(SUM([充电服务费(元)]), 0) / 
           NULLIF(365, 0) / 
           NULLIF(36, 0) AS 平均值
       FROM [特来电]
       WHERE [充电结束时间] >= '2023-01-01' AND [充电结束时间] < '2024-01-01'
         AND [充电服务费(元)] IS NOT NULL AND [充电服务费(元)] > 0
         AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')
   - **示例5**："2025年1月至11月平均每把枪每天的充电电量是多少？"
     * **重要**：查询中包含"枪"关键词，只查询特来电表，不查询能科表
     * **重要**：查询中没有"四方坪"或"高岭"关键词，查询所有数据（不添加地点筛选条件）
     * **优化**：使用子查询直接计算，避免CROSS JOIN，提高查询效率
     * 数据：2025年1月至11月特来电表所有充电电量的总和
     * 时间：2025年1月至11月的天数（334天，1月31天+2月28天+3月31天+4月30天+5月31天+6月30天+7月31天+8月31天+9月30天+10月31天+11月30天）
     * 对象：枪的个数（四方坪142把 + 高岭36把 = 178把）
     * SQL示例（查询所有数据，2025年1月至11月，优化版）：
       SELECT 
           (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2025-12-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) + 
            ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2025-12-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')), 0)) / 
           NULLIF(334, 0) / 
           NULLIF(178, 0) AS 平均值
     * **关键规则**：
       - SELECT子句中只包含聚合函数（SUM）和计算结果，不包含时间字段
       - 时间字段只在WHERE子句中使用（如 [充电结束时间] >= '2025-01-01'）
       - 使用子查询直接计算，避免CROSS JOIN，提高查询效率
       - 固定枪数：四方坪142把 + 高岭36把 = 178把（2025年）
       - **语法注意**：ISNULL函数的第一个参数是子查询时，子查询必须用括号括起来，如 ISNULL((SELECT ...), 0)
       - **语法注意**：子查询的WHERE子句必须正确闭合，确保所有括号匹配
   - **枪数年份对照表（四方坪）**：
     * 使用CASE WHEN根据年份确定枪数：
       CASE 
           WHEN YEAR([充电结束时间]) = 2018 THEN 30
           WHEN YEAR([充电结束时间]) = 2019 THEN 79
           WHEN YEAR([充电结束时间]) >= 2020 AND YEAR([充电结束时间]) <= 2024 THEN 172
           WHEN YEAR([充电结束时间]) >= 2025 THEN 142
           ELSE 0
       END
   - **重要**：
     * 时间字段：特来电表使用[充电结束时间]，能科表使用[结束日期时间]
     * **关键规则**：时间字段只在WHERE子句中使用，**绝对不要在SELECT子句中包含时间字段**
     * **性能优化（非常重要）**：
       - **对于年份查询，必须使用日期范围筛选，不要使用YEAR()函数**
       - **原因**：YEAR()函数会导致无法使用索引，在大数据量时会导致查询超时
       - **正确写法（推荐）**：[时间字段] >= '2024-01-01' AND [时间字段] < '2025-01-01'
       - **错误写法（避免）**：YEAR([时间字段]) = 2024 （会导致性能问题）
       - **示例1**："去年四方坪平均每把枪的充电电量是多少"
         * 假设当前年份是2025年，去年是2024年
         * **优化SQL（推荐）**：
           SELECT 
               ISNULL(SUM([充电电量(度)]), 0) / 
               NULLIF(365, 0) / 
               NULLIF(172, 0) AS 平均值
           FROM [特来电]
           WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01'
             AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
             AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL
             AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' 
             AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
         * **说明**：使用日期范围 >= '2024-01-01' AND < '2025-01-01' 可以利用索引，查询速度快
         * **注意**：2024年四方坪固定枪数为172把（2020-2024年都是172把）
       - **示例2**："前年四方坪平均每把枪的充电电量是多少"
         * 假设当前年份是2025年，前年是2023年
         * **优化SQL（推荐）**：
           SELECT 
               ISNULL(SUM([充电电量(度)]), 0) / 
               NULLIF(365, 0) / 
               NULLIF(172, 0) AS 平均值
           FROM [特来电]
           WHERE [充电结束时间] >= '2023-01-01' AND [充电结束时间] < '2024-01-01'
             AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
             AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL
             AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' 
             AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
         * **说明**：使用日期范围 >= '2023-01-01' AND < '2024-01-01' 可以利用索引，查询速度快
         * **注意**：2023年四方坪固定枪数为172把（2020-2024年都是172把）
         * **关键**：前年 = YEAR(GETDATE()) - 2，必须使用日期范围，不要在SELECT中包含时间字段
     * 必须过滤空值、0值和空字符串
     * 计算天数：使用DATEDIFF(DAY, '2025-01-01', '2026-01-01')或直接使用365/366
     * 计算月数：使用DATEDIFF(MONTH, '2025-01-01', '2026-01-01')或直接使用12
     * **必须使用ISNULL处理NULL值**：当子查询没有数据时，SUM返回NULL，COUNT返回0。必须使用ISNULL(字段, 0)将所有NULL值转换为0，否则计算结果会为NULL
     * **字段名必须正确**：
       - 能科表中电量字段名是 [充电量]，不是"能科电量"或其他名称
       - 在SELECT子句中必须使用实际字段名，如 SUM([充电量])，可以起别名如 AS 能科电量总和
       - 特来电表中电量字段名是 [充电电量(度)]
       - 滴滴表中电量字段名是 [充电量（度）]（注意括号是中文括号）
       - 查询"充电电量"时，特来电表用 [充电电量(度)]，能科表用 [充电量]，滴滴表用 [充电量（度）]
     * **SQL Server 2008 R2语法要求**：
       - SELECT子句中如果包含非聚合字段，必须使用GROUP BY
       - 对于平均值计算，SELECT子句应该只包含聚合函数和计算结果，不要包含时间字段或其他非聚合字段
       - 如果必须使用GROUP BY，确保SELECT中的所有非聚合字段都在GROUP BY中
   - **示例5（重要）**："2024年四方坪平均每度电的服务费收入是多少？"
     * **公式**：平均每度电服务费收入 = 总服务费 ÷ 总电量
     * **重要**：根据时间过滤规则，2024年需要查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     * **重要**：使用日期范围筛选（性能优化），不要使用YEAR()函数
     * **特来电表**：服务费字段 = [充电服务费(元)]，电量字段 = [充电电量(度)]
     * **能科表**：服务费字段 = [服务费]，电量字段 = [充电量]
     * **性能优化（关键）**：在一个查询中同时计算服务费和电量，减少子查询数量，提高查询效率
     * SQL示例（四方坪，2024年，优化版）：
       SELECT
           (ISNULL(t1.特来电服务费, 0) + ISNULL(t2.能科服务费, 0)) /
           NULLIF((ISNULL(t1.特来电电量, 0) + ISNULL(t2.能科电量, 0)), 0) AS 平均每度电服务费收入
       FROM (
           SELECT
               SUM([充电服务费(元)]) AS 特来电服务费,
               SUM([充电电量(度)]) AS 特来电电量
           FROM [特来电]
           WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01'
             AND [充电服务费(元)] IS NOT NULL AND [充电服务费(元)] > 0
             AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
             AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
             AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
       ) AS t1
       CROSS JOIN (
           SELECT
               SUM([服务费]) AS 能科服务费,
               SUM([充电量]) AS 能科电量
           FROM [能科]
           WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01'
             AND [服务费] IS NOT NULL AND [服务费] > 0
             AND [充电量] IS NOT NULL AND [充电量] > 0
       ) AS t2
     * **关键规则**：
       - 必须使用日期范围 '>= 2024-01-01 AND < 2025-01-01'，不要使用YEAR()函数
       - **时间过滤规则**：2024年只查询特来电和能科表（不查询滴滴表）
       - 特来电表和能科表都需要同时筛选服务费和电量都不为空且大于0
       - 使用ISNULL包装所有子查询结果，避免NULL值导致计算错误
       - 使用NULLIF避免除零错误
   - **示例5-2（2025年12月）**："2025年12月四方坪平均每度电的服务费收入是多少？"
     * **公式**：平均每度电服务费收入 = 总服务费 ÷ 总电量
     * **重要**：根据时间过滤规则，2025年12月需要查询特来电和滴滴表（不查询能科表，因为能科表2024年5月后没有数据）
     * **重要**：使用日期范围筛选（性能优化），不要使用YEAR()函数
     * **特来电表**：服务费字段 = [充电服务费(元)]，电量字段 = [充电电量(度)]
     * **滴滴表**：服务费字段 = [充电服务费（元）]，电量字段 = [充电量（度）]
     * SQL示例（四方坪，2025年12月，只查询特来电和滴滴）：
       SELECT
           (ISNULL(t1.特来电服务费, 0) + ISNULL(t2.滴滴服务费, 0)) /
           NULLIF((ISNULL(t1.特来电电量, 0) + ISNULL(t2.滴滴电量, 0)), 0) AS 平均每度电服务费收入
       FROM (
           SELECT
               SUM([充电服务费(元)]) AS 特来电服务费,
               SUM([充电电量(度)]) AS 特来电电量
           FROM [特来电]
           WHERE [充电结束时间] >= '2025-12-01' AND [充电结束时间] < '2026-01-01'
             AND [充电服务费(元)] IS NOT NULL AND [充电服务费(元)] > 0
             AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
             AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
             AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
       ) AS t1
       CROSS JOIN (
           SELECT
               SUM([充电服务费（元）]) AS 滴滴服务费,
               SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) AS 滴滴电量
           FROM [滴滴]
           WHERE [充电完成时间] >= '2025-12-01' AND [充电完成时间] < '2026-01-01'
             AND [充电服务费（元）] IS NOT NULL AND [充电服务费（元）] > 0
             AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
       ) AS t2
     * **关键规则**：
       - 必须使用日期范围 '>= 2025-12-01 AND < 2026-01-01'，不要使用YEAR()函数
       - **时间过滤规则**：2025年12月只查询特来电和滴滴表（不查询能科表，因为能科表2024年5月后没有数据）
       - 特来电表和滴滴表都需要同时筛选服务费和电量都不为空且大于0
       - 使用ISNULL包装所有子查询结果，避免NULL值导致计算错误
       - 使用NULLIF避免除零错误
   - **示例5-1（高岭参考）**："2025年高岭平均每度电的服务费收入是多少？"
     * **公式**：平均每度电服务费收入 = 总服务费 ÷ 总电量
     * **重要**：高岭只查询特来电表，不查询能科表
     * **重要**：使用日期范围筛选（性能优化），不要使用YEAR()函数
     * **性能优化（关键）**：在一个查询中同时计算服务费和电量，这是高岭查询成功的关键
     * SQL示例（高岭，2025年，优化版）：
       SELECT 
           ISNULL(SUM([充电服务费(元)]), 0) / 
           NULLIF(ISNULL(SUM([充电电量(度)]), 0), 0) AS 平均每度电服务费收入
       FROM [特来电]
       WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2026-01-01'
         AND [充电服务费(元)] IS NOT NULL AND [充电服务费(元)] > 0
         AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
         AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')
     * **关键规则**：
       - 必须使用日期范围 '>= 2025-01-01 AND < 2026-01-01'，不要使用YEAR()函数
       - **关键优化**：在一个查询中同时计算服务费和电量，只扫描一次表，这是高岭查询成功的关键
       - 同时筛选服务费和电量都不为空且大于0
       - 使用ISNULL和NULLIF避免NULL值和除零错误
       - **性能说明**：使用日期范围可以利用索引，查询速度快；在一个查询中同时计算多个聚合值，比分别查询更高效

B. **年度对比/比较**（如"2025年对比2024年充电电量"或"2025年比较2024年充电电量"）：
   - **关键词识别**：支持"对比"和"比较"两个关键词
   - 需要先计算每年的数据（特来电+能科+滴滴，根据时间过滤规则），然后计算增减
   - 不要只返回每年的数值
   - 应该返回：增加或下降的数值（增减量）
   - **重要**：必须使用与简单查询相同的逻辑结构，确保能科表使用 [充电量] 字段，滴滴表使用 [充电量（度）] 字段
   - **重要**：为了避免超时，使用简化的查询结构，避免复杂的CROSS JOIN
   - **重要**：必须首先应用时间过滤规则，根据查询时间决定需要查询哪些表
   - **重要**：滴滴表的 [充电量（度）] 字段是nvarchar类型，必须使用 CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) 转换
   - **重要**：能科表的 [服务费] 和 [消费金额] 字段为float类型，直接使用即可
   - **年度对比示例**（特来电+能科+滴滴，充电电量）："2025年对比2024年四方坪充电电量"或"2025年比较2024年四方坪充电电量"
     * **时间过滤规则应用**：
       - 2025年：需要查询特来电、能科和滴滴三个表（因为2025年同时满足三个表的时间范围）
       - 2024年：只查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     SELECT
         (ISNULL((
             SELECT SUM([充电电量(度)]) FROM [特来电]
             WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2026-01-01'
             AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
             AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
             AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
         ), 0) + ISNULL((
             SELECT SUM([充电量]) FROM [能科]
             WHERE [结束日期时间] >= '2025-01-01' AND [结束日期时间] < '2026-01-01'
             AND [充电量] IS NOT NULL AND [充电量] > 0
         ), 0) + ISNULL((
             SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴]
             WHERE [充电完成时间] >= '2025-01-01' AND [充电完成时间] < '2026-01-01'
             AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
         ), 0)) -
         (ISNULL((
             SELECT SUM([充电电量(度)]) FROM [特来电]
             WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01'
             AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
             AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
             AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
         ), 0) + ISNULL((
             SELECT SUM([充电量]) FROM [能科]
             WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01'
             AND [充电量] IS NOT NULL AND [充电量] > 0
         ), 0)) AS 增减量
   - **性能优化关键**：
     * 必须使用日期范围（'>= ... AND < ...'），不要使用YEAR()函数
     * 避免使用CROSS JOIN，直接用减法计算
     * 不需要计算增长率百分比（会增加查询复杂度），只返回增减量
     * 四方坪：排除高岭电站（使用NOT LIKE条件）
     * 使用ISNULL包装所有子查询，避免NULL值导致计算错误

   - **月份对比/比较**（如"2025年11月对比2024年11月充电电量"或"2025年11月比较2024年11月充电电量"）：
     * 使用相同的逻辑结构，但时间条件改为月份
     * **优化**：使用日期范围筛选，比YEAR()和MONTH()函数更高效，避免函数计算
     * **时间过滤规则应用**：根据月份判断需要查询哪些表
     * 示例SQL（特来电+能科+滴滴，充电电量）："2025年11月对比2024年11月四方坪充电电量"
       SELECT
           (ISNULL((
               SELECT SUM([充电电量(度)]) FROM [特来电]
               WHERE [充电结束时间] >= '2025-11-01' AND [充电结束时间] < '2025-12-01'
               AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
               AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
               AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
           ), 0) + ISNULL((
               SELECT SUM([充电量]) FROM [能科]
               WHERE [结束日期时间] >= '2025-11-01' AND [结束日期时间] < '2025-12-01'
               AND [充电量] IS NOT NULL AND [充电量] > 0
           ), 0) + ISNULL((
               SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴]
               WHERE [充电完成时间] >= '2025-11-01' AND [充电完成时间] < '2025-12-01'
               AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
           ), 0)) -
           (ISNULL((
               SELECT SUM([充电电量(度)]) FROM [特来电]
               WHERE [充电结束时间] >= '2024-11-01' AND [充电结束时间] < '2024-12-01'
               AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
               AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
               AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
           ), 0) + ISNULL((
               SELECT SUM([充电量]) FROM [能科]
               WHERE [结束日期时间] >= '2024-11-01' AND [结束日期时间] < '2024-12-01'
               AND [充电量] IS NOT NULL AND [充电量] > 0
           ), 0)) AS 增减量

   - **平均值对比/比较**（如"2025年平均每个月的充电电量对比2024年平均每个月的充电电量"）：
     * 先计算每个时间段的总和，然后除以月数/年数，最后计算增减量
     * 示例SQL："2025年平均每个月的充电电量对比2024年平均每个月的充电电量"
       SELECT
           ((ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2025-01-01' AND [充电结束时间] < '2026-01-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0), 0) +
             ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2025-01-01' AND [结束日期时间] < '2026-01-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0) +
             ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴] WHERE [充电完成时间] >= '2025-01-01' AND [充电完成时间] < '2026-01-01' AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0), 0)) / 12) -
           ((ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0), 0) +
             ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0)) / 12) AS 增减量

C. **最大/最小年份查询**（如"哪一年收入最多，哪一年最少"）：
   - 需要先按年分组计算，然后找出最大和最小
   - 示例SQL：
     SELECT TOP 1 年份, 总收入 FROM (
         SELECT YEAR([时间字段]) AS 年份, SUM(收入字段) AS 总收入
         FROM [表名]
         WHERE 条件
         GROUP BY YEAR([时间字段])
     ) AS 年度汇总
     ORDER BY 总收入 DESC -- 最多用DESC，最少用ASC

D. **车牌/设备等维度的排名**（如"哪个车充电量最多"）：
   - 必须过滤掉空值、0值和空字符串
   - **重要**：车牌查询分三种情况，需要根据问题类型选择对应的表和字段：
     1. **查询车辆的充电电量**：在特来电表的[判定车牌号]字段、能科表的[车牌号]字段和滴滴表的[车牌号]字段中查询（精确匹配）
        - **重要**：三个表都有车牌号字段，但字段名不同：
          - 特来电表：使用 [判定车牌号] 字段
          - 能科表：使用 [车牌号] 字段
          - 滴滴表：使用 [车牌号] 字段
        - **关键点**：当查询包含具体车牌号时，必须在所有三个表的查询中都添加车牌号筛选条件。
        - 特来电表：WHERE [判定车牌号] = '具体车牌号' AND [判定车牌号] IS NOT NULL AND [判定车牌号] != '' AND [充电电量(度)] > 0
        - 能科表：WHERE [车牌号] = '具体车牌号' AND [车牌号] IS NOT NULL AND [车牌号] != '' AND [充电量] IS NOT NULL AND [充电量] > 0
        - 滴滴表：WHERE [车牌号] = '具体车牌号' AND [车牌号] IS NOT NULL AND [车牌号] != '' AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0
        - **正确示例**："湘AFX0922的充电电量"
          SQL: SELECT
              (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [判定车牌号] = '湘AFX0922' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0), 0) +
               ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [车牌号] = '湘AFX0922' AND [充电量] IS NOT NULL AND [充电量] > 0), 0) +
               ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴] WHERE [车牌号] = '湘AFX0922' AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0), 0)) AS 总充电电量
          **说明**：三个表的查询中都添加了车牌号筛选条件，这是正确的。如果某个表中没有该车牌号的数据，该表的查询会返回NULL，通过ISNULL转换为0。
     2. **查询车辆的充值、是否为月租车等问题**：在"月租车充值"表的[车牌号码]字段中查询匹配数据
        - 月租车充值表：WHERE [车牌号码] IS NOT NULL AND [车牌号码] != ''
        - **重要**：当问题包含具体车牌号(如"湘ADE5093")时,必须添加车牌号匹配条件: WHERE [车牌号码] = '湘ADE5093'
        - **示例**："2025年12月湘ADE5093充值多少？"
          SQL: SELECT SUM([交款金额]) FROM [月租车充值] WHERE [车牌号码] = '湘ADE5093' AND [交款时间] >= '2025-12-01' AND [交款时间] < '2026-01-01'
     3. **查询车辆缴费、收费等问题**：在"红门缴费"表的[收费车牌]字段中查询匹配数据
        - 红门缴费表：WHERE [收费车牌] IS NOT NULL AND [收费车牌] != ''
        - **重要**：当问题包含具体车牌号时,必须添加车牌号匹配条件: WHERE [收费车牌] = '具体车牌号'
   - 使用TOP N限制结果数量
   - **车牌号识别规则**：
     * 车牌号通常以省份简称开头(如"湘"、"粤"、"京"等),后接字母和数字组合
     * 当用户问题中包含具体车牌号时,必须在WHERE条件中添加精确匹配: WHERE [对应字段] = '车牌号'
     * 不要使用LIKE模糊匹配车牌号,应该使用精确的等号匹配

D2. **按日期维度查询**（如"哪一天充电电量最多"）：
   - **重要**：SQL Server 2008 R2不支持直接在SELECT中使用CAST(... AS DATE)作为列别名
   - **正确做法**：使用CONVERT函数转换日期，并在GROUP BY中重复表达式
   - **CONVERT函数语法**（必须严格按照此顺序）：
     CONVERT(目标数据类型, 源字段, 格式代码) AS 别名
     示例：CONVERT(VARCHAR(10), [充电结束时间], 120) AS 日期
     第1个参数：VARCHAR(10) - 目标数据类型（必须指定长度）
     第2个参数：[充电结束时间] - 源字段（要转换的时间字段）
     第3个参数：120 - 格式代码（表示YYYY-MM-DD格式）
     最后：AS 日期 - 必须指定列别名
   - **错误示例（AI容易犯的错误）**：
     ❌ CONVERT(VARCHAR(10), 120) AS 日期 -- 缺少源字段！
     ❌ CONVERT(VARCHAR(10), 120, [充电结束时间]) AS 日期 -- 参数顺序错误！
     ❌ CONVERT([充电结束时间], VARCHAR(10), 120) AS 日期 -- 参数顺序错误！
     ❌ CONVERT(VARCHAR, [充电结束时间], 120) AS 日期 -- VARCHAR缺少长度！
     ❌ CONVERT(VARCHAR(10), [充电结束时间]) AS 120 -- 缺少格式代码，列名错误！
   - **正确示例（必须完全按照此格式）**：
     SELECT TOP 1
         CONVERT(VARCHAR(10), [充电结束时间], 120) AS 日期,
         SUM([充电电量(度)]) AS 总电量
     FROM [特来电]
     WHERE [充电结束时间] >= '2024-11-01' AND [充电结束时间] < '2024-12-01'
         AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
         AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
         AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
     GROUP BY CONVERT(VARCHAR(10), [充电结束时间], 120)
     ORDER BY SUM([充电电量(度)]) DESC
   - **关键规则**：
     CONVERT函数有3个参数，顺序是：数据类型、源字段、格式代码
     源字段必须放在第2个参数位置
     120是格式代码，必须放在第3个参数位置
     必须使用AS指定列别名（如"AS 日期"）
     GROUP BY子句中必须重复完整的CONVERT表达式
     ORDER BY可以使用聚合函数或别名

D3. **按月份维度查询**（如"哪一月充电电量最多"）：
   - **方法1（推荐）**：使用CONVERT函数转换为YYYY-MM格式
     CONVERT(VARCHAR(7), [时间字段], 120) AS 月份
     VARCHAR(7)长度为7，返回格式为YYYY-MM
   - **方法2**：使用YEAR和MONTH函数组合（只在SELECT和GROUP BY中使用）
     注意：YEAR()和MONTH()只能在SELECT和GROUP BY中使用，不能在WHERE中用于筛选
   - **示例SQL**："2024年四方坪充电电量最多的是哪一月"
     SELECT TOP 1
         CONVERT(VARCHAR(7), [充电结束时间], 120) AS 月份,
         SUM([充电电量(度)]) AS 总电量
     FROM [特来电]
     WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01'
         AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
         AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
         AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
     GROUP BY CONVERT(VARCHAR(7), [充电结束时间], 120)
     ORDER BY SUM([充电电量(度)]) DESC
   - **或者使用YEAR+MONTH组合**：
     SELECT TOP 1
         YEAR([充电结束时间]) AS 年份,
         MONTH([充电结束时间]) AS 月份,
         SUM([充电电量(度)]) AS 总电量
     FROM [特来电]
     WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01'
         AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0
         AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%'
         AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'
     GROUP BY YEAR([充电结束时间]), MONTH([充电结束时间])
     ORDER BY SUM([充电电量(度)]) DESC
   - **关键规则**：
     按月份分组时，使用 CAST(YEAR([时间字段]) AS VARCHAR) + '-' + RIGHT('0' + CAST(MONTH([时间字段]) AS VARCHAR), 2)
     显示格式为 YYYY-MM（如2024-01、2024-02），不要显示 YYYY-MM-01
     YEAR()和MONTH()函数只能用在SELECT和GROUP BY中，不能用在WHERE筛选中
     WHERE筛选必须使用日期范围，不能用YEAR()函数

E. **电力局表查询**（重要：区分充电和电力局）：
   - **关键词区分**：
     * "充电电量"、"充电费用" -> 查询特来电/能科/滴滴表（根据时间过滤规则）
     * "用电量"、"电力局电量"、"电力局电费"、"电费"（配合"电力局"或"用电"关键词） -> 查询电力局表
     * "电量"（单独出现，无"充电"关键词） -> 需要根据上下文判断，如果问题中包含"电力局"或"用电"，则查询电力局表
   - **电力局表字段**：
     * 电量：使用 [电量] 字段
     * 电费：使用 ([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用])
     * 时间：使用 [年] 和 [月] 字段，不是日期字段
   - **变压器编号筛选**：
     * 四方坪：([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')
     * 高岭：[变压器编号] = '4350001671599'
     * 无地点关键词：不添加筛选条件，查询所有数据
   - **时间筛选示例**：
     * 查询2024年：WHERE [年] = 2024
     * 查询2024年12月：WHERE [年] = 2024 AND [月] = 12
     * 查询2024年1月至12月：WHERE [年] = 2024 AND [月] >= 1 AND [月] <= 12
   - **示例SQL**："2024年四方坪电力局用电量是多少"
     SELECT SUM([电量]) AS 总用电量
     FROM [电力局]
     WHERE [年] = 2024
       AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')
       AND [电量] IS NOT NULL AND [电量] > 0
   - **示例SQL**："2024年四方坪电力局电费是多少"
     SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用]) AS 总电费
     FROM [电力局]
     WHERE [年] = 2024
       AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077')
       AND [购电费] IS NOT NULL AND [输配电量电费] IS NOT NULL AND [力调电费] IS NOT NULL
       AND [基金及附加] IS NOT NULL AND [上网线损费用] IS NOT NULL AND [系统运行费用] IS NOT NULL AND [环境价值费用] IS NOT NULL

F. **电量损耗计算**（电力局电量 - 充电电量）：
   - **公式**：电量损耗 = 电力局用电量 - 充电电量（特来电 + 能科 + 滴滴，根据时间过滤规则）
   - **重要**：需要同时查询电力局表和充电表（特来电+能科+滴滴，根据时间过滤规则）
   - **地点匹配**：
     * 如果查询"四方坪电量损耗"：电力局查询四方坪变压器，充电查询四方坪电站
     * 如果查询"高岭电量损耗"：电力局查询高岭变压器，充电查询高岭电站
   - **年度查询示例**："2024年四方坪电量损耗是多少"
     * **时间过滤规则应用**：2024年只查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     SELECT
         ISNULL((SELECT SUM([电量]) FROM [电力局] WHERE [年] = 2024 AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077') AND [电量] IS NOT NULL AND [电量] > 0), 0) -
         (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
          ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0))
     AS 电量损耗
   - **月份查询示例**："2025年10月四方坪电量损耗是多少"
     * **时间过滤规则应用**：2025年10月只查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     SELECT
         ISNULL((SELECT SUM([电量]) FROM [电力局] WHERE [年] = 2025 AND [月] = 10 AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077') AND [电量] IS NOT NULL AND [电量] > 0), 0) -
         (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2025-10-01' AND [充电结束时间] < '2025-11-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
          ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2025-10-01' AND [结束日期时间] < '2025-11-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0))
     AS 电量损耗
   - **月份查询示例（包含滴滴表）**："2025年11月四方坪电量损耗是多少"
     * **时间过滤规则应用**：2025年11月需要查询特来电、能科和滴滴三个表（因为2025年11月同时满足三个表的时间范围）
     SELECT
         ISNULL((SELECT SUM([电量]) FROM [电力局] WHERE [年] = 2025 AND [月] = 11 AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077') AND [电量] IS NOT NULL AND [电量] > 0), 0) -
         (ISNULL((SELECT SUM([充电电量(度)]) FROM [特来电] WHERE [充电结束时间] >= '2025-11-01' AND [充电结束时间] < '2025-12-01' AND [充电电量(度)] IS NOT NULL AND [充电电量(度)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
          ISNULL((SELECT SUM([充电量]) FROM [能科] WHERE [结束日期时间] >= '2025-11-01' AND [结束日期时间] < '2025-12-01' AND [充电量] IS NOT NULL AND [充电量] > 0), 0) +
          ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT)) FROM [滴滴] WHERE [充电完成时间] >= '2025-11-01' AND [充电完成时间] < '2025-12-01' AND [充电量（度）] IS NOT NULL AND LTRIM(RTRIM([充电量（度）])) != '' AND ISNUMERIC([充电量（度）]) = 1 AND CAST(LTRIM(RTRIM([充电量（度）])) AS FLOAT) > 0), 0))
     AS 电量损耗
   - **关键规则**：
     * 电力局表：使用 [年] 和 [月] 字段筛选
     * 特来电表：使用日期范围筛选 [充电结束时间]
     * 能科表：使用日期范围筛选 [结束日期时间]
     * 滴滴表：使用日期范围筛选 [充电完成时间]
     * 四方坪：电力局使用变压器编号 '3118481453' 或 '3111439077'，特来电排除高岭电站
     * 高岭：电力局使用变压器编号 '4350001671599'，特来电只查询高岭电站

G. **毛利润计算**（充电收入 - 电力局电费）：
   - **公式**：毛利润 = 充电收入（特来电充电费用 + 能科消费金额 + 滴滴订单总额，根据时间过滤规则） - 电力局电费
   - **重要**：需要同时查询充电表和电力局表
   - **地点匹配**：与电量损耗相同，需要匹配地点
   - **年度查询示例（2024年）**："2024年四方坪毛利润是多少"
     * **时间过滤规则应用**：2024年只查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     SELECT
         (ISNULL((SELECT SUM([充电费用(元)]) FROM [特来电] WHERE [充电结束时间] >= '2024-01-01' AND [充电结束时间] < '2025-01-01' AND [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
          ISNULL((SELECT SUM([消费金额]) FROM [能科] WHERE [结束日期时间] >= '2024-01-01' AND [结束日期时间] < '2025-01-01' AND [消费金额] IS NOT NULL AND [消费金额] > 0), 0)) -
         ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局] WHERE [年] = 2024 AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077') AND [购电费] IS NOT NULL AND [输配电量电费] IS NOT NULL AND [力调电费] IS NOT NULL AND [基金及附加] IS NOT NULL AND [上网线损费用] IS NOT NULL AND [系统运行费用] IS NOT NULL AND [环境价值费用] IS NOT NULL), 0)
     AS 毛利润
   - **月份查询示例（2025年10月）**："2025年10月四方坪毛利润是多少"
     * **时间过滤规则应用**：2025年10月只查询特来电和能科表（不查询滴滴表，因为滴滴表2025年11月之前没有数据）
     SELECT
         (ISNULL((SELECT SUM([充电费用(元)]) FROM [特来电] WHERE [充电结束时间] >= '2025-10-01' AND [充电结束时间] < '2025-11-01' AND [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
          ISNULL((SELECT SUM([消费金额]) FROM [能科] WHERE [结束日期时间] >= '2025-10-01' AND [结束日期时间] < '2025-11-01' AND [消费金额] IS NOT NULL AND [消费金额] > 0), 0)) -
         ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局] WHERE [年] = 2025 AND [月] = 10 AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077') AND [购电费] IS NOT NULL AND [输配电量电费] IS NOT NULL AND [力调电费] IS NOT NULL AND [基金及附加] IS NOT NULL AND [上网线损费用] IS NOT NULL AND [系统运行费用] IS NOT NULL AND [环境价值费用] IS NOT NULL), 0)
     AS 毛利润
   - **月份查询示例（2025年11月）**："2025年11月四方坪毛利润是多少"
     * **时间过滤规则应用**：2025年11月需要查询特来电、能科和滴滴三个表（因为滴滴表从2025年11月开始有数据）
     SELECT
         (ISNULL((SELECT SUM([充电费用(元)]) FROM [特来电] WHERE [充电结束时间] >= '2025-11-01' AND [充电结束时间] < '2025-12-01' AND [充电费用(元)] IS NOT NULL AND [充电费用(元)] > 0 AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'), 0) +
          ISNULL((SELECT SUM([消费金额]) FROM [能科] WHERE [结束日期时间] >= '2025-11-01' AND [结束日期时间] < '2025-12-01' AND [消费金额] IS NOT NULL AND [消费金额] > 0), 0) +
          ISNULL((SELECT SUM(CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT)) FROM [滴滴] WHERE [充电完成时间] >= '2025-11-01' AND [充电完成时间] < '2025-12-01' AND [订单总额（元）] IS NOT NULL AND LTRIM(RTRIM([订单总额（元）])) != '' AND ISNUMERIC([订单总额（元）]) = 1 AND CAST(LTRIM(RTRIM([订单总额（元）])) AS FLOAT) > 0), 0)) -
         ISNULL((SELECT SUM([购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用]) FROM [电力局] WHERE [年] = 2025 AND [月] = 11 AND ([变压器编号] = '3118481453' OR [变压器编号] = '3111439077') AND [购电费] IS NOT NULL AND [输配电量电费] IS NOT NULL AND [力调电费] IS NOT NULL AND [基金及附加] IS NOT NULL AND [上网线损费用] IS NOT NULL AND [系统运行费用] IS NOT NULL AND [环境价值费用] IS NOT NULL), 0)
     AS 毛利润
   - **关键规则**：
     * 充电收入 = 特来电[充电费用(元)] + 能科[消费金额] + 滴滴[订单总额（元）]（根据时间过滤规则）
     * 电力局电费 = [购电费] + [输配电量电费] + [力调电费] + [基金及附加] + [上网线损费用] + [系统运行费用] + [环境价值费用]
     * 电力局表：使用 [年] 和 [月] 字段筛选
     * 特来电表：使用日期范围筛选 [充电结束时间]
     * 能科表：使用日期范围筛选 [结束日期时间]
     * 滴滴表：使用日期范围筛选 [充电完成时间]（2025年11月及之后）
     * 时间过滤规则：2024年及之前只查询特来电和能科，2025年1-10月只查询特来电和能科，2025年11月及之后查询特来电、能科和滴滴

H. **时间字段查询**（最小时间、最大时间、最早时间、最晚时间）：
   - **说明**：当用户询问某个表的"最小时间"、"最大时间"、"最早时间"、"最晚时间"时，应该直接查询该表的时间字段
   - **所有表的时间字段列表**：
     * 特来电：时间字段 = [充电结束时间]
     * 能科：时间字段 = [结束日期时间]
     * 滴滴：时间字段 = [充电完成时间]
     * 车海洋洗车充值：时间字段 = [时间]
     * 车海洋洗车消费：时间字段 = [时间]
     * 红门缴费：时间字段 = [缴费时间]
     * 快易洁洗车：时间字段 = [日期]
     * 赛菲姆道闸：时间字段 = [支付时间]
     * 收钱吧：时间字段 = [交易日期]
     * 兴元售货机：时间字段 = [支付时间]
     * 微信商户下单：时间字段 = [交易时间]
     * 微信收款商业版：时间字段 = [交易时间]
     * 月租车充值：时间字段 = [交款时间]
     * 智小盟：时间字段 = [支付时间]
     * 超时占位费：时间字段 = [支付时间]
     * 车颜知己洗车：时间字段 = [启动时间]
     * 活动优惠券：时间字段 = [收款时间]
     * 电力局：时间字段 = [年] 和 [月]（特殊处理，需要组合）
   - **示例SQL**："兴元售货机的最小时间是多少"
     SELECT MIN([支付时间]) AS 最小时间
     FROM [兴元售货机]
     WHERE [支付时间] IS NOT NULL
   - **示例SQL**："特来电的最大时间是多少"
     SELECT MAX([充电结束时间]) AS 最大时间
     FROM [特来电]
     WHERE [充电结束时间] IS NOT NULL
   - **示例SQL**："所有表的最小时间和最大时间是多少"
     SELECT '特来电' AS 表名, MIN([充电结束时间]) AS 最小时间, MAX([充电结束时间]) AS 最大时间 FROM [特来电] WHERE [充电结束时间] IS NOT NULL
     UNION ALL
     SELECT '能科' AS 表名, MIN([结束日期时间]) AS 最小时间, MAX([结束日期时间]) AS 最大时间 FROM [能科] WHERE [结束日期时间] IS NOT NULL
     UNION ALL
     SELECT '车海洋洗车充值' AS 表名, MIN([时间]) AS 最小时间, MAX([时间]) AS 最大时间 FROM [车海洋洗车充值] WHERE [时间] IS NOT NULL
     UNION ALL
     SELECT '车海洋洗车消费' AS 表名, MIN([时间]) AS 最小时间, MAX([时间]) AS 最大时间 FROM [车海洋洗车消费] WHERE [时间] IS NOT NULL
     UNION ALL
     SELECT '红门缴费' AS 表名, MIN([缴费时间]) AS 最小时间, MAX([缴费时间]) AS 最大时间 FROM [红门缴费] WHERE [缴费时间] IS NOT NULL
     UNION ALL
     SELECT '快易洁洗车' AS 表名, MIN([日期]) AS 最小时间, MAX([日期]) AS 最大时间 FROM [快易洁洗车] WHERE [日期] IS NOT NULL
     UNION ALL
     SELECT '赛菲姆道闸' AS 表名, MIN([支付时间]) AS 最小时间, MAX([支付时间]) AS 最大时间 FROM [赛菲姆道闸] WHERE [支付时间] IS NOT NULL
     UNION ALL
     SELECT '收钱吧' AS 表名, MIN([交易日期]) AS 最小时间, MAX([交易日期]) AS 最大时间 FROM [收钱吧] WHERE [交易日期] IS NOT NULL
     UNION ALL
     SELECT '兴元售货机' AS 表名, MIN([支付时间]) AS 最小时间, MAX([支付时间]) AS 最大时间 FROM [兴元售货机] WHERE [支付时间] IS NOT NULL
     UNION ALL
     SELECT '微信商户下单' AS 表名, MIN([交易时间]) AS 最小时间, MAX([交易时间]) AS 最大时间 FROM [微信商户下单] WHERE [交易时间] IS NOT NULL
     UNION ALL
     SELECT '微信收款商业版' AS 表名, MIN([交易时间]) AS 最小时间, MAX([交易时间]) AS 最大时间 FROM [微信收款商业版] WHERE [交易时间] IS NOT NULL
     UNION ALL
     SELECT '月租车充值' AS 表名, MIN([交款时间]) AS 最小时间, MAX([交款时间]) AS 最大时间 FROM [月租车充值] WHERE [交款时间] IS NOT NULL
     UNION ALL
     SELECT '智小盟' AS 表名, MIN([支付时间]) AS 最小时间, MAX([支付时间]) AS 最大时间 FROM [智小盟] WHERE [支付时间] IS NOT NULL
     UNION ALL
     SELECT '超时占位费' AS 表名, MIN([支付时间]) AS 最小时间, MAX([支付时间]) AS 最大时间 FROM [超时占位费] WHERE [支付时间] IS NOT NULL
     UNION ALL
     SELECT '车颜知己洗车' AS 表名, MIN([启动时间]) AS 最小时间, MAX([启动时间]) AS 最大时间 FROM [车颜知己洗车] WHERE [启动时间] IS NOT NULL
     UNION ALL
     SELECT '电力局' AS 表名, MIN(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') AS 最小时间, MAX(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') AS 最大时间 FROM [电力局] WHERE [年] IS NOT NULL AND [月] IS NOT NULL
   - **电力局特殊处理**："电力局的最小时间是多少"
     SELECT MIN(CAST([年] AS VARCHAR) + '-' + RIGHT('0' + CAST([月] AS VARCHAR), 2) + '-01') AS 最小时间
     FROM [电力局]
     WHERE [年] IS NOT NULL AND [月] IS NOT NULL
   - **重要规则**：
     * 所有表的时间字段查询都必须使用MIN()或MAX()函数
     * 必须过滤NULL值：WHERE [时间字段] IS NOT NULL
     * 电力局表需要特殊处理，使用[年]和[月]字段组合
     * 查询所有表时，使用UNION ALL合并结果，并添加表名列以便区分

请根据用户问题生成准确的SQL查询语句。只返回SQL语句本身，不要有任何解释文字。`;

        const requestData = {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `根据以下问题生成SQL查询语句：${message}\n\n涉及的表：${tables.join(', ')}` }
            ],
            temperature: 0.1,
            max_tokens: 1000
        };

        debugLog('DeepSeek API 请求数据', requestData);

        const response = await axios.post(
            DEEPSEEK_API_URL,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000,
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                }
            }
        );

        debugLog('DeepSeek API 响应状态', response.status);

        if (response.status !== 200) {
            console.error('DeepSeek API 返回非200状态码，降级使用规则匹配');
            return generateSQLByRules(message, tables);
        }

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('DeepSeek API 返回的数据格式不正确');
        }

        let sqlQuery = response.data.choices[0].message.content.trim();
        sqlQuery = sqlQuery.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim();

        // 清理SQL：移除表名后面多余的"表"字
        // 例如：[特来电表] -> [特来电]
        const tableNamesList = ['特来电', '能科', '车海洋洗车充值', '车海洋洗车消费', '车颜知己洗车',
                               '电力局', '红门缴费', '快易洁洗车', '赛菲姆道闸', '收钱吧',
                               '兴元售货机', '微信商户下单', '微信收款商业版', '月租车充值',
                               '智小盟', '超时占位费'];

        for (const tableName of tableNamesList) {
            // 替换 [表名表] -> [表名]
            const wrongPattern = new RegExp(`\\[${tableName}表\\]`, 'g');
            sqlQuery = sqlQuery.replace(wrongPattern, `[${tableName}]`);

            // 替换 FROM 表名表 -> FROM [表名] (处理没有方括号的情况)
            const wrongPattern2 = new RegExp(`FROM\\s+${tableName}表\\b`, 'gi');
            sqlQuery = sqlQuery.replace(wrongPattern2, `FROM [${tableName}]`);
        }

        debugLog('生成的SQL查询', sqlQuery);
        return sqlQuery;

    } catch (error) {
        console.error('DeepSeek API调用失败，降级使用规则匹配:', error.message);
        return generateSQLByRules(message, tables);
    }
}

// 移除AI生成SQL中不应出现在SELECT里的时间字段，避免GROUP BY错误
function sanitizeSQLQuery(sqlQuery, message = '') {
    if (!sqlQuery || typeof sqlQuery !== 'string') return sqlQuery;

    let sanitizedQuery = sqlQuery.trim();

    // 检测并修复活动优惠券表的错误SQL（如果AI错误地使用了[活动优惠券收入计算]作为列名）
    if (sanitizedQuery.includes('[活动优惠券收入计算]') && sanitizedQuery.includes('[活动优惠券]')) {
        debugLog('检测到活动优惠券表的错误SQL，尝试修复');
        // 如果SQL中使用了[活动优惠券收入计算]作为列名，说明AI生成了错误的SQL
        // 这种情况下，应该使用规则匹配重新生成SQL
        // 但由于sanitizeSQLQuery是后处理函数，我们只能抛出错误提示
        throw new Error('活动优惠券表的查询需要使用规则匹配，请检查analyzeQuestionWithAI函数是否正确处理了活动优惠券表');
    }

    // 如果是查询时间字段本身（最小时间、最大时间等），仍然需要修复CONVERT错误
    const isTimeFieldQuery = message && (
        message.includes('最小时间') || message.includes('最早时间') || message.includes('最早的时间') ||
        message.includes('最大时间') || message.includes('最晚时间') || message.includes('最晚的时间')
    );

    // 按日期/月份/年份维度的问题（如“哪一天/哪一月/哪一年/前N天充电电量最多”），需要在结果中保留时间字段
    const isDateDimensionQuery = message && (
        message.includes('哪一天') || message.includes('哪一日') ||
        message.includes('哪一月') || message.includes('哪一年') ||
        message.includes('按天') || message.includes('按日期') ||
        message.includes('按月') || message.includes('每天') ||
        message.includes('每日') || message.includes('每月') ||
        /前\d+天/.test(message) || message.includes('前几天')
    );

    // 特殊标记：按月份维度的统计（如“每个月”、“哪一月”），用于修复月份分组的CONVERT错误
    const isMonthDimensionQuery = message && (
        message.includes('哪一月') || message.includes('每个月') || message.includes('每月') || message.includes('按月')
    );

    // 注意：即使检测到是时间字段查询，也需要修复CONVERT错误，不能直接返回

    // 针对“月份维度”查询，删除所有与月份相关的CONVERT，统一改为使用 YEAR() + MONTH() 拼接
    // 例如：CONVERT(VARCHAR(7), [充电结束时间], 120) -> CAST(YEAR([充电结束时间]) AS VARCHAR(4)) + '-' + RIGHT('0' + CAST(MONTH([充电结束时间]) AS VARCHAR(2)), 2)
    if (isMonthDimensionQuery) {
        // 对每个 SELECT ... FROM ... GROUP BY CONVERT(VARCHAR(7), 时间字段, 120) 块单独处理
        const monthBlockRegex = /SELECT\s+([\s\S]*?)\bFROM\b([\s\S]*?)GROUP\s+BY\s+CONVERT\s*\(\s*VARCHAR\s*\(\s*7\s*\)\s*,\s*([^\),]+)\s*,\s*120\s*\)/gi;
        let mbMatch;
        let rebuiltSql = '';
        let lastIdx = 0;

        while ((mbMatch = monthBlockRegex.exec(sanitizedQuery)) !== null) {
            const blockStart = mbMatch.index;
            const blockEnd = monthBlockRegex.lastIndex;
            const fullBlock = mbMatch[0];
            const selectPart = mbMatch[1];
            const betweenFromAndGroup = mbMatch[2]; // 保留原样
            const fieldExpr = mbMatch[3].trim();

            // 在块前追加未更改部分
            rebuiltSql += sanitizedQuery.slice(lastIdx, blockStart);

            // 构造本块专用的月份表达式
            const monthExpr = `CAST(YEAR(${fieldExpr}) AS VARCHAR(4)) + '-' + RIGHT('0' + CAST(MONTH(${fieldExpr}) AS VARCHAR(2)), 2)`;
            debugLog('月份维度：按块构造月份表达式', { fieldExpr, monthExpr });

            // 1）修复本块 SELECT 部分中的月份列（无论CONVERT里第二个参数是120还是时间字段）
            const fixedSelectPart = selectPart.replace(
                /CONVERT\s*\(\s*VARCHAR\s*\(\s*7\s*\)\s*,\s*(?:120|[^\),]+)\s*,\s*120\s*\)\s+AS\s+月份/gi,
                `${monthExpr} AS 月份`
            );

            // 2）修复本块 GROUP BY 中的月份分组
            const fixedBlock = fullBlock
                .replace(selectPart, fixedSelectPart)
                .replace(
                    /GROUP\s+BY\s+CONVERT\s*\(\s*VARCHAR\s*\(\s*7\s*\)\s*,\s*[^\),]+\s*,\s*120\s*\)/gi,
                    `GROUP BY ${monthExpr}`
                );

            rebuiltSql += fixedBlock;
            lastIdx = blockEnd;

            debugLog('月份维度：修复后的单个SELECT块', { original: fullBlock, fixed: fixedBlock });
        }

        if (lastIdx > 0) {
            // 追加剩余部分
            rebuiltSql += sanitizedQuery.slice(lastIdx);
            sanitizedQuery = rebuiltSql;
            debugLog('月份维度：按块级粒度修复所有月份相关表达式后的SQL', sanitizedQuery);
        } else {
            debugLog('月份维度：未匹配到任何 GROUP BY CONVERT(VARCHAR(7), ...) 块，跳过专用修复');
        }

        // 额外：将按月份排序统一改为按别名"月份"排序，避免使用时间字段或表达式导致与GROUP BY不一致
        sanitizedQuery = sanitizedQuery.replace(
            /ORDER\s+BY\s+CONVERT\s*\(\s*VARCHAR\s*\(\s*7\s*\)\s*,\s*[^\),]+\s*,\s*120\s*\)\s*(ASC|DESC)?/gi,
            (match, direction) => {
                const dir = direction ? direction.toUpperCase() : '';
                const orderClause = dir ? `ORDER BY 月份 ${dir}` : 'ORDER BY 月份';
                debugLog('月份维度：将ORDER BY CONVERT(...)替换为ORDER BY 月份', { original: match, replaced: orderClause });
                return orderClause;
            }
        );

        // 额外修复：对于能科块，如果仍然错误使用了 [充电结束时间]，替换为 [结束日期时间]
        if (sanitizedQuery.includes('FROM [能科]')) {
            const nkBlockRegex = /FROM\s+\[能科\]([\s\S]*?)(?=UNION\s+ALL|ORDER\s+BY|$)/i;
            const nkMatch = sanitizedQuery.match(nkBlockRegex);
            if (nkMatch) {
                const nkBlock = nkMatch[0];
                const fixedNkBlock = nkBlock.replace(/\[充电结束时间\]/gi, '[结束日期时间]');
                if (fixedNkBlock !== nkBlock) {
                    sanitizedQuery = sanitizedQuery.replace(nkBlock, fixedNkBlock);
                    debugLog('月份维度：已在能科块中将[充电结束时间]替换为[结束日期时间]', { before: nkBlock, after: fixedNkBlock });
                }
            }
        }
    }

    // 第一步：将正确的 CONVERT(VARCHAR(10), 时间字段, 120) 全部改为 CAST(时间字段 AS DATE)，彻底移除CONVERT（针对“哪一天/哪一年”等日期问题）
    sanitizedQuery = sanitizedQuery.replace(
        /CONVERT\s*\(\s*VARCHAR\s*\(\s*10\s*\)\s*,\s*([^\),]+)\s*,\s*120\s*\)/gi,
        (match, fieldExpr) => {
            const expr = fieldExpr.trim();
            // 跳过明显错误的形式（如 CONVERT(VARCHAR(10), 120)），留给后面的错误修复逻辑处理
            if (/^120$/i.test(expr)) {
                return match;
            }
            debugLog('将CONVERT(VARCHAR(10), ...)替换为CAST(... AS DATE)', { original: match, fieldExpr: expr });
            return `CAST(${expr} AS DATE)`;
        }
    );

    // 第二步：修复仍然存在的错误 CONVERT(VARCHAR(n), 120)（少了时间字段）
    const wrongConvertPattern = /CONVERT\s*\(\s*VARCHAR\s*\(\s*\d+\s*\)\s*,\s*120\s*\)/gi;
    if (wrongConvertPattern.test(sanitizedQuery)) {
        debugLog('检测到错误的CONVERT(VARCHAR(n), 120)用法，开始修复');

        let foundTimeExpr = null;

        // 优先：如果GROUP BY里已经有按日期分组（CAST(... AS DATE)），直接用该表达式
        const groupByCastMatch = sanitizedQuery.match(/GROUP\s+BY\s+CAST\s*\(\s*([^\)]+)\s+AS\s+DATE\s*\)/i);
        if (groupByCastMatch && groupByCastMatch[1]) {
            foundTimeExpr = groupByCastMatch[1].trim();
            debugLog('从GROUP BY中的CAST(... AS DATE)推断时间表达式', foundTimeExpr);
        }

        // 其次：从WHERE子句中推断时间字段
        if (!foundTimeExpr) {
            const timeFieldList = ['充电结束时间', '充电开始时间', '结束日期时间', '交易时间', '支付时间', '时间', '缴费时间', '日期', '交款时间', '启动时间', '交易日期'];
            for (const field of timeFieldList) {
                const wherePattern = new RegExp(`WHERE[^;]*?(?:\\[?\\w+\\]?\\.)?\\[${field}\\]`, 'i');
                if (wherePattern.test(sanitizedQuery)) {
                    foundTimeExpr = `[${field}]`;
                    debugLog('从WHERE子句中推断时间字段', foundTimeExpr);
                    break;
                }
            }
        }

        // 再次：从FROM子句推断时间字段
        if (!foundTimeExpr) {
            try {
                const fromMatch = sanitizedQuery.match(/FROM\s+\[?([^\]\s]+)\]?(?:\s+\w+)?/i);
                if (fromMatch && fromMatch[1]) {
                    const tableNameRaw = fromMatch[1];
                    if (TABLE_FIELDS[tableNameRaw] && TABLE_FIELDS[tableNameRaw].timeField) {
                        foundTimeExpr = `[${TABLE_FIELDS[tableNameRaw].timeField}]`;
                        debugLog('从FROM子句和TABLE_FIELDS配置中推断时间字段', {
                            table: tableNameRaw,
                            timeField: foundTimeExpr
                        });
                    }
                }
            } catch (e) {
                debugLog('从FROM子句推断时间字段时出错', e.message || e);
            }
        }

        if (foundTimeExpr) {
            if (isTimeFieldQuery) {
                // 时间字段本身的最小/最大时间查询：完全移除CONVERT，直接使用MIN/MAX(时间字段)
                sanitizedQuery = sanitizedQuery.replace(
                    /(MIN|MAX)\s*\(\s*CONVERT\s*\(\s*VARCHAR\s*\(\s*\d+\s*\)\s*,\s*120\s*\)\s*\)/gi,
                    (match, func) => {
                        debugLog('移除时间字段查询中的错误CONVERT', { match, func, timeField: foundTimeExpr });
                        return `${func}(${foundTimeExpr})`;
                    }
                );
                sanitizedQuery = sanitizedQuery.replace(
                    /CONVERT\s*\(\s*VARCHAR\s*\(\s*\d+\s*\)\s*,\s*120\s*\)/gi,
                    foundTimeExpr
                );
                debugLog('已移除时间字段查询中的错误CONVERT，直接使用原始时间字段', sanitizedQuery);
            } else {
                // 其它场景（如“哪一天最多”）：用 CAST(时间字段 AS DATE) 替换错误的CONVERT
                sanitizedQuery = sanitizedQuery.replace(
                    /CONVERT\s*\(\s*VARCHAR\s*\(\s*\d+\s*\)\s*,\s*120\s*\)/gi,
                    `CAST(${foundTimeExpr} AS DATE)`
                );
                debugLog('已用CAST(... AS DATE)替换错误的CONVERT(VARCHAR(n), 120)', sanitizedQuery);
            }
        } else {
            debugLog('警告：无法找到时间字段表达式，仍然存在错误的CONVERT(VARCHAR(n), 120)');
        }
    }

    // 第三步：修复 GROUP BY 中错误的别名用法，例如：
    // GROUP BY CAST([充电结束时间] AS DATE) AS 日期  ->  GROUP BY CAST([充电结束时间] AS DATE)
    sanitizedQuery = sanitizedQuery.replace(
        /GROUP\s+BY\s+CAST\s*\(\s*([^\)]+?)\s+AS\s+DATE\s*\)\s+AS\s+\w+/gi,
        (match, innerExpr) => {
            const expr = innerExpr.trim();
            debugLog('修复GROUP BY中CAST(... AS DATE)带别名的问题', { original: match, expr });
            return `GROUP BY CAST(${expr} AS DATE)`;
        }
    );

    // 修复YEAR()函数在WHERE子句中的使用（性能优化，避免超时）
    // 检测模式：WHERE YEAR([时间字段]) = 年份 或 WHERE YEAR([时间字段]) = 年份 AND ...
    // 需要处理所有WHERE子句，包括子查询中的
    // 使用全局替换，更简单可靠
    const yearPattern = /WHERE\s+YEAR\s*\(\s*\[([^\]]+)\]\s*\)\s*=\s*(\d{4})/gi;
    if (yearPattern.test(sanitizedQuery)) {
        debugLog('检测到YEAR()函数在WHERE子句中使用，需要修复为日期范围');
        
        // 使用全局替换，处理所有YEAR()函数
        sanitizedQuery = sanitizedQuery.replace(
            /WHERE\s+YEAR\s*\(\s*\[([^\]]+)\]\s*\)\s*=\s*(\d{4})/gi,
            (match, timeField, year) => {
                const field = `[${timeField}]`;
                const yearNum = parseInt(year);
                const nextYear = yearNum + 1;
                const dateRange = `WHERE ${field} >= '${yearNum}-01-01' AND ${field} < '${nextYear}-01-01'`;
                debugLog('修复YEAR()函数', { original: match, replaced: dateRange, timeField: field, year: yearNum });
                return dateRange;
            }
        );
        
        debugLog('已修复所有YEAR()函数在WHERE子句中的使用');
    }

    // 时间字段列表
    const timeFields = [
        '充电结束时间',
        '充电开始时间',
        '结束日期时间',
        '交易时间',
        '支付时间',
        '时间',
        '缴费时间',
        '日期',
        '交款时间',
        '启动时间',
        '交易日期'
    ];

    // 查找所有SELECT子句（包括子查询中的）
    // 使用非贪婪匹配，但要注意嵌套括号
    const selectRegex = /SELECT\s+([\s\S]*?)\s+FROM/gi;
    let match;
    const matches = [];

    // 收集所有匹配
    while ((match = selectRegex.exec(sanitizedQuery)) !== null) {
        matches.push({
            fullMatch: match[0],
            selectPart: match[1],
            index: match.index
        });
    }

    // 从后往前处理，避免位置偏移
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const selectPart = match.selectPart;

        // 检查是否有聚合函数
        const hasAggregate = /(SUM|COUNT|AVG|MAX|MIN)\s*\(/i.test(selectPart);

        // 检查是否有GROUP BY（在当前SELECT之后）
        const afterSelect = sanitizedQuery.substring(match.index + match.fullMatch.length);
        const hasGroupBy = /GROUP\s+BY/i.test(afterSelect);

        // 检测SELECT中是否已经在使用YEAR()/MONTH()/CAST(... AS DATE)等时间函数
        // 这类场景通常是按年/按月等时间维度聚合，不能简单删掉时间字段参数，否则会导致如 YEAR() 这样的语法错误
        const hasYearOrMonthFuncInSelect = /YEAR\s*\(/i.test(selectPart) || /MONTH\s*\(/i.test(selectPart) || /CAST\s*\(\s*[^\)]+AS\s+DATE\s*\)/i.test(selectPart);

        // 如果存在聚合函数或GROUP BY，且不是时间字段查询/日期维度查询/月份维度查询，且SELECT中也没有使用YEAR/MONTH/CAST(... AS DATE)等时间函数时，才需要清理时间字段
        // 注意：
        //  - 时间字段查询（如"最小时间"）不应该清理时间字段
        //  - 日期/月份/年份维度查询（如"哪一天/哪一月/哪一年"）需要在结果中保留时间字段
        //  - 对于已经使用YEAR()/MONTH()/CAST(... AS DATE)的SELECT，不能删除时间字段参数，否则会产生 YEAR() 等错误表达式
        if ((hasAggregate || hasGroupBy) && !isTimeFieldQuery && !isDateDimensionQuery && !isMonthDimensionQuery && !hasYearOrMonthFuncInSelect) {
            let cleanedSelect = selectPart;
            let hasTimeField = false;
            
            // 清理时间字段（包括带表名前缀的，如"特来电.[充电结束时间]"或"特来电.充电结束时间"）
            for (const field of timeFields) {
                // 先清理带表名前缀的（更具体，优先处理）
                // 匹配：表名.[字段] 或 表名.字段（如：特来电.[充电结束时间] 或 特来电.充电结束时间）
                const patternWithTable = new RegExp(`\\[?\\w+\\]?\\.\\[?${field}\\]?`, 'gi');
                if (patternWithTable.test(cleanedSelect)) {
                    hasTimeField = true;
                    // 替换带表名前缀的时间字段（包括前后的逗号和空格）
                    cleanedSelect = cleanedSelect.replace(
                        new RegExp(`\\s*\\[?\\w+\\]?\\.\\[?${field}\\]?\\s*,?`, 'gi'),
                        ' '
                    );
                }
                
                // 再清理不带表名前缀的（但要避免误删带表名前缀的字段的一部分）
                // 只匹配 [字段] 格式，避免误匹配
                const patternBrackets = new RegExp(`\\[${field}\\]`, 'gi');
                if (patternBrackets.test(cleanedSelect)) {
                    hasTimeField = true;
                    cleanedSelect = cleanedSelect.replace(
                        new RegExp(`\\s*\\[${field}\\]\\s*,?`, 'gi'),
                        ' '
                    );
                }
            }
            
            if (hasTimeField) {
                // 规范逗号与空格
                cleanedSelect = cleanedSelect.replace(/,\s*,+/g, ','); // 多个连续逗号
                cleanedSelect = cleanedSelect.replace(/^\s*,\s*/g, ''); // 开头的逗号
                cleanedSelect = cleanedSelect.replace(/\s*,\s*$/g, ''); // 结尾的逗号
                cleanedSelect = cleanedSelect.replace(/\s+/g, ' ').trim(); // 多个空格
                
                // 如果清理后SELECT为空，跳过替换（避免破坏SQL）
                if (!cleanedSelect || cleanedSelect.trim() === '') {
                    debugLog('警告：清理后SELECT为空，跳过替换', { original: selectPart });
                    continue;
                }
                
                // 替换SELECT部分
                const beforeSelect = sanitizedQuery.substring(0, match.index);
                const afterSelectPart = sanitizedQuery.substring(match.index + match.fullMatch.length);
                const newSelect = match.fullMatch.replace(selectPart, cleanedSelect);
                sanitizedQuery = beforeSelect + newSelect + afterSelectPart;
                
                debugLog('已清理SELECT中的时间字段', { 
                    original: selectPart,
                    cleaned: cleanedSelect
                });
            }
        }
    }
    
    return sanitizedQuery;
}

// 执行数据库查询
async function executeQuery(sqlQuery) {
    let pool;
    const QUERY_TIMEOUT = 10000; // 数据库查询超时10秒
    try {
        debugLog('开始连接数据库');
        pool = await sql.connect(dbConfig);
        debugLog('数据库连接成功');

        debugLog('执行SQL查询', sqlQuery);
        // 设置查询超时
        const request = pool.request();
        request.timeout = QUERY_TIMEOUT;
        const result = await request.query(sqlQuery);

        debugLog('查询结果数量', result.recordset.length);
        debugLog('查询结果', result.recordset);

        return result.recordset;
    } catch (error) {
        console.error('数据库查询失败:', error.message);
        console.error('出错的SQL语句:', sqlQuery);
        // 将SQL附加到错误信息中，方便前端调试和反馈
        throw new Error(`数据库查询失败: ${error.message}. SQL: ${sqlQuery}`);
    } finally {
        if (pool) {
            try {
                await pool.close();
                debugLog('数据库连接已关闭');
            } catch (err) {
                console.error('关闭数据库连接时出错:', err);
            }
        }
    }
}

// 格式化查询结果
function formatQueryResult(data) {
    if (!data || data.length === 0) {
        return '未找到相关数据。';
    }

    const timeHeaders = ['最小时间', '最大时间', '最早时间', '最晚时间'];
    const dateHeaders = ['日期'];

    // 统一时间格式化：输出为 "YYYY-MM-DD HH:mm:SS"（本地时间），与微信时间展示风格一致
    function formatDateToString(date, includeTime = true) {
        if (!(date instanceof Date)) return date;

        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        if (!includeTime) {
            return `${year}-${month}-${day}`;
        }
        const hour = pad(date.getHours());
        const minute = pad(date.getMinutes());
        const second = pad(date.getSeconds());
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }

    // 辅助函数：格式化日期值
    function formatDateValue(value, contextKey = '') {
        if (!value) return value;

        // 检查是否是日期列（只显示日期部分，不显示时间）
        const isDateOnly = dateHeaders.includes(contextKey);
        const shouldFormat = contextKey ? (timeHeaders.includes(contextKey) || dateHeaders.includes(contextKey)) : true;
        if (!shouldFormat) return value;

        // 如果已经是Date对象，统一格式化
        if (value instanceof Date) {
            return formatDateToString(value, !isDateOnly);
        }

        // 如果是字符串，尝试解析为日期
        if (typeof value === 'string') {
            // 检查是否是日期格式字符串（YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
            const dateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
            if (dateMatch) {
                const year = parseInt(dateMatch[1]);
                const month = parseInt(dateMatch[2]) - 1; // JavaScript月份从0开始
                const day = parseInt(dateMatch[3]);
                const hour = dateMatch[4] ? parseInt(dateMatch[4]) : 0;
                const minute = dateMatch[5] ? parseInt(dateMatch[5]) : 0;
                const second = dateMatch[6] ? parseInt(dateMatch[6]) : 0;

                const date = new Date(year, month, day, hour, minute, second);
                return formatDateToString(date, !isDateOnly);
            }

            // 处理按月分组格式（YYYY-MM）- 直接返回，不添加日期
            const monthMatch = value.match(/^(\d{4})-(\d{2})$/);
            if (monthMatch) {
                // 直接返回 YYYY-MM 格式，不转换为日期对象
                return value;  // 返回原始值，如 "2025-01"、"2025-02"
            }

            // 处理年份格式（YYYY）
            const yearMatch = value.match(/^(\d{4})$/);
            if (yearMatch) {
                const year = parseInt(yearMatch[1]);
                const date = new Date(year, 0, 1);
                return formatDateToString(date, !isDateOnly);
            }
            
            // 如果看起来像数字（可能是错误的CONVERT结果），返回原值
            if (/^\d+$/.test(value)) {
                return value;
            }
        }

        // 如果是年份或月份的纯数字，且需要格式化为时间
        if (typeof value === 'number' && timeHeaders.includes(contextKey)) {
            if (contextKey === '年份' && value >= 1000 && value <= 9999) {
                return new Date(value, 0, 1).toString();
            }
            if (contextKey === '月份' && value >= 1 && value <= 12) {
                const nowYear = new Date().getFullYear();
                return new Date(nowYear, value - 1, 1).toString();
            }
        }
        
        return value;
    }

    // 单行单列结果，直接显示值
    if (data.length === 1 && Object.keys(data[0]).length === 1) {
        const key = Object.keys(data[0])[0];
        const value = Object.values(data[0])[0];

        // 时间类和日期类字段统一格式化输出
        if (timeHeaders.includes(key) || dateHeaders.includes(key)) {
            return `${key}: ${formatDateValue(value, key)}`;
        }

        // 年份和月份显示为整数
        if (key === '年份' || key === '月份' || key === '年' || key === '月') {
            return `${key}: ${typeof value === 'number' ? value.toString() : value}`;
        }

        // 其他数字字段（包括收入、金额、费用、流水等）保留两位小数
        return `${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`;
    }

    let result = '\n';
    const headers = Object.keys(data[0]);

    result += headers.join(' | ') + '\n';
    result += headers.map(() => '---').join(' | ') + '\n';

    data.slice(0, 20).forEach(row => {
        result += headers.map(header => {
            const value = row[header];

            // 时间字段和日期字段特殊处理
            if (timeHeaders.includes(header) || dateHeaders.includes(header)) {
                return formatDateValue(value, header) || '';
            }
            
            if (typeof value === 'number') {
                // 年份和月份显示为整数
                if (header === '年份' || header === '月份' || header === '年' || header === '月') {
                    return value.toString();
                }
                // 其他数字（包括收入、金额、费用、流水等）保留2位小数
                return value.toFixed(2);
            }
            return value || '';
        }).join(' | ') + '\n';
    });

    if (data.length > 20) {
        result += `\n... 还有 ${data.length - 20} 条记录`;
    }

    return result;
}

// 使用DeepSeek回答通用问题
async function askDeepSeek(message) {
    if (!ENABLE_DEEPSEEK) {
        return `抱歉，通用AI问答功能暂时关闭。

原因：LeanCloud 云函数有 15 秒超时限制，复杂问题（如生成合同、长文档）容易超时。

💡 我擅长的功能：
✅ 查询数据库数据（充电、收入、订单等）
✅ 数据统计和分析
✅ 年度对比、趋势分析

📊 试试这些查询：
• "2025年特来电总收入多少"
• "哪个车充电电量最多"
• "四方坪今年收入对比去年"
• "2025年平均每把枪的充电电量"

如需使用通用AI功能，建议：
1. 使用在线 AI 工具（如 ChatGPT、DeepSeek 网页版）
2. 或者将云函数部署到支持更长超时的平台`;
    }

    try {
        debugLog('开始调用DeepSeek API回答通用问题');

        // 根据问题类型调整 max_tokens
        let maxTokens = 800; // 默认较短的回答
        if (message.includes('详细') || message.includes('完整') || message.includes('全部')) {
            maxTokens = 1500;
        }

        // 检测是否是日期相关问题，如果是则自然地提供当前日期上下文
        const dateKeywords = ['今天', '现在', '当前', '今日', '几号', '日期', '星期', '周几'];
        const isDateRelated = dateKeywords.some(keyword => message.includes(keyword));
        
        let userMessage = message;
        if (isDateRelated) {
            // 获取当前日期信息，作为对话上下文自然地提供给AI
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            const currentDay = now.getDate();
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            const currentWeekday = weekdays[now.getDay()];
            const currentDateStr = `${currentYear}年${currentMonth}月${currentDay}日`;
            
            // 以自然的方式在用户消息后添加日期上下文，让AI自己判断使用
            userMessage = `${message}\n\n（注：当前系统日期是 ${currentDateStr} ${currentWeekday}）`;
        }

        // 系统提示词保持简洁，让AI自由发挥
        const systemPrompt = '你是一个友好、专业的AI助手，请用简洁准确的语言回答用户的问题。对于文档类请求（如合同、报告），提供要点和框架即可，不需要过于详细。';

        const requestData = {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: maxTokens,
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
                timeout: 20000,  // 减少到 20 秒
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                }
            }
        );

        if (response.status !== 200) {
            console.error('DeepSeek API 状态码:', response.status);
            return '抱歉，AI服务暂时不可用。如果您是在询问数据库相关问题，请在问题中包含表名关键词。';
        }

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('DeepSeek API 返回的数据格式不正确');
        }

        return response.data.choices[0].message.content.trim();

    } catch (error) {
        console.error('DeepSeek API调用失败:', error.message);
        if (error.code === 'ECONNABORTED') {
            return '抱歉，AI响应超时。建议：\n1. 尝试更简短的问题\n2. 对于文档类需求，可以分步骤询问\n3. 或者直接询问数据库相关的查询';
        }
        return '抱歉，AI服务暂时不可用。我可以帮您查询数据库相关的问题。';
    }
}

// 保存对话记录到LeanCloud
async function saveConversationLog(logData) {
    try {
        const ConversationLog = AV.Object.extend('ConversationLog');
        const log = new ConversationLog();
        
        // 设置所有字段
        log.set('userMessage', logData.userMessage || '');
        log.set('aiReply', logData.aiReply || '');
        log.set('queryType', logData.queryType || 'unknown'); // 'database' 或 'general'
        log.set('sessionId', logData.sessionId || 'default');
        log.set('timestamp', new Date(logData.timestamp || Date.now()));
        log.set('processingTime', logData.processingTime || 0);
        log.set('isSuccess', logData.isSuccess !== false);
        
        // 数据库查询相关字段
        if (logData.queryType === 'database') {
            log.set('tables', logData.tables || []);
            log.set('sqlQuery', logData.sqlQuery || '');
            log.set('queryResult', logData.queryResult || '');
            log.set('method', logData.method || 'unknown');
        }
        
        // 错误信息
        if (logData.error) {
            log.set('error', logData.error);
            log.set('errorMessage', logData.errorMessage || '');
        }
        
        // 用户信息（如果有）
        if (logData.userId) {
            log.set('userId', logData.userId);
        }
        if (logData.userIp) {
            log.set('userIp', logData.userIp);
        }
        
        // 保存到LeanCloud
        await log.save();
        debugLog('对话记录已保存', { objectId: log.id });
        
        return log.id;
    } catch (error) {
        // 记录失败不应该影响主流程，只记录错误
        console.error('保存对话记录失败:', error);
        return null;
    }
}

// 云函数：处理AI对话
AV.Cloud.define('chatWithAI', async (request) => {
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 12000; // 最大处理时间12秒，留3秒缓冲给LeanCloud
    const { message, sessionId } = request.params;
    const requestIp = request.meta.remoteAddress || request.ip || 'unknown';
    const userId = request.user ? request.user.id : 'anonymous';

    debugLog('收到新请求', { message, sessionId, userId, timestamp: new Date().toISOString() });

    if (!message || typeof message !== 'string') {
        throw new AV.Cloud.Error('消息内容不能为空');
    }

    // 设置超时检查
    let timeoutCheck = null;
    if (DEBUG_MODE) {
        timeoutCheck = setInterval(() => {
            const elapsed = Date.now() - startTime;
            if (elapsed > MAX_PROCESSING_TIME) {
                console.warn(`处理时间过长: ${elapsed}ms`);
            }
        }, 1000);
    }

    let result = null;
    let logData = {
        userMessage: message,
        sessionId: sessionId || 'default',
        timestamp: startTime,
        userId: userId,
        userIp: requestIp
    };

    try {
        const isDbQuery = isDatabaseQuery(message);
        debugLog('问题类型判断', { isDbQuery, message, ENABLE_DATABASE_QUERY });

        // 如果数据库查询功能被禁用，强制走通用AI问答流程
        if (isDbQuery && ENABLE_DATABASE_QUERY) {
            debugLog('进入数据库查询流程');
            logData.queryType = 'database';

            const { tables, metadata } = extractTableNames(message);
            debugLog('提取的表名和元数据', { tables, metadata });
            logData.tables = tables;

            if (tables.length === 0) {
                // 任务6：使用友好的错误消息
                const friendlyError = createFriendlyErrorMessage('NO_TABLES_FOUND');
                result = {
                    reply: friendlyError,
                    processingTime: Date.now() - startTime
                };
                logData.aiReply = result.reply;
                logData.isSuccess = false;
                logData.errorMessage = '无法识别数据表';

                // 异步保存日志，不阻塞返回
                saveConversationLog(logData).catch(err => console.error('保存日志失败:', err));

                return result;
            }

            let sqlQuery = await analyzeQuestionWithAI(message, tables, metadata);
            // 清理SQL中不应该出现在SELECT里的时间字段
            sqlQuery = sanitizeSQLQuery(sqlQuery, message);

            let queryResult = null;
            let queryError = null;

            try {
                queryResult = await executeQuery(sqlQuery);
            } catch (execError) {
                debugLog('SQL执行错误', execError);
                queryError = execError;
            }

            const processingTime = Date.now() - startTime;

            // 任务6：处理SQL执行错误
            if (queryError) {
                const friendlyError = createFriendlyErrorMessage('SQL_EXECUTION_ERROR', {
                    errorMessage: queryError.message
                });
                result = {
                    reply: friendlyError,
                    error: DEBUG_MODE ? queryError.message : undefined,
                    processingTime: processingTime
                };
                logData.aiReply = result.reply;
                logData.isSuccess = false;
                logData.errorMessage = queryError.message;

                saveConversationLog(logData).catch(err => console.error('保存日志失败:', err));
                clearInterval(timeoutCheck);
                return result;
            }

            // 任务6和7：处理空数据结果，添加数据范围提示
            if (!queryResult || queryResult.length === 0) {
                let noDataMessage = createFriendlyErrorMessage('NO_DATA_FOUND');

                // 任务7：尝试添加数据范围提示
                const timeInfo = extractTimeInfo(message);
                if (timeInfo.hasTime && tables.length > 0) {
                    const tableName = tables[0];
                    try {
                        const warning = await checkTimeRangeWithWarning(timeInfo, tableName);
                        if (warning) {
                            noDataMessage = warning;
                        }
                    } catch (warnError) {
                        debugLog('获取数据范围警告时出错', warnError.message);
                    }
                }

                result = {
                    reply: noDataMessage,
                    processingTime: processingTime,
                    method: ENABLE_DEEPSEEK ? 'DeepSeek AI' : '规则匹配',
                    rawData: queryResult,
                    hasData: false
                };
            } else {
                // 有数据的情况
                const formattedResult = formatQueryResult(queryResult);

                // 任务7：如果有时间信息，检查是否接近数据范围边界
                let timeRangeWarning = null;
                const timeInfo = extractTimeInfo(message);
                if (timeInfo.hasTime && tables.length > 0) {
                    const tableName = tables[0];
                    try {
                        timeRangeWarning = await checkTimeRangeWithWarning(timeInfo, tableName);
                    } catch (warnError) {
                        debugLog('获取数据范围警告时出错', warnError.message);
                    }
                }

                // 如果有警告，附加到结果前
                let reply = `查询结果：${formattedResult}`;
                if (timeRangeWarning) {
                    reply = `${timeRangeWarning}\n\n${reply}`;
                }

                result = {
                    reply: reply,
                    sqlQuery: undefined, // 不返回SQL查询语句
                    processingTime: processingTime,
                    method: ENABLE_DEEPSEEK ? 'DeepSeek AI' : '规则匹配',
                    rawData: queryResult, // 添加原始数据用于Excel导出
                    hasData: true
                };
            }

            logData.aiReply = result.reply;
            logData.sqlQuery = sqlQuery;
            // 只有在有数据时才记录格式化结果
            if (queryResult && queryResult.length > 0) {
                logData.queryResult = formatQueryResult(queryResult);
            } else {
                logData.queryResult = '无数据';
            }
            logData.method = result.method;
            logData.processingTime = processingTime;
            logData.isSuccess = true;

            // 异步保存日志，不阻塞返回
            saveConversationLog(logData).catch(err => console.error('保存日志失败:', err));
            
            clearInterval(timeoutCheck);
            return result;
        } else {
            debugLog('进入通用问答流程');
            logData.queryType = 'general';

            const aiResponse = await askDeepSeek(message);
            const processingTime = Date.now() - startTime;

            result = {
                reply: aiResponse,
                processingTime: processingTime
            };

            logData.aiReply = aiResponse;
            logData.processingTime = processingTime;
            logData.isSuccess = true;

            // 异步保存日志，不阻塞返回
            saveConversationLog(logData).catch(err => console.error('保存日志失败:', err));

            clearInterval(timeoutCheck);
            return result;
        }
    } catch (error) {
        console.error('处理请求时出错:', error);

        let errorMessage = '抱歉，处理您的请求时出现错误。\n';

        // 清理错误信息中的SQL语句，避免在回答中显示SELECT查询
        let cleanErrorMessage = error.message;
        if (cleanErrorMessage.includes('SQL:')) {
            // 移除SQL部分
            cleanErrorMessage = cleanErrorMessage.split('SQL:')[0].trim();
            // 移除末尾的句号或空格
            cleanErrorMessage = cleanErrorMessage.replace(/[.\s]+$/, '');
        }

        if (error.message.includes('无法识别')) {
            errorMessage = cleanErrorMessage;
        } else if (error.message.includes('数据库')) {
            errorMessage += `数据库错误: ${cleanErrorMessage}`;
        } else {
            errorMessage += `错误信息: ${cleanErrorMessage}`;
        }

        result = {
            reply: errorMessage,
            error: DEBUG_MODE ? error.message : undefined,
            processingTime: Date.now() - startTime
        };

        logData.aiReply = errorMessage;
        logData.error = error.message;
        logData.errorMessage = errorMessage;
        logData.processingTime = Date.now() - startTime;
        logData.isSuccess = false;

        // 异步保存错误日志
        saveConversationLog(logData).catch(err => console.error('保存日志失败:', err));

        clearInterval(timeoutCheck);
        return result;
    } finally {
        // 确保清理超时检查
        if (typeof timeoutCheck !== 'undefined') {
            clearInterval(timeoutCheck);
        }
    }
});

// 查询对话记录
AV.Cloud.define('getConversationLogs', async (request) => {
    try {
        const { 
            sessionId, 
            startDate, 
            endDate, 
            limit = 100,
            skip = 0 
        } = request.params;

        const ConversationLog = AV.Object.extend('ConversationLog');
        const query = new AV.Query(ConversationLog);

        // 按时间倒序排列
        query.descending('timestamp');

        // 如果有sessionId，筛选该会话
        if (sessionId) {
            query.equalTo('sessionId', sessionId);
        }

        // 如果有日期范围，筛选日期
        if (startDate) {
            query.greaterThanOrEqualTo('timestamp', new Date(startDate));
        }
        if (endDate) {
            query.lessThanOrEqualTo('timestamp', new Date(endDate));
        }

        // 限制返回数量
        query.limit(limit);
        query.skip(skip);

        const logs = await query.find();
        
        const result = logs.map(log => ({
            objectId: log.id,
            userMessage: log.get('userMessage'),
            aiReply: log.get('aiReply'),
            queryType: log.get('queryType'),
            sessionId: log.get('sessionId'),
            timestamp: log.get('timestamp'),
            processingTime: log.get('processingTime'),
            isSuccess: log.get('isSuccess'),
            tables: log.get('tables') || [],
            sqlQuery: log.get('sqlQuery') || '',
            queryResult: log.get('queryResult') || '',
            method: log.get('method') || '',
            error: log.get('error') || '',
            errorMessage: log.get('errorMessage') || '',
            userId: log.get('userId') || '',
            userIp: log.get('userIp') || ''
        }));

        // 获取总数
        const countQuery = new AV.Query(ConversationLog);
        if (sessionId) {
            countQuery.equalTo('sessionId', sessionId);
        }
        if (startDate) {
            countQuery.greaterThanOrEqualTo('timestamp', new Date(startDate));
        }
        if (endDate) {
            countQuery.lessThanOrEqualTo('timestamp', new Date(endDate));
        }
        const totalCount = await countQuery.count();

        return {
            success: true,
            logs: result,
            total: totalCount,
            limit: limit,
            skip: skip
        };
    } catch (error) {
        console.error('查询对话记录失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
});

// 获取对话统计信息
AV.Cloud.define('getConversationStats', async (request) => {
    try {
        const { startDate, endDate } = request.params;

        const ConversationLog = AV.Object.extend('ConversationLog');
        
        // 构建基础查询
        const buildQuery = () => {
            const query = new AV.Query(ConversationLog);
            if (startDate) {
                query.greaterThanOrEqualTo('timestamp', new Date(startDate));
            }
            if (endDate) {
                query.lessThanOrEqualTo('timestamp', new Date(endDate));
            }
            return query;
        };

        // 总对话数
        const totalQuery = buildQuery();
        const totalCount = await totalQuery.count();

        // 成功对话数
        const successQuery = buildQuery();
        successQuery.equalTo('isSuccess', true);
        const successCount = await successQuery.count();

        // 失败对话数
        const failQuery = buildQuery();
        failQuery.equalTo('isSuccess', false);
        const failCount = await failQuery.count();

        // 数据库查询数
        const dbQuery = buildQuery();
        dbQuery.equalTo('queryType', 'database');
        const dbCount = await dbQuery.count();

        // 通用问答数
        const generalQuery = buildQuery();
        generalQuery.equalTo('queryType', 'general');
        const generalCount = await generalQuery.count();

        // 平均处理时间
        const avgTimeQuery = buildQuery();
        avgTimeQuery.select('processingTime');
        const allLogs = await avgTimeQuery.find();
        const avgProcessingTime = allLogs.length > 0
            ? allLogs.reduce((sum, log) => sum + (log.get('processingTime') || 0), 0) / allLogs.length
            : 0;

        // 按表统计
        const tableStats = {};
        const tableQuery = buildQuery();
        tableQuery.equalTo('queryType', 'database');
        tableQuery.select('tables');
        const tableLogs = await tableQuery.find();
        tableLogs.forEach(log => {
            const tables = log.get('tables') || [];
            tables.forEach(table => {
                tableStats[table] = (tableStats[table] || 0) + 1;
            });
        });

        return {
            success: true,
            stats: {
                total: totalCount,
                success: successCount,
                failed: failCount,
                database: dbCount,
                general: generalCount,
                avgProcessingTime: Math.round(avgProcessingTime),
                tableStats: tableStats
            }
        };
    } catch (error) {
        console.error('获取统计信息失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
});

// 测试DeepSeek API连接
AV.Cloud.define('testDeepSeekAPI', async (request) => {
    try {
        debugLog('测试DeepSeek API连接');

        const response = await axios.get(
            'https://api.deepseek.com/v1/models',
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                },
                timeout: 10000
            }
        );

        debugLog('API测试成功', response.data);

        return {
            success: true,
            message: 'DeepSeek API连接正常',
            models: response.data,
            enabled: ENABLE_DEEPSEEK
        };
    } catch (error) {
        console.error('API测试失败:', error);

        return {
            success: false,
            message: 'DeepSeek API连接失败',
            error: error.message,
            status: error.response ? error.response.status : null,
            data: error.response ? error.response.data : null,
            enabled: ENABLE_DEEPSEEK
        };
    }
});

// 测试数据库连接
AV.Cloud.define('testDatabaseConnection', async (request) => {
    let pool;
    try {
        debugLog('测试数据库连接');

        pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT @@VERSION AS version');

        debugLog('数据库测试成功', result.recordset);

        return {
            success: true,
            message: '数据库连接正常',
            version: result.recordset[0].version
        };
    } catch (error) {
        console.error('数据库测试失败:', error);

        return {
            success: false,
            message: '数据库连接失败',
            error: error.message
        };
    } finally {
        if (pool) {
            await pool.close();
        }
    }
});

// 查询数据库中的所有表名
AV.Cloud.define('listDatabaseTables', async (request) => {
    let pool;
    try {
        debugLog('查询数据库表名');

        pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `);

        debugLog('查询到的表名', result.recordset);

        const tableNames = result.recordset.map(row => row.TABLE_NAME);

        return {
            success: true,
            message: `找到 ${tableNames.length} 个表`,
            tables: tableNames
        };
    } catch (error) {
        console.error('查询表名失败:', error);

        return {
            success: false,
            message: '查询表名失败',
            error: error.message
        };
    } finally {
        if (pool) {
            await pool.close();
        }
    }
});

// 测试获取所有表的时间范围
AV.Cloud.define('getTableTimeRanges', async (request) => {
    try {
        debugLog('测试获取所有表的时间范围');

        const timeRanges = await getTableTimeRanges();

        return {
            success: true,
            message: '成功获取所有表的时间范围',
            timeRanges: timeRanges
        };
    } catch (error) {
        console.error('获取时间范围失败:', error);

        return {
            success: false,
            message: '获取时间范围失败',
            error: error.message
        };
    }
});

module.exports = AV.Cloud;
