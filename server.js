/**
 * 本地开发服务器：不用 vercel dev 也能跑
 *   npm install
 *   npm run dev  → http://localhost:3000
 * 生产环境走 Vercel 的 /api/* Serverless Function，入口仍是 api/name.js
 */
require('dotenv').config({ quiet: true });

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const nameHandler = require('./api/name.js');
const historyHandler = require('./api/history.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

function enhance(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(res, relativePath) {
  const absPath = path.resolve(ROOT, '.' + relativePath);
  if (!absPath.startsWith(ROOT)) {
    res.status(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
    res.status(404).end('Not Found');
    return;
  }
  const ext = path.extname(absPath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
  };
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  fs.createReadStream(absPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  enhance(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/name') {
      req.query = Object.fromEntries(url.searchParams.entries());
      const raw = await readBody(req);
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        req.body = {};
      }
      await nameHandler(req, res);
      return;
    }

    if (pathname === '/api/history') {
      req.query = Object.fromEntries(url.searchParams.entries());
      await historyHandler(req, res);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveStatic(res, '/index.html');
      return;
    }

    serveStatic(res, pathname);
  } catch (err) {
    console.error('[server] 未捕获异常：', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`AI 起名平台已启动：http://localhost:${PORT}`);
  const keys = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    DOUBAO_API_KEY: Boolean(process.env.DOUBAO_API_KEY),
    DEEPSEEK_API_KEY: Boolean(process.env.DEEPSEEK_API_KEY),
    QWEN_API_KEY: Boolean(process.env.QWEN_API_KEY),
    KIMI_API_KEY: Boolean(process.env.KIMI_API_KEY),
  };
  console.log('环境变量检测：', Object.entries(keys).map(([k, v]) => `${k}=${v ? '已配置' : '缺失'}`).join('  '));
});
