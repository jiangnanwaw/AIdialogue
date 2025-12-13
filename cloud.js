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
const ENABLE_DEEPSEEK = false;

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
    '超时占位费': '超时占位费'
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
            '费用': { column: '[充电费用(元)]', type: 'number' },
            '金额': { column: '[充电费用(元)]', type: 'number' },
            '收入': { column: '[充电费用(元)]', type: 'number' },
            '充电时长': { column: '[充电时长(分钟)]', type: 'number' },
            '时长': { column: '[充电时长(分钟)]', type: 'number' },
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
            '充电服务费': { column: '[服务费]', type: 'number' },
            '服务费': { column: '[服务费]', type: 'number' },
            '充电费用': { column: '[消费金额]', type: 'number' },
            '费用': { column: '[消费金额]', type: 'number' },
            '金额': { column: '[消费金额]', type: 'number' },
            '收入': { column: '[消费金额]', type: 'number' },
            '充电时长': { column: 'DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))', type: 'computed' },
            '时长': { column: 'DATEDIFF(MINUTE, 0, CAST([充电时长] AS TIME))', type: 'computed' },
            '订单数量': { column: '[订单类型]', type: 'count' },
            '订单数': { column: '[订单类型]', type: 'count' }
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
            '交易金额': { column: '[交易金额]', type: 'number' }
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
            '交款金额': { column: '[交款金额]', type: 'number' }
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
            '收入': { column: '[应收金额]', type: 'number' },
            '金额': { column: '[应收金额]', type: 'number' },
            '应收金额': { column: '[应收金额]', type: 'number' }
        }
    }
};

// 判断是否是数据库查询问题
function isDatabaseQuery(message) {
    const hasTableName = Object.keys(TABLE_NAMES).some(name => message.includes(name));
    const hasCharging = message.includes('充电');
    const hasSifangping = message.includes('四方坪');
    const hasGaoling = message.includes('高岭');
    const hasChehaiyang = message.includes('车海洋');
    const hasWeixin = message.includes('微信');

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

    return hasTableName || hasCharging || hasSifangping || hasGaoling || hasChehaiyang || hasWeixin ||
           hasXingyuan || hasCheyanziji || hasKuaiyijie || hasHongmen || hasSaifeimu ||
           hasShouqianba || hasYuezuche || hasZhixiaomeng || hasOvertime || hasDianliju;
}

