// 简单的测试 API
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 返回环境变量测试
  return res.status(200).json({
    message: 'API 工作正常！',
    env: {
      hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
      hasDbUser: !!process.env.DB_USER,
      hasDbPassword: !!process.env.DB_PASSWORD,
      hasDbServer: !!process.env.DB_SERVER,
      hasDbDatabase: !!process.env.DB_DATABASE,
      dbUser: process.env.DB_USER || '未设置',
      dbServer: process.env.DB_SERVER || '未设置'
    }
  });
}
