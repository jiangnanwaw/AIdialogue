// 初始化 LeanCloud
AV.init({
    appId: '8luz5IULzHMzsGz2hG2a4scI-gzGzoHsz',
    appKey: 'CMGwM4hzM3C2TXTfIYQVS6TM',
    serverURL: 'https://8luz5iul.lc-cn-n1-shared.com'
});

const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

// 添加消息到界面
function addMessage(content, isUser = false, metadata = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(contentDiv);

    // 如果有元数据，显示额外信息
    if (metadata && metadata.processingTime) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-metadata';
        metaDiv.style.fontSize = '11px';
        metaDiv.style.color = '#999';
        metaDiv.style.marginTop = '5px';
        metaDiv.textContent = `处理时间: ${metadata.processingTime}ms`;

        if (metadata.sqlQuery) {
            metaDiv.textContent += ` | SQL已生成`;
            metaDiv.title = metadata.sqlQuery;
        }

        contentDiv.appendChild(metaDiv);
    }

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 显示加载动画
function showLoading() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'loading-message';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content loading-container';
    contentDiv.innerHTML = '<span class="loading"></span><span class="loading"></span><span class="loading"></span>';

    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 移除加载动画
function removeLoading() {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.remove();
    }
}

// 发送消息
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // 禁用输入和按钮
    messageInput.disabled = true;
    sendButton.disabled = true;

    // 显示用户消息
    addMessage(message, true);
    messageInput.value = '';

    // 显示加载动画
    showLoading();

    try {
        console.log('发送消息:', message);

        // 调用云函数
        const result = await AV.Cloud.run('chatWithAI', { message: message });

        console.log('收到响应:', result);

        // 移除加载动画
        removeLoading();

        // 显示AI回复
        const metadata = {
            processingTime: result.processingTime,
            sqlQuery: result.sqlQuery
        };

        addMessage(result.reply, false, metadata);

    } catch (error) {
        console.error('发送消息时出错:', error);
        console.error('错误详情:', {
            name: error.name,
            message: error.message,
            code: error.code,
            rawMessage: error.rawMessage
        });

        removeLoading();

        let errorMsg = '抱歉，处理您的请求时出现错误。\n';

        if (error.code === 141) {
            errorMsg += '云函数执行错误，请查看服务器日志。';
        } else if (error.code === 1) {
            errorMsg += '网络连接失败，请检查网络。';
        } else {
            errorMsg += `错误信息: ${error.message || '未知错误'}`;
        }

        addMessage(errorMsg);
    } finally {
        // 恢复输入和按钮
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// 测试DeepSeek API连接
async function testDeepSeekAPI() {
    console.log('测试DeepSeek API连接...');
    try {
        const result = await AV.Cloud.run('testDeepSeekAPI', {});
        console.log('DeepSeek API测试结果:', result);

        if (result.success) {
            addMessage(`✅ DeepSeek API连接正常\n可用模型: ${result.models.data ? result.models.data.length : 0}个`);
        } else {
            addMessage(`❌ DeepSeek API连接失败\n错误: ${result.error}\n状态码: ${result.status}`);
        }
    } catch (error) {
        console.error('测试DeepSeek API时出错:', error);
        addMessage(`❌ 测试失败: ${error.message}`);
    }
}

// 测试数据库连接
async function testDatabaseConnection() {
    console.log('测试数据库连接...');
    try {
        const result = await AV.Cloud.run('testDatabaseConnection', {});
        console.log('数据库测试结果:', result);

        if (result.success) {
            addMessage(`✅ 数据库连接正常\n版本: ${result.version.substring(0, 50)}...`);
        } else {
            addMessage(`❌ 数据库连接失败\n错误: ${result.error}`);
        }
    } catch (error) {
        console.error('测试数据库时出错:', error);
        addMessage(`❌ 测试失败: ${error.message}`);
    }
}

// 查询数据库中的所有表名
async function listDatabaseTables() {
    console.log('查询数据库表名...');
    try {
        const result = await AV.Cloud.run('listDatabaseTables', {});
        console.log('数据库表名结果:', result);

        if (result.success) {
            const tableList = result.tables.join('\n• ');
            addMessage(`✅ ${result.message}\n\n表名列表：\n• ${tableList}`);
        } else {
            addMessage(`❌ 查询表名失败\n错误: ${result.error}`);
        }
    } catch (error) {
        console.error('查询表名时出错:', error);
        addMessage(`❌ 查询失败: ${error.message}`);
    }
}

// 发送按钮点击事件
sendButton.addEventListener('click', sendMessage);

// 回车发送
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// 监听特殊命令
messageInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();

    // 如果输入 /test-api 则测试DeepSeek API
    if (value === '/test-api') {
        e.target.value = '';
        testDeepSeekAPI();
    }

    // 如果输入 /test-db 则测试数据库
    if (value === '/test-db') {
        e.target.value = '';
        testDatabaseConnection();
    }

    // 如果输入 /list-tables 则查询所有表名
    if (value === '/list-tables') {
        e.target.value = '';
        listDatabaseTables();
    }

    // 如果输入 /help 显示帮助
    if (value === '/help') {
        e.target.value = '';
        addMessage(`可用命令：
/test-api - 测试DeepSeek API连接
/test-db - 测试数据库连接
/list-tables - 查询数据库所有表名
/help - 显示此帮助信息

数据库查询示例：
• 今年特来电的平均充电服务费是多少？
• 2020年8月兴元收入多少？
• 今天充电的总电量是多少？

通用问答示例：
• 什么是人工智能？
• 如何学习编程？`);
    }
});

// 页面加载完成后的初始化
window.addEventListener('load', () => {
    messageInput.focus();

    // 显示欢迎消息
    setTimeout(() => {
        addMessage(`👋 欢迎使用AI智能助手！

我可以帮您：
1. 查询数据库信息（包含16个数据表）
2. 回答通用问题

💡 提示：
• 输入 /help 查看帮助
• 输入 /test-api 测试API连接
• 输入 /test-db 测试数据库连接

现在就开始提问吧！`);
    }, 500);
});
