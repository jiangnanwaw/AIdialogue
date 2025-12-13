# AI智能助手 - DeepSeek集成

这是一个集成DeepSeek API和SQL Server数据库查询的智能AI对话网页应用。

## 功能特点

- 全屏对话界面设计
- 支持通用AI问答（通过DeepSeek）
- 支持智能数据库查询
- 自动识别问题类型并路由到相应处理逻辑
- 支持多表联合查询（特来电、能科等16个表）

## 项目结构

```
.
├── index.html          # 前端页面
├── app.js             # 前端JavaScript逻辑
├── cloud.js           # LeanCloud云函数
├── server.js          # 服务器入口文件
├── package.json       # 依赖配置
└── .leancloud/        # LeanCloud配置目录
    └── config.json
```

## 部署到LeanCloud

### 前提条件

1. 已在LeanCloud创建应用
2. 已安装Node.js环境
3. 已安装LeanCloud CLI工具

### 部署步骤

1. 安装依赖：
```bash
npm install
```

2. 登录LeanCloud CLI：
```bash
lean login


3. 关联应用：
```bash
lean switch


4. 部署到LeanCloud：
```bash
lean deploy
```

### 本地测试

```bash
lean up
```

访问：http://localhost:3000

## 数据库配置

- 服务器：
- 数据库：
- 用户名：
- 密码：

## API配置

- DeepSeek API Key: 
- LeanCloud REST API: 

## 使用说明

### 数据库查询示例

- "今年特来电的平均充电服务费是多少？"
- "2020年8月兴元收入多少？"
- "今天充电的总电量是多少？"
- "去年和今年的充电费用对比"

### 通用问答示例

- "什么是人工智能？"
- "如何学习编程？"
- 任何不涉及数据库查询的问题

## 注意事项

1. 所有查询结果会自动过滤空值和0值
2. 涉及平均值计算时，会在有数据的时间范围内计算
3. 能科表的充电时长字段会自动转换格式
4. 如果问题包含"充电"但未指定表名，会自动查询特来电和能科两个表

## 技术栈

- 前端：HTML5, CSS3, JavaScript
- 后端：Node.js, LeanCloud云引擎
- 数据库：SQL Server 2008 R2
- AI：DeepSeek API
- 部署：LeanCloud

## 许可证

Private
