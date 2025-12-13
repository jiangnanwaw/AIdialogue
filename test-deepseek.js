const axios = require('axios');

const DEEPSEEK_API_KEY = 'sk-9a6e2beae112468dba3d212df48354f0';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

(async () => {
    try {
        console.log('测试 DeepSeek API...');
        const startTime = Date.now();

        const response = await axios.post(
            DEEPSEEK_API_URL,
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: '你是一个友好的AI助手。' },
                    { role: 'user', content: '你好，请简单介绍一下你自己（50字以内）' }
                ],
                temperature: 0.7,
                max_tokens: 200
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const endTime = Date.now();
        console.log(`响应时间: ${endTime - startTime}ms`);
        console.log('状态码:', response.status);
        console.log('回答:', response.data.choices[0].message.content);

    } catch (error) {
        console.error('错误:', error.message);
        if (error.response) {
            console.error('状态码:', error.response.status);
            console.error('错误数据:', JSON.stringify(error.response.data));
        }
    }
})();
