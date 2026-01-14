# Vercel 部署教程 - LeanCloud 替代方案

## 📋 概述

本教程将指导您将现有的 LeanCloud 项目迁移到 Vercel 平台。

**Vercel 优势：**
- ✅ 完全免费（个人项目）
- ✅ 部署极简（连接 GitHub 即可）
- ✅ 全球 CDN 加速
- ✅ 支持 Serverless Functions
- ✅ 自动 HTTPS
- ✅ 60秒执行时间（比 LeanCloud 的 15秒 更长）

---

## 🚀 快速开始

### 步骤 1：准备项目结构

确保您的项目目录结构如下：

```
your-project/
├── api/
│   └── chat.js          # Vercel Serverless Function
├── public/
│   └── index.html       # 前端页面
├── lib/
│   └── cloud-utils.js   # 共享工具函数
├── cloud.js             # 原始 LeanCloud 云函数（保留）
├── package.json
└── vercel.json          # Vercel 配置文件
```

### 步骤 2：安装 Vercel CLI

```bash
npm install -g vercel
```

### 步骤 3：更新 package.json

确保您的 `package.json` 包含以下依赖：

```json
{
  "name": "deepseek-ai-chat",
  "version": "1.0.0",
  "dependencies": {
    "axios": "^1.6.0",
    "mssql": "^10.0.1"
  }
}
```

### 步骤 4：配置环境变量

在 Vercel 项目设置中添加以下环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DEEPSEEK_API_KEY` | `sk-xxx` | DeepSeek API 密钥 |
| `DB_USER` | `csfh` | SQL Server 用户名 |
| `DB_PASSWORD` | `fh123456` | SQL Server 密码 |
| `DB_SERVER` | `csfhcdz.f3322.net` | SQL Server 地址 |
| `DB_DATABASE` | `chargingdata` | 数据库名称 |

### 步骤 5：修改前端代码

将前端 `index.html` 中的 LeanCloud API 调用替换为 Vercel API：

**原代码：**
```javascript
// LeanCloud 调用
result = await AV.Cloud.run('chatWithAI', {
    message: message,
    sessionId: sessionId
});
```

**新代码：**
```javascript
// Vercel API 调用
result = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId })
}).then(r => r.json());
```

---

## 📤 部署方法

### 方法 A：通过 Vercel CLI 部署（推荐）

1. **登录 Vercel：**
```bash
vercel login
```

2. **部署项目：**
```bash
vercel
```

3. **按提示操作：**
   - 是否链接到现有项目？ → **N**（新建）
   - 项目名称？ → 输入名称
   - 目录？ → **./**
   - 是否覆盖设置？ → **N**

4. **部署到生产环境：**
```bash
vercel --prod
```

### 方法 B：通过 GitHub 部署（最简单）

1. **将代码推送到 GitHub**

2. **访问 [vercel.com](https://vercel.com)**

3. **点击 "Import Project"**

4. **选择您的 GitHub 仓库**

5. **配置环境变量：**
   - 在项目设置 → Environment Variables 中添加上述变量

6. **点击 "Deploy"**

---

## 🔧 配置文件说明

### vercel.json

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ]
}
```

---

## 📝 API 端点说明

### 聊天接口

**URL：** `/api/chat`

**方法：** `POST`

**请求体：**
```json
{
  "message": "今年特来电的平均充电服务费是多少？",
  "sessionId": "session_123456"
}
```

**响应：**
```json
{
  "reply": "查询结果：...",
  "processingTime": 1234,
  "method": "DeepSeek AI",
  "rawData": [...],
  "hasData": true
}
```

---

## 🛠️ 故障排查

### 问题 1：部署后 API 返回 404

**原因：** 路由配置问题

**解决：** 确保 `vercel.json` 中的 `routes` 配置正确

### 问题 2：数据库连接失败

**原因：** 环境变量未设置

**解决：** 在 Vercel Dashboard → Settings → Environment Variables 中配置

### 问题 3：超时错误

**原因：** Vercel 免费版超时时间为 60 秒

**解决：** 优化查询或升级到 Pro 版本（无限制）

---

## 📊 免费额度对比

| 功能 | Vercel 免费版 | LeanCloud 免费版 |
|------|---------------|------------------|
| 流量 | 100GB/月 | 不详 |
| 请求次数 | 无限制 | 限流 |
| 执行时间 | 60秒 | 15秒 |
| 数据库 | 需外部连接 | 内置 |
| 价格 | 免费 | 付费后更多功能 |

---

## 🎯 下一步

1. ✅ 完成项目配置
2. ✅ 测试本地开发环境：`vercel dev`
3. ✅ 部署到 Vercel
4. ✅ 配置自定义域名（可选）

---

## 📞 支持

如有问题，请访问：
- [Vercel 文档](https://vercel.com/docs)
- [Serverless Functions 文档](https://vercel.com/docs/concepts/functions/serverless-functions)
