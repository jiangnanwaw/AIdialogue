# Vercel 部署完整教程 - 从零开始

## 📋 目录

1. [准备阶段](#准备阶段)
2. [创建 GitHub 仓库](#创建-github-仓库)
3. [配置项目文件](#配置项目文件)
4. [上传到 GitHub](#上传到-github)
5. [在 Vercel 部署](#在-vercel-部署)
6. [配置环境变量](#配置环境变量)
7. [测试部署](#测试部署)

---

## 准备阶段

### 需要的账号

- [x] **GitHub 账号**：https://github.com（免费注册）
- [x] **Vercel 账号**：https://vercel.com（可用 GitHub 账号登录）

### 需要的工具

- [x] **Git**：https://git-scm.com/downloads
- [x] **Node.js**：https://nodejs.org（建议 v18+）

---

## 创建 GitHub 仓库

### 步骤 1：登录 GitHub

1. 打开 https://github.com
2. 点击右上角 **"+"** → **New repository**

### 步骤 2：创建新仓库

填写以下信息：

| 选项 | 填写内容 |
|------|----------|
| **Repository name** | `ai-chat-vercel`（或您喜欢的名称） |
| **Description** | AI智能助手 - DeepSeek + SQL Server |
| **Public/Private** | 选择 **Private**（私有） |
| **Initialize with README** | ❌ 不勾选 |

点击 **Create repository**

---

## 配置项目文件

### 步骤 1：确定需要上传的文件

在您的项目目录中，**只需要上传以下文件**：

```
ai-chat-vercel/
├── api/
│   └── chat.js              ✅ 上传（Vercel 云函数）
├── lib/
│   └── db.js                ✅ 上传（数据库配置）
├── public/
│   └── index-vercel.html    ✅ 上传（前端页面）
├── vercel.json              ✅ 上传（Vercel 配置）
├── package.json             ✅ 上传（依赖配置）
├── README.md                ✅ 上传（项目说明）
└── .gitignore               ✅ 上传（忽略文件）
```

### 步骤 2：更新 package.json

创建新的 `package.json`：

```json
{
  "name": "ai-chat-vercel",
  "version": "1.0.0",
  "description": "AI智能助手 - Vercel版本",
  "type": "module",
  "scripts": {
    "dev": "vercel dev",
    "deploy": "vercel",
    "deploy:prod": "vercel --prod"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "mssql": "^10.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### 步骤 3：创建 .gitignore 文件

创建 `.gitignore` 文件（忽略不需要上传的文件）：

```
node_modules/
.env
.leancloud/
*.log
.DS_Store
package-lock.json
```

### 步骤 4：创建 README.md

```markdown
# AI智能助手 - Vercel版本

集成 DeepSeek API 和 SQL Server 数据库查询的智能对话系统。

## 功能

- AI 对话
- 数据库查询
- Excel 导出

## 环境变量

- `DEEPSEEK_API_KEY`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SERVER`
- `DB_DATABASE`
```

---

## 上传到 GitHub

### 方法 1：使用 Git 命令行（推荐）

打开终端（PowerShell 或 CMD），进入项目目录：

```bash
# 1. 进入项目目录
cd C:\Users\Administrator\Desktop\Supabase

# 2. 初始化 Git 仓库
git init

# 3. 添加所有文件
git add .

# 4. 提交更改
git commit -m "Initial commit"

# 5. 关联远程仓库（替换 YOUR_USERNAME 为您的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/ai-chat-vercel.git

# 6. 推送到 GitHub
git branch -M main
git push -u origin main
```

### 方法 2：使用 GitHub 网页上传

如果不想使用命令行：

1. 在创建的仓库页面，点击 **uploading an existing file**
2. 拖拽以下文件到页面：
   - `api/` 文件夹
   - `lib/` 文件夹
   - `public/` 文件夹
   - `vercel.json`
   - `package.json`
   - `.gitignore`
3. 滚动到底部，输入提交信息：`Initial commit`
4. 点击 **Commit changes**

---

## 在 Vercel 部署

### 步骤 1：登录 Vercel

1. 打开 https://vercel.com
2. 点击 **Sign Up** 或 **Log In**
3. 选择 **Continue with GitHub**

### 步骤 2：导入项目

登录后：

1. 点击 **Add New** → **Project**
2. 您会看到 **Import Git Repository** 列表
3. 找到您刚才创建的 `ai-chat-vercel` 仓库
4. 点击右侧的 **Import** 按钮

### 步骤 3：配置项目

在 **Configure Project** 页面：

#### 项目信息

| 选项 | 填写内容 |
|------|----------|
| **Project Name** | `ai-chat-vercel`（自动生成） |
| **Framework Preset** | **Other** |
| **Root Directory** | `./`（根目录） |
| **Build Command** | 留空 |
| **Output Directory** | 留空 |

#### 重要配置

确保 **Environment Variables** 部分已配置（下一步详细说明）

点击 **Deploy** 按钮

---

## 配置环境变量

### 在 Vercel 中配置环境变量

#### 方式 1：部署前配置（推荐）

在 **Configure Project** 页面：

找到 **Environment Variables** 部分，点击 **Add New**，逐个添加：

| Name | Value | Environment |
|------|-------|-------------|
| `DEEPSEEK_API_KEY` | `sk-9a6e2beae112468dba3d212df48354f0` | All |
| `DB_USER` | `csfh` | All |
| `DB_PASSWORD` | `fh123456` | All |
| `DB_SERVER` | `csfhcdz.f3322.net` | All |
| `DB_DATABASE` | `chargingdata` | All |

#### 方式 2：部署后配置

如果项目已经部署：

1. 进入项目 Dashboard
2. 点击 **Settings** → **Environment Variables**
3. 点击 **Add New** 添加上述变量
4. 添加后点击 **Save**
5. 回到 **Deployments**，点击最新部署右侧的 **...** → **Redeploy**

---

## 测试部署

### 步骤 1：等待部署完成

部署通常需要 **1-2 分钟**，您会看到：

```
Building...
Deployment completed
```

### 步骤 2：获取部署地址

部署成功后，Vercel 会提供一个 URL：

```
https://ai-chat-vercel.vercel.app
```

### 步骤 3：测试 API

在浏览器中访问：

```
https://ai-chat-vercel.vercel.app
```

或使用 curl 测试 API：

```bash
curl -X POST https://ai-chat-vercel.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"今年特来电充电收入是多少？","sessionId":"test123"}'
```

---

## 本地开发测试

### 安装 Vercel CLI

```bash
npm install -g vercel
```

### 本地运行

```bash
# 登录
vercel login

# 本地开发
vercel dev

# 访问 http://localhost:3000
```

---

## 常见问题

### Q1: 部署失败，提示 "Module not found"

**解决方法**：检查 `package.json` 中的依赖是否正确

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "mssql": "^10.0.1"
  }
}
```

### Q2: API 返回 500 错误

**解决方法**：
1. 检查环境变量是否正确配置
2. 查看部署日志（Deployments → 点击部署 → Function Logs）

### Q3: 数据库连接失败

**解决方法**：
1. 确认 SQL Server 服务器地址可访问
2. 检查防火墙设置
3. 确认用户名和密码正确

### Q4: 如何更新代码

```bash
# 修改代码后
git add .
git commit -m "Update code"
git push

# Vercel 会自动重新部署
```

---

## 文件清单

### ✅ 必须上传的文件

| 文件 | 说明 |
|------|------|
| `api/chat.js` | Vercel 云函数 |
| `lib/db.js` | 数据库配置 |
| `public/index-vercel.html` | 前端页面 |
| `vercel.json` | Vercel 配置 |
| `package.json` | 依赖配置 |
| `.gitignore` | 忽略文件配置 |
| `README.md` | 项目说明 |

### ❌ 不需要上传的文件/文件夹

| 文件/文件夹 | 原因 |
|-------------|------|
| `node_modules/` | 依赖包，自动安装 |
| `cloud.js` | LeanCloud 云函数，不需要 |
| `.leancloud/` | LeanCloud 配置，不需要 |
| `.env` | 环境变量文件，包含敏感信息 |
| `server.js` | LeanCloud 入口文件，不需要 |
| `package-lock.json` | 锁定文件，可选 |

---

## 下一步

部署完成后，您可以：

1. ✅ 在 Vercel 项目设置中配置自定义域名
2. ✅ 在 GitHub 上修改代码，Vercel 会自动部署
3. ✅ 查看 Vercel Analytics 了解访问情况

---

## 支持

- [Vercel 文档](https://vercel.com/docs)
- [Vercel 部署指南](https://vercel.com/docs/deployments/overview)
- [Serverless Functions](https://vercel.com/docs/concepts/functions/serverless-functions)
