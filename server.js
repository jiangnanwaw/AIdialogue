const AV = require('leanengine');
const express = require('express');

AV.init({
    appId: process.env.LEANCLOUD_APP_ID || '8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz',
    appKey: process.env.LEANCLOUD_APP_KEY || 'CMGwM4hzM3C2TXTfIYQVS6TM',
    masterKey: process.env.LEANCLOUD_APP_MASTER_KEY || 'EWL7AJTpwcTvRbfSsEj3rYmU',
    serverURL: process.env.LEANCLOUD_APP_SERVER_URL || 'https://8luz5iul.lc-cn-n1-shared.com'
});

AV.Cloud.useMasterKey();

const app = express();

// 加载云引擎中间件
app.use(AV.express());

app.enable('trust proxy');
// 需要重定向到 HTTPS 可去除下一行的注释。
// app.use(AV.Cloud.HttpsRedirect());

app.use(express.static('public'));

// 加载云函数定义
require('./cloud');

const PORT = parseInt(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3200);

app.listen(PORT, function (err) {
    console.log('Node app is running on port:', PORT);

    // 注册全局未捕获异常处理器
    process.on('uncaughtException', function (err) {
        console.error('Caught exception:', err.stack);
    });
    process.on('unhandledRejection', function (reason, p) {
        console.error('Unhandled Rejection at:', p, 'reason:', reason.stack);
    });
});

module.exports = app;
