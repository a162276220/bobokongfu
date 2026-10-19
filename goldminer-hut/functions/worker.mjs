/* 云端 Worker：同一个 Worker 既发站点静态资源（env.ASSETS），又提供 /api/*。
   wrangler.jsonc 里 assets.run_worker_first = ["/api/*"] 保证 /api/* 一定先到这里。

   身份：站点用 HttpOnly cookie；file:// 本地模式用 Authorization: Bearer
   （file:// 页面的第三方 cookie 不可靠）。两种凭据都由 session.mjs 解析。
   数据面仍是那份没改过的 handler.mjs —— 这里只把「身份从哪来」换成会话。 */

import { handleApp } from './handler.mjs';
import { UserContextError } from './auth.mjs';
import { openDb } from '../backend/d1-db.mjs';
import {
  AuthError, SESSION_TTL_SECONDS, getUserFromRequest, login, logout,
  registerUser, sessionCookie, tokenFromRequest,
} from './session.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/* 站点模式凭据只走 HttpOnly cookie：响应体里再回一份 30 天的令牌，
   等于把它放进 XSS 够得着的地方，HttpOnly 就白设了。
   file:// 直开没有可靠的 cookie 可用（第三方 cookie 不可靠），只有它需要 body 里的令牌。 */
function needsBodyToken(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === 'null';
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

/* CORS：file:// 页面的 Origin 是字符串 "null"，而任何本地页面都能伪造成它，
   所以放行 null 不是保护——真正的保护是 Bearer 里的会话令牌。
   这里回显来源而不是写 *，将来若要带凭据也不用改。 */
function corsHeaders(request) {
  return {
    'access-control-allow-origin': request.headers.get('origin') || '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('invalid');
    return body;
  } catch {
    throw new AuthError('invalid_request', 400);
  }
}

/* 数据面：先把凭据换成身份，再包成 handler 要的同步 getUser。
   owner 只可能来自这里，请求体里带什么都不看。 */
async function handleDataPlane(db, request) {
  const user = await getUserFromRequest(db, request);
  const getUser = () => {
    if (!user) throw new UserContextError('login_required', 401);
    return { user_id: user.user_id };
  };
  return handleApp({ request, db: openDb(db), getUser });
}

async function handleRegister(db, request, secure) {
  const body = await readJson(request);
  const { userId } = await registerUser(db, body);
  // 注册即登录：省一次往返，也避免「注册成功却没登上」这种半截状态。
  const session = await login(db, {
    username: body.username,
    password: body.password,
    ua: request.headers.get('user-agent'),
  });
  return json(
    { userId, token: needsBodyToken(request) ? session.token : undefined, expiresAt: session.expiresAt },
    201,
    { 'set-cookie': sessionCookie(session.token, SESSION_TTL_SECONDS, { secure }) },
  );
}

async function handleLogin(db, request, secure) {
  const body = await readJson(request);
  const session = await login(db, {
    username: body.username,
    password: body.password,
    ua: request.headers.get('user-agent'),
  });
  return json(
    { userId: session.userId, token: needsBodyToken(request) ? session.token : undefined, expiresAt: session.expiresAt },
    200,
    { 'set-cookie': sessionCookie(session.token, SESSION_TTL_SECONDS, { secure }) },
  );
}

async function handleLogout(db, request, secure) {
  await logout(db, tokenFromRequest(request));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, { secure }) });
}

async function handleMe(db, request) {
  const user = await getUserFromRequest(db, request);
  if (!user) { return json({ error: 'login_required' }, 401); }
  const row = await db.prepare('SELECT username, nickname FROM users WHERE id = ?').bind(user.user_id).first();
  return json({ user_id: user.user_id, username: row ? row.username : null, nickname: row ? row.nickname : null });
}


async function route(pathname, { env, request, secure }) {
  if (pathname === '/api/app') return handleDataPlane(env.DB, request);
  if (pathname === '/api/health') return json({ ok: true });
  if (pathname === '/api/auth/me') return handleMe(env.DB, request);
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
  if (pathname === '/api/auth/register') return handleRegister(env.DB, request, secure);
  if (pathname === '/api/auth/login') return handleLogin(env.DB, request, secure);
  if (pathname === '/api/auth/logout') return handleLogout(env.DB, request, secure);
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      // 本地 wrangler dev 走 http，带 Secure 的 cookie 浏览器不会存，所以只在 https 上加。
      const secure = url.protocol === 'https:';
      try {
        return withCors(await route(url.pathname, { env, request, secure }), cors);
      } catch (e) {
        if (e instanceof AuthError) return withCors(json({ error: e.code }, e.status), cors);
        if (e instanceof UserContextError) return withCors(json({ error: e.code }, e.status || 401), cors);
        // 不回显 provider 原始错误，也不把凭据写进日志。
        console.error('worker_error', e && e.message);
        return withCors(json({ error: 'internal_error' }, 500), cors);
      }
    }

    return env.ASSETS.fetch(request);
  },
};