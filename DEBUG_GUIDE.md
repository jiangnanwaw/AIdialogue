# 调试和测试指南

## 更新说明

已更新代码，包含以下改进：

### 1. 详细的调试日志
- 所有API调用都有详细的请求和响应日志
- 数据库操作有完整的连接和查询日志
- 错误信息包含完整的堆栈跟踪

### 2. 错误处理改进
- 捕获所有可能的错误类型
- 针对402错误的特殊处理
- 友好的错误提示信息

### 3. 新增测试云函数
- `testDeepSeekAPI`: 测试DeepSeek API连接
- `testDatabaseConnection`: 测试数据库连接

### 4. 前端改进
- 显示处理时间
- 显示SQL查询（调试模式）
- 内置测试命令

## 部署和测试步骤

### 1. 重新部署到LeanCloud

```bash
cd C:\Users\Administrator\Desktop\999
lean deploy
```

### 2. 查看实时日志

部署后立即查看日志：

```bash
lean logs -f
```

### 3. 使用内置测试命令

访问部署后的网页，在输入框中输入：

#### 测试DeepSeek API
```
/test-api
```
这将调用 `https://api.deepseek.com/v1/models` 端点测试连接。

#### 测试数据库连接
```
/test-db
```
这将连接SQL Server并查询版本信息。

#### 查看帮助
```
/help
```
显示所有可用命令和示例。

### 4. 测试通用问答

发送一个简单的问题：
```
你好
```

查看日志中的详细信息：
- API请求数据
- API响应数据
- 响应状态码
- 处理时间

### 5. 测试数据库查询

发送一个数据库查询问题：
```
充电
```

查看日志中的：
- 问题类型判断
- 提取的表名
- 生成的SQL查询
- 数据库连接状态
- 查询结果

## 常见问题排查

### 问题1: 402 Payment Required错误

**症状**: DeepSeek API返回402状态码

**可能原因**:
1. API Key余额不足
2. API Key配额已用完
3. API Key已过期

**排查步骤**:

1. 在本地测试API Key：
```bash
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer sk-9a6e2beae112468dba3d212df48354f0"
```

2. 检查响应：
   - 200: API Key正常
   - 401: API Key无效
   - 402: 余额不足
   - 429: 请求过多

3. 如果本地测试正常但云端失败：
   - 检查LeanCloud服务器是否能访问DeepSeek API
   - 检查是否有防火墙或网络限制
   - 尝试在云函数中添加代理设置

**解决方案**:

如果是余额问题：
1. 登录DeepSeek平台充值
2. 或使用新的API Key

如果是网络问题：
```javascript
// 在cloud.js中添加axios配置
const response = await axios.post(
    DEEPSEEK_API_URL,
    requestData,
    {
        headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000,
        // 如果需要代理
        proxy: {
            host: 'your-proxy-host',
            port: your-proxy-port
        }
    }
);
```

### 问题2: 数据库连接失败

**症状**: 无法连接到SQL Server

**排查步骤**:

1. 在云端测试连接：
   - 访问网页
   - 输入 `/test-db`
   - 查看错误信息

2. 检查网络：
   - LeanCloud服务器能否访问 csfhcdz.f3322.net
   - 端口1433是否开放
   - 防火墙规则是否正确

3. 检查DDNS：
   - 域名是否解析正常
   - IP地址是否正确

**解决方案**:

1. 测试域名解析：
```bash
nslookup csfhcdz.f3322.net
```

2. 测试端口连通性：
```bash
telnet csfhcdz.f3322.net 1433
```

3. 如果DDNS不稳定，考虑：
   - 使用固定公网IP
   - 使用VPN连接
   - 将数据库迁移到云端

### 问题3: API请求格式错误

**症状**: API返回400或其他错误

**排查**:

查看日志中的详细请求数据：
```
[DEBUG] DeepSeek API 请求数据
{
  "model": "deepseek-chat",
  "messages": [...],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

对比DeepSeek官方文档检查格式是否正确。

## 日志分析

### 成功的请求日志示例

```
[DEBUG] 收到新请求 { message: "你好", timestamp: "2025-12-13T..." }
[DEBUG] 问题类型判断 { isDbQuery: false, message: "你好" }
[DEBUG] 进入通用问答流程
[DEBUG] 开始调用DeepSeek API回答通用问题
[DEBUG] 问题内容 "你好"
[DEBUG] DeepSeek API 请求数据 { model: "deepseek-chat", ... }
[DEBUG] API URL https://api.deepseek.com/v1/chat/completions
[DEBUG] API Key (前8位) sk-9a6e2...
[DEBUG] DeepSeek API 响应状态 200
[DEBUG] DeepSeek API 响应数据 { choices: [...], ... }
[DEBUG] AI回答 "你好！有什么可以帮助你的吗？"
[DEBUG] 请求处理完成 { processingTime: "1234ms" }
```

### 失败的请求日志示例

```
[DEBUG] 收到新请求 { message: "你好", timestamp: "2025-12-13T..." }
[DEBUG] 开始调用DeepSeek API回答通用问题
[DEBUG] DeepSeek API 请求数据 { ... }
DeepSeek API 返回非200状态码: 402
响应数据: { error: { message: "Insufficient balance", ... } }
DeepSeek API调用失败 - 详细错误信息:
错误类型: Error
错误消息: DeepSeek API 错误: 402 - {...}
响应状态: 402
响应数据: { error: { ... } }
```

## 性能监控

在浏览器控制台可以看到：
- 每次请求的处理时间
- API调用耗时
- 数据库查询耗时

前端会显示处理时间，例如：
```
处理时间: 1234ms | SQL已生成
```

## 开关调试模式

在 `cloud.js` 第6行：

```javascript
const DEBUG_MODE = true;  // 开启调试
const DEBUG_MODE = false; // 关闭调试（生产环境）
```

调试模式会：
- 输出详细日志
- 返回SQL查询语句
- 返回更详细的错误信息

## 联系支持

如果问题仍未解决：

1. 收集以下信息：
   - LeanCloud日志（`lean logs`）
   - 浏览器控制台错误
   - 具体的错误信息
   - 重现步骤

2. 检查：
   - DeepSeek API状态页
   - LeanCloud服务状态
   - 网络连接状态

3. 测试最小化案例：
   - 只测试API连接
   - 只测试数据库连接
   - 分离问题根源
