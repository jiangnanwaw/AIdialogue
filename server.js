const AV = require('leanengine');
const express = require('express');
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

// 主页路由
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>特来电智能系统</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light">
        <div class="container mt-5">
            <div class="card shadow">
                <div class="card-header bg-primary text-white">
                    <h3>特来电智能数据查询系统</h3>
                </div>
                <div class="card-body">
                    <h5>✅ 系统运行正常！</h5>
                    <hr>
                    <p><strong>系统配置：</strong></p>
                    <ul>
                        <li>LeanCloud AppID: 8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz</li>
                        <li>SQL Server: csfhcdz.f3322.net:1433</li>
                        <li>数据库：特来电</li>
                        <li>用户名：csfh</li>
                        <li>DeepSeek API：已配置</li>
                    </ul>
                    <hr>
                    <p>应用启动时间：${new Date().toLocaleString()}</p>
                    <p>端口：${process.env.LEANCLOUD_APP_PORT || 3000}</p>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

// 健康检查路由
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    app: '特来电智能系统',
    timestamp: new Date().toISOString(),
    port: process.env.LEANCLOUD_APP_PORT || '未指定'
  });
});

// 云函数示例
AV.Cloud.define('test', async (request) => {
  return { 
    success: true, 
    message: '云函数测试成功',
    timestamp: new Date().toISOString()
  };
});

// 重要：获取 LeanCloud 分配的端口
const PORT = parseInt(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000);

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 特来电智能系统启动成功`);
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`🔧 AppID: ${AV.applicationId}`);
  console.log(`💾 数据库: csfhcdz.f3322.net:1433`);
  console.log(`📅 启动时间: ${new Date().toISOString()}`);
});

// 处理服务器错误
server.on('error', (error) => {
  console.error('服务器错误:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用`);
  }
});

module.exports = app;