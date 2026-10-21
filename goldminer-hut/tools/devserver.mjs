/* 本地验证用开发服务器：静态托管 dist/，把 /api/* 接到**真正的 Worker**。
   用途：不用 wrangler 就能在浏览器里跑完整链路（注册 → 登录 → 同步），
   验的是真 Worker、真会话、真迁移、真 D1 适配器 —— 只有 D1 绑定是顶出来的。

   与线上不同的地方（交付说明里要写清）：
   - D1 绑定由 tools/fake-d1.mjs 用 node:sqlite 顶掉，所以真 D1 的行为本身验不到；
   - 跑在 http 上：Worker 按协议决定 cookie 带不带 Secure，浏览器在 http 下不存
     Secure cookie，因此本地登录靠响应体里的令牌（Origin 为 null 或缺失时才回）。

   调试路由：/__debug/store?table=ast、/__debug/reset、/__debug/schema。 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../functions/worker.mjs';
import { tableDef } from '../functions/schema.mjs';
import { fakeD1 } from './fake-d1.mjs';

const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const MIGRATION = fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url));
const STATE_DIR = fileURLToPath(new URL('../.wrangler/', import.meta.url));
const DB_FILE = process.env.DEV_DB || join(STATE_DIR, 'dev.sqlite');
const PORT = Number(process.env.PORT || 8788);

await mkdir(STATE_DIR, { recursive: true });
const db = fakeD1(DB_FILE);
// 迁移全是 IF NOT EXISTS，重复执行安全，所以每次启动都过一遍。
await db.exec(await readFile(MIGRATION, 'utf8'));

/* Worker 只在非 /api/ 路径上用 ASSETS；静态资源由本进程自己发，这里给个空壳。 */
const env = { DB: db, ASSETS: { fetch: () => new Response('not found', { status: 404 }) } };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

const tables = async () =>
  (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
    .results.map((r) => r.name).filter((n) => /^[a-z_]+$/.test(n));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) { if (typeof v === 'string') { headers.set(k, v); } }
    const method = req.method || 'GET';
    let body;
    if (method === 'POST') {
      const chunks = [];
      for await (const c of req) { chunks.push(c); }
      body = Buffer.concat(chunks);
    }
    const request = new Request('http://127.0.0.1:' + PORT + req.url, { method, headers, body });
    const response = await worker.fetch(request, env);
    const out = {};
    for (const [k, v] of response.headers) { if (k.toLowerCase() !== 'set-cookie') { out[k] = v; } }
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (cookies.length) { out['set-cookie'] = cookies; }
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  // 仅本地：让验证脚本能直接看假库里到底存了什么
  if (url.pathname === '/__debug/store') {
    const only = url.searchParams.get('table');
    const names = only ? [only] : await tables();
    const dump = {};
    for (const t of names) { dump[t] = (await db.prepare('SELECT * FROM "' + t + '"').all()).results; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(dump));
    return;
  }
  if (url.pathname === '/__debug/schema') {
    const keys = ['ast', 'meal', 'wk', 'acc', 'voc', 'amz', 'xhs', 'inv', 'pet', 'cab', 'ach', 'chk', 'rpt'];
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tables: Object.fromEntries(keys.map((t) => [t, tableDef(t)])) }));
    return;
  }
  if (url.pathname === '/__debug/reset') {
    for (const t of await tables()) { await db.prepare('DELETE FROM "' + t + '"').run(); }
    res.writeHead(200); res.end('cleared'); return;
  }

  let p = decodeURIComponent(url.pathname);
  if (p === '/') { p = '/index.html'; }
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(normalize(ROOT))) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const st = await stat(full);
    const target = st.isDirectory() ? join(full, 'index.html') : full;
    const buf = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + p + '\n（dist/ 是构建产物：先跑 node goldminer-hut/tools/build-dist.mjs）');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('dev server: http://127.0.0.1:' + PORT + '/  (static dist + /api/* → 真 Worker)');
  console.log('库: ' + DB_FILE);
  console.log('debug: /__debug/store?table=ast  /__debug/reset  /__debug/schema');

  if (process.env.OPEN_BROWSER) {
    const url = 'http://127.0.0.1:' + PORT + '/index.html';
    const opener = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      : process.platform === 'darwin'
        ? spawn('open', [url], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    opener.on('error', () => console.log('浏览器自动打开失败，请手动访问 ' + url));
    opener.unref();
  }
});