// 从问题中提取表名
function extractTableNames(message) {
    const tables = [];
    const metadata = {
        isSifangping: false,
        isGaoling: false
    };

    // 特殊逻辑：高岭 - 只查询特来电高岭站点
    if (message.includes('高岭')) {
        metadata.isGaoling = true;
        tables.push('特来电');
        return { tables, metadata };
    }

    // 特殊逻辑：四方坪 - 需要判断是否合并查询特来电+能科
    if (message.includes('四方坪')) {
        metadata.isSifangping = true;

        // 判断查询条件是否为单一的基础指标
        const isSimpleMetric = (
            (message.includes('充电电量') || message.includes('电量')) ||
            (message.includes('充电服务费') || message.includes('服务费')) ||
            (message.includes('充电费用') || message.includes('费用') || message.includes('收入')) ||
            (message.includes('充电时长') || message.includes('时长')) ||
            message.includes('订单数量') || message.includes('订单数') || message.includes('多少单')
        );

        // 判断是否有额外的查询维度（车牌、设备、具体日期等）
        const hasExtraDimension = (
            message.includes('车') ||
            message.includes('哪个') ||
            message.includes('哪些') ||
            message.includes('排名') ||
            message.includes('最多') ||
            message.includes('最少') ||
            message.includes('最大') ||
            message.includes('最小') ||
            /\d{1,2}月/.test(message) || // 具体到某月
            /\d{1,2}日/.test(message)    // 具体到某日
        );

        // 只有在查询简单指标且没有额外维度时，才合并特来电+能科
        if (isSimpleMetric && !hasExtraDimension) {
            tables.push('特来电', '能科');
        } else {
            // 其他情况只查询特来电表
            tables.push('特来电');
        }

        return { tables, metadata };
    }

    // 车海洋逻辑
    if (message.includes('车海洋') && !message.includes('充值') && !message.includes('消费')) {
        tables.push('车海洋洗车充值', '车海洋洗车消费');
        return { tables, metadata };
    }

    // 微信逻辑
    if (message.includes('微信') && !message.includes('商户') && !message.includes('收款')) {
        tables.push('微信商户下单', '微信收款商业版');
        return { tables, metadata };
    }

    // 充电逻辑
    if (message.includes('充电') && !message.includes('特来电') && !message.includes('能科')) {
        tables.push('特来电', '能科');
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
        // 月租车 -> 月租车充值
        if (message.includes('月租车') && !tables.includes('月租车充值')) {
            tables.push('月租车充值');
        }
        // 智小盟直接匹配
        if (message.includes('智小盟') && !tables.includes('智小盟')) {
            tables.push('智小盟');
        }
        // 超时占位 -> 超时占位费
        if (message.includes('超时') && !tables.includes('超时占位费')) {
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
        isLastYear: false
    };

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

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

    // 匹配"今天"
    if (message.includes('今天')) {
        timeInfo.hasTime = true;
        timeInfo.isToday = true;
        timeInfo.year = currentYear;
        timeInfo.month = currentMonth;
        timeInfo.day = currentDay;
    }

    // 生成日期范围
    if (timeInfo.year) {
        if (timeInfo.month) {
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

    return timeInfo;
}

// 规则匹配生成SQL
function generateSQLByRules(message, tables) {
    debugLog('使用规则匹配生成SQL', { message, tables });

    const timeInfo = extractTimeInfo(message);
    debugLog('提取的时间信息', timeInfo);

    // 判断查询类型
    const isSum = message.includes('总') || message.includes('合计') || message.includes('多少');
    const isAvg = message.includes('平均');
    const isMax = message.includes('最大') || message.includes('最高');
    const isMin = message.includes('最小') || message.includes('最低');
    const isCount = message.includes('次数') || message.includes('个数') || message.includes('多少次');

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

        // 处理四方坪和高岭的特殊逻辑
        if (table === '特来电_四方坪') {
            actualTable = '特来电';
            extraCondition = " AND [电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'";
        } else if (table === '特来电_高岭') {
            actualTable = '特来电';
            extraCondition = " AND ([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')";
        }

        if (!TABLE_FIELDS[actualTable]) continue;

        const tableConfig = TABLE_FIELDS[actualTable];
        const timeField = tableConfig.timeField;
        let selectClause = '';

        if (isSum) {
            selectClause = `SELECT SUM(${queryColumn}) AS 总计`;
        } else if (isAvg) {
            selectClause = `SELECT AVG(${queryColumn}) AS 平均值`;
        } else if (isMax) {
            selectClause = `SELECT MAX(${queryColumn}) AS 最大值`;
        } else if (isMin) {
            selectClause = `SELECT MIN(${queryColumn}) AS 最小值`;
        } else if (isCount) {
            selectClause = `SELECT COUNT(*) AS 次数`;
        } else {
            selectClause = `SELECT SUM(${queryColumn}) AS 总计`;
        }

        let whereClause = `WHERE ${queryColumn} IS NOT NULL AND ${queryColumn} > 0`;

        // 添加时间条件
        if (timeInfo.hasTime && timeInfo.startDate) {
            if (timeInfo.startDate === timeInfo.endDate) {
                whereClause += ` AND CAST([${timeField}] AS DATE) = '${timeInfo.startDate}'`;
            } else {
                whereClause += ` AND [${timeField}] >= '${timeInfo.startDate}' AND [${timeField}] <= '${timeInfo.endDate} 23:59:59'`;
            }
        }

        // 添加特殊条件
        // 赛菲姆道闸：支付方式过滤
        if (actualTable === '赛菲姆道闸') {
            whereClause += " AND ([支付方式] = '微信支付' OR [支付方式] = '支付宝支付')";
        }

        // 收钱吧：交易状态过滤
        if (actualTable === '收钱吧') {
            whereClause += " AND [交易状态] = '成功'";
        }

        // 添加额外条件（四方坪、高岭）
        whereClause += extraCondition;

        const sql = `${selectClause} FROM [${actualTable}] ${whereClause}`;
        sqlParts.push(sql);
    }

    let finalSQL = sqlParts.join(' UNION ALL ');

    // 如果有多个表，需要再次聚合
    if (sqlParts.length > 1) {
        if (isSum) {
            finalSQL = `SELECT SUM(总计) AS 总计 FROM (${finalSQL}) AS combined`;
        } else if (isAvg) {
            finalSQL = `SELECT AVG(平均值) AS 平均值 FROM (${finalSQL}) AS combined`;
        } else if (isMax) {
            finalSQL = `SELECT MAX(最大值) AS 最大值 FROM (${finalSQL}) AS combined`;
        } else if (isMin) {
            finalSQL = `SELECT MIN(最小值) AS 最小值 FROM (${finalSQL}) AS combined`;
        } else if (isCount) {
            finalSQL = `SELECT SUM(次数) AS 次数 FROM (${finalSQL}) AS combined`;
        }
    }

    debugLog('生成的SQL', finalSQL);
    return finalSQL;
}

// 使用DeepSeek分析问题并生成SQL
async function analyzeQuestionWithAI(message, tables, metadata = {}) {
    if (!ENABLE_DEEPSEEK) {
        debugLog('DeepSeek已禁用，使用规则匹配');
        return generateSQLByRules(message, tables);
    }

    try {
        debugLog('开始调用DeepSeek API分析问题');

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
                    if (metadata.isSifangping) {
                        tableInfo += `\n  **重要WHERE条件（四方坪筛选）**：[电站名称] NOT LIKE '%华为飞狐特来电高岭超充站%' AND [电站名称] NOT LIKE '%长沙市开福区高岭香江国际城充电站建设项目%'`;
                    } else if (metadata.isGaoling) {
                        tableInfo += `\n  **重要WHERE条件（高岭筛选）**：([电站名称] LIKE '%华为飞狐特来电高岭超充站%' OR [电站名称] LIKE '%长沙市开福区高岭香江国际城充电站建设项目%')`;
                    }
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
- 能科表：使用 COUNT([订单类型]) 统计订单数`;
        }

        // 添加终端/枪查询说明
        let terminalNote = '';
        if (tables.includes('特来电') && (message.includes('枪') || message.includes('终端'))) {
            terminalNote = `\n\n**终端/枪查询特别说明**：
- 终端唯一标识：需要使用 [电站名称] + [终端名称] 组合（因为不同电站可能有相同的终端名称）
- 查询示例："哪把枪充电电量最多"
  SELECT TOP 1 [电站名称], [终端名称], SUM([充电电量(度)]) AS 总电量
  FROM [特来电]
  WHERE [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL AND [充电电量(度)] > 0
  GROUP BY [电站名称], [终端名称]
  ORDER BY 总电量 DESC

- 平均值计算："平均每把枪的充电电量"
  SELECT SUM([充电电量(度)]) / NULLIF(COUNT(DISTINCT [电站名称] + '|' + [终端名称]), 0) AS 平均值
  FROM [特来电]
  WHERE 时间条件 AND [电站名称] IS NOT NULL AND [终端名称] IS NOT NULL

- **重要**：结果必须同时显示电站名称和终端名称`;
        }

        const systemPrompt = `你是一个SQL查询助手，专门帮助用户根据自然语言问题生成SQL Server 2008 R2查询语句。

数据库版本：SQL Server 2008 R2（不支持2012+的新函数）
数据库名称：chargingdata

可用的表和字段信息：${tableInfo}${orderCountNote}${terminalNote}

重要规则：
1. **必须使用字段映射中的实际字段名**，不要自己猜测字段名
2. 例如："充电电量" 在特来电表中对应 [充电电量(度)]，在能科表中对应 [充电量]
3. 例如："收入" 在特来电表中对应 [充电费用(元)]，在能科表中对应 [消费金额]，在收钱吧表中对应 [实收金额]
4. **所有查询必须过滤空值、0值和空字符串**：WHERE column IS NOT NULL AND column != '' AND column > 0
5. 表名和字段名都需要用方括号括起来：[表名]、[字段名]
6. 如果涉及多个表，需要使用UNION ALL合并
7. **表名必须完全准确**，不要添加"表"字。例如使用 [特来电] 而不是 [特来电表]
8. **只能使用字段映射中列出的字段名**，不要使用任何未列出的字段
9. **禁止使用SQL Server 2012+的函数**，例如：DATEFROMPARTS, EOMONTH, FORMAT等
10. 时间筛选使用传统方式：
    - 某一天：CAST([时间字段] AS DATE) = '2024-12-13'
    - 某个月：[时间字段] >= '2024-12-01' AND [时间字段] < '2025-01-01'
    - 某一年：YEAR([时间字段]) = 2024
11. 获取当前年份使用：YEAR(GETDATE())
12. 月份最后一天使用：DATEADD(DAY, -1, DATEADD(MONTH, 1, '2024-12-01'))
13. **微信表的金额字段是nvarchar类型**，需要转换：CAST([订单金额] AS FLOAT)

特殊查询逻辑：
A. **平均值计算**（如"平均每个月收入"）：
   - 不要使用简单的AVG()
   - 应该：总收入 / 实际有数据的月份数
   - 示例SQL：
     SELECT SUM(收入) / NULLIF(COUNT(DISTINCT YEAR([时间]) * 100 + MONTH([时间])), 0) AS 月平均收入
     FROM [表名]
     WHERE [时间] >= '起始日期' AND [时间] < '结束日期'

B. **年度对比**（如"2025年对比2024年"）：
   - 需要先计算每年的数据，然后计算增减
   - 不要只返回每年的数值
   - 应该返回：增加或下降的数值和百分比
   - 示例SQL：
     SELECT
         MAX(CASE WHEN 年份 = 2025 THEN 总数 END) - MAX(CASE WHEN 年份 = 2024 THEN 总数 END) AS 增减量,
         CASE
             WHEN MAX(CASE WHEN 年份 = 2024 THEN 总数 END) > 0
             THEN (MAX(CASE WHEN 年份 = 2025 THEN 总数 END) - MAX(CASE WHEN 年份 = 2024 THEN 总数 END)) * 100.0 / MAX(CASE WHEN 年份 = 2024 THEN 总数 END)
             ELSE 0
         END AS 增长率
     FROM (
         SELECT YEAR([时间字段]) AS 年份, SUM(字段) AS 总数
         FROM [表名]
         WHERE YEAR([时间字段]) IN (2024, 2025)
         GROUP BY YEAR([时间字段])
     ) AS 年度数据

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
   - WHERE [车牌号] IS NOT NULL AND [车牌号] != '' AND [充电量] > 0
   - 使用TOP N限制结果数量

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

// 执行数据库查询
async function executeQuery(sqlQuery) {
    let pool;
    try {
        debugLog('开始连接数据库');
        pool = await sql.connect(dbConfig);
        debugLog('数据库连接成功');

        debugLog('执行SQL查询', sqlQuery);
        const result = await pool.request().query(sqlQuery);

        debugLog('查询结果数量', result.recordset.length);
        debugLog('查询结果', result.recordset);

        return result.recordset;
    } catch (error) {
        console.error('数据库查询失败:', error.message);
        throw new Error(`数据库查询失败: ${error.message}`);
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

    // 单行单列结果，直接显示值
    if (data.length === 1 && Object.keys(data[0]).length === 1) {
        const key = Object.keys(data[0])[0];
        const value = Object.values(data[0])[0];

        // 年份和月份显示为整数，其他数字保留2位小数
        if (key === '年份' || key === '月份') {
            return `${key}: ${value}`;
        }

        return `${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`;
    }

    let result = '\n';
    const headers = Object.keys(data[0]);

    result += headers.join(' | ') + '\n';
    result += headers.map(() => '---').join(' | ') + '\n';

    data.slice(0, 20).forEach(row => {
        result += headers.map(header => {
            const value = row[header];
            if (typeof value === 'number') {
                // 年份和月份显示为整数，其他数字保留2位小数
                if (header === '年份' || header === '月份') {
                    return value.toString();
                }
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

        const requestData = {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: '你是一个友好、专业的AI助手，请用简洁准确的语言回答用户的问题。对于文档类请求（如合同、报告），提供要点和框架即可，不需要过于详细。' },
                { role: 'user', content: message }
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

// 云函数：处理AI对话
AV.Cloud.define('chatWithAI', async (request) => {
    const startTime = Date.now();
    const { message } = request.params;

    debugLog('收到新请求', { message, timestamp: new Date().toISOString() });

    if (!message || typeof message !== 'string') {
        throw new AV.Cloud.Error('消息内容不能为空');
    }

    try {
        const isDbQuery = isDatabaseQuery(message);
        debugLog('问题类型判断', { isDbQuery, message });

        if (isDbQuery) {
            debugLog('进入数据库查询流程');

            const { tables, metadata } = extractTableNames(message);
            debugLog('提取的表名和元数据', { tables, metadata });

            if (tables.length === 0) {
                return {
                    reply: '抱歉，我无法识别您要查询的数据表，请明确指定表名或使用相关关键词。',
                    processingTime: Date.now() - startTime
                };
            }

            const sqlQuery = await analyzeQuestionWithAI(message, tables, metadata);
            const queryResult = await executeQuery(sqlQuery);
            const formattedResult = formatQueryResult(queryResult);

            const processingTime = Date.now() - startTime;

            return {
                reply: `查询结果：${formattedResult}`,
                sqlQuery: DEBUG_MODE ? sqlQuery : undefined,
                processingTime: processingTime,
                method: ENABLE_DEEPSEEK ? 'DeepSeek AI' : '规则匹配'
            };
        } else {
            debugLog('进入通用问答流程');

            const aiResponse = await askDeepSeek(message);
            const processingTime = Date.now() - startTime;

            return {
                reply: aiResponse,
                processingTime: processingTime
            };
        }
    } catch (error) {
        console.error('处理请求时出错:', error);

        let errorMessage = '抱歉，处理您的请求时出现错误。\n';

        if (error.message.includes('无法识别')) {
            errorMessage = error.message;
        } else if (error.message.includes('数据库')) {
            errorMessage += `数据库错误: ${error.message}`;
        } else {
            errorMessage += `错误信息: ${error.message}`;
        }

        return {
            reply: errorMessage,
            error: DEBUG_MODE ? error.message : undefined,
            processingTime: Date.now() - startTime
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

module.exports = AV.Cloud;
