# 快速开始指南

## 项目已创建完成

您的AI智能助手项目已经创建完成，包含以下文件：

```
999/
├── public/                 # 前端文件目录
│   ├── index.html         # 主页面
│   └── app.js             # 前端JavaScript
├── .leancloud/            # LeanCloud配置
│   └── config.json
├── cloud.js               # 云函数（核心业务逻辑）
├── server.js              # 服务器入口
├── package.json           # 依赖配置
├── .env                   # 环境变量
├── .gitignore            # Git忽略文件
├── README.md             # 项目说明
└── DEPLOYMENT.md         # 部署指南

```

## 核心功能

✅ 全屏对话界面设计
✅ DeepSeek AI 智能对话
✅ SQL Server 数据库智能查询
✅ 自动识别问题类型（数据库查询 vs 通用问答）
✅ 支持16个数据表的智能查询
✅ 特来电和能科表数据合并查询
✅ 时间范围自动识别

## 下一步操作

### 方式一：部署到 LeanCloud（推荐）

1. **安装 LeanCloud CLI**
   ```bash
   npm install -g leancloud-cli
   ```

2. **安装项目依赖**
   ```bash
   cd C:\Users\Administrator\Desktop\999
   npm install
   ```

3. **登录 LeanCloud**
   ```bash
   lean login
   ```
   - 邮箱：471010996@qq.com
   - 密码：Tf751115@

4. **部署到云端**
   ```bash
   lean deploy
   ```

5. **访问应用**
   部署成功后会显示访问地址

详细部署步骤请查看：[DEPLOYMENT.md](DEPLOYMENT.md)

### 方式二：本地测试

1. **安装依赖**
   ```bash
   npm install
   ```

2. **启动本地服务**
   ```bash
   npm start
   ```
   或
   ```bash
   lean up
   ```

3. **访问应用**
   打开浏览器访问：http://localhost:3000

## 使用示例

### 数据库查询示例

- "今年特来电的平均充电服务费是多少？"
- "2020年8月兴元收入多少？"
- "今天充电的总电量是多少？"
- "去年和今年的充电费用对比怎么样？"

### 通用问答示例

- "什么是人工智能？"
- "如何学习Python编程？"
- 任何不涉及数据库的问题

## 配置信息

### LeanCloud 配置
- AppID: 8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz
- AppKey: CMGwM4hzM3C2TXTfIYQVS6TM
- REST API: https://8luz5iul.lc-cn-n1-shared.com

### 数据库配置
- 服务器: csfhcdz.f3322.net:1433
- 数据库: chargingdata
- 用户: csfh

### DeepSeek API
- API Key: sk-9a6e2beae112468dba3d212df48354f0

## 支持的数据表

1. 特来电
2. 能科
3. 车海洋洗车充值
4. 车海洋洗车消费
5. 车颜知己洗车
6. 电力局
7. 红门缴费
8. 快易洁洗车
9. 赛菲姆道闸
10. 收钱吧
11. 兴元售后机
12. 微信商户下单
13. 微信收款商业版
14. 月租车充值
15. 智小盟
16. 超时占位费

## 特殊处理逻辑

- 问题包含"充电"但未指定表名 → 自动查询特来电+能科
- 问题包含具体表名 → 只查询对应表
- 没有时间限制 → 查询所有数据
- 有时间限制 → 自动匹配时间字段
- 能科表充电时长 → 自动从 hh:mm:ss 转换为分钟
- 所有查询 → 自动过滤空值和0值

## 故障排查

如遇到问题，请检查：

1. **数据库无法连接**
   - 确认路由器端口1433映射正常
   - 确认动态DNS解析正常
   - 尝试ping csfhcdz.f3322.net

2. **DeepSeek API 报错**
   - 检查API Key是否正确
   - 检查API配额是否充足
   - 检查网络连接

3. **部署失败**
   - 检查 LeanCloud CLI 是否已登录
   - 检查 package.json 依赖
   - 查看错误日志：`lean logs`

## 获取帮助

- LeanCloud文档: https://leancloud.cn/docs/
- DeepSeek API: https://platform.deepseek.com/
- 查看完整README: [README.md](README.md)
- 查看部署指南: [DEPLOYMENT.md](DEPLOYMENT.md)

---

**开始使用吧！如有问题，请参考上述文档或联系技术支持。**
