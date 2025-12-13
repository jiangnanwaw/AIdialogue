# LeanCloud 部署指南

## 安装 LeanCloud CLI

首先需要安装 LeanCloud 命令行工具：

```bash
npm install -g leancloud-cli
```

## 部署步骤

### 1. 安装项目依赖

在项目目录下运行：

```bash
cd C:\Users\Administrator\Desktop\999
npm install
```

### 2. 登录 LeanCloud

```bash
lean login
```

输入账号信息：
- 邮箱：471010996@qq.com
- 密码：Tf751115@
- 选择区域：中国大陆

### 3. 初始化项目（如果需要）

如果项目未初始化，运行：

```bash
lean init
```

选择：
- 应用：deepseek (8luz5IULzHMzsGz2hG2a4scI)
- 分组：AI（如果有的话）

### 4. 切换到正确的应用

```bash
lean switch
```

选择应用：deepseek (8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz)

### 5. 本地测试（可选）

在部署前可以先本地测试：

```bash
lean up
```

然后在浏览器访问：http://localhost:3000

测试完成后按 Ctrl+C 停止。

### 6. 部署到 LeanCloud

部署到生产环境：

```bash
lean deploy
```

或部署到预备环境：

```bash
lean deploy --staging
```

### 7. 查看日志

部署后查看应用日志：

```bash
lean logs
```

实时查看日志：

```bash
lean logs -f
```

## 访问应用

部署成功后，可以通过以下地址访问：

- 生产环境：https://你的应用域名.leanapp.cn
- 预备环境：https://stg-你的应用域名.leanapp.cn

你也可以在 LeanCloud 控制台绑定自定义域名。

## 环境变量配置

如果需要配置额外的环境变量，可以在 LeanCloud 控制台的"云引擎 > 设置 > 环境变量"中添加。

当前已配置的变量：
- LEANCLOUD_APP_ID
- LEANCLOUD_APP_KEY
- LEANCLOUD_APP_MASTER_KEY
- LEANCLOUD_APP_SERVER_URL

## 常见问题

### 1. 部署失败

检查：
- package.json 中的依赖是否正确
- server.js 和 cloud.js 是否有语法错误
- LeanCloud CLI 是否已登录

### 2. 数据库连接失败

检查：
- 数据库服务器是否可访问（csfhcdz.f3322.net:1433）
- 防火墙规则是否正确
- 路由器端口映射是否正常

### 3. DeepSeek API 调用失败

检查：
- API Key 是否正确
- 网络是否能访问 DeepSeek API
- API 配额是否充足

## 更新应用

修改代码后重新部署：

```bash
lean deploy
```

LeanCloud 会自动重启应用实例。

## 查看应用状态

```bash
lean info
```

## 回滚版本

如果新版本有问题，可以回滚到之前的版本：

1. 登录 LeanCloud 控制台
2. 进入"云引擎 > 部署 > 版本管理"
3. 选择要回滚的版本并点击"部署"

## 技术支持

- LeanCloud 文档：https://leancloud.cn/docs/
- LeanCloud CLI 文档：https://leancloud.cn/docs/leanengine_cli.html
