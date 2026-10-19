/* 自建参考后端：把同一份 handler.mjs 挂在普通 Node HTTP 服务上。
   它存在的意义是证明“后端可插拔”——换掉的是宿主注入的两样东西：
     db      → SQLite 适配器（而不是平台的 Supabase 适配器）
     getUser → bearer 令牌解析（而不是网关注入的 x-qoder-user-context）
   路由、13 表契约、分页、幂等 upsert、409 语义全部沿用 handler，不重复实现。

   环境变量：
     AUTH_TOKEN   必填，缺失直接拒绝启动（不给公网留一个裸奔的默认值）
     AUTH_OWNER   可选，缺省取 AUTH_TOKEN 的 sha256 前 16 位作为归属 id
     DB_FILE      可选，默认 ./goldminer.sqlite
     HOST / PORT  可选，默认 127.0.0.1:8790
     ALLOW_ORIGIN 可选，逗号分隔的跨源白名单；留空则不发跨源头（只服务同源）
*/

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDb } from './sqlite-db.mjs';
import { handleApp } from '../functions/handler.mjs';
import { UserContextError } from '../functions/auth.mjs';

const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
if (!AUTH_TOKEN) {
  console.error('缺少 AUTH_TOKEN：拒绝以无鉴权方式启动。');
  process.exit(1);
}
const OWNER = process.env.AUTH_OWNER
  || createHash('sha256').update(AUTH_TOKEN).digest('hex').slice(0, 16);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8790);
const ALLOW_ORIGIN = (process.env.ALLOW_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY_BYTES = 1024 * 1024;   // 与 handler 的上限一致，超限在 HTTP 层就断掉

const DB_FILE = resolve(process.cwd(), process.env.DB_FILE || 'goldminer.sqlite');
mkdirSync(dirname(DB_FILE), { recursive: true });
const db = openDb(DB_FILE);

const tokenOk = (header) => {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const got = Buffer.from(header.slice(7));
  const want = Buffer.from(AUTH_TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};

// 身份只从本服务自己的令牌来。平台那套 x-qoder-user-context / x-instance-id
// 在公网上一律当陌生输入丢弃——否则任何人都能伪造 owner 把别人的档覆盖掉。
const getUser = (request) => {
  if (tokenOk(request.headers.get('authorization'))) return { user_id: OWNER };
  throw new UserContextError('invalid_token', 401);
};

function readBody(req, res, cors) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      if (size > MAX_BODY_BYTES) return;   // 已经回过 413 了，剩下的字节读完丢掉，别掐连接
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        send(res, 413, { error: 'payload_too_large' }, cors);
        rejectBody(Object.assign(new Error('body_too_large'), { httpSent: true }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const cors = {};
  if (ALLOW_ORIGIN.length && ALLOW_ORIGIN.includes(req.headers.origin)) {
    cors['access-control-allow-origin'] = req.headers.origin;
    cors['access-control-allow-headers'] = 'content-type, authorization';
    cors['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    cors['access-control-max-age'] = '600';
    cors['vary'] = 'Origin';
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (url.pathname !== '/app') { send(res, 404, { error: 'not_found' }, cors); return; }

  try {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      send(res, 413, { error: 'payload_too_large' }, cors);
      req.resume();
      return;
    }
    const headers = new Headers(req.headers);
    for (const h of ['x-qoder-user-context', 'x-instance-id', 'x-qsites-origin', 'cookie']) headers.delete(h);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req, res, cors);
    // 请求体已经整体读进内存，这里构造的是 fully-buffered 的 Web Request，
    // handler 里的 request.clone() 因此可以正常再读一次。
    const request = new Request(url.href, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
    });
    const response = await handleApp({ request, db, getUser });
    const text = await response.text();
    const out = Object.assign({}, cors, Object.fromEntries(response.headers));
    send(res, response.status, text, out);
  } catch (e) {
    if (e && e.httpSent) return;   // 413 已经发出去了
    // 不把 SQLite 原始报错、文件路径或令牌写进日志与响应。
    send(res, 503, { error: 'database_request_failed' }, cors);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`app 后端已启动：http://${HOST}:${PORT}/app （库文件 ${DB_FILE}，归属 id ${OWNER}）`);
});

const shutdown = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
