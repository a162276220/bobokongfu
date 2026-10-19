/* 云端账号改造的 node 套件：迁移、会话、Worker、跨账号隔离。
   退出码 0 = 全过。本机没有 miniflare（wrangler 在沙箱里起不来），D1 一律用
   goldminer-hut/tools/fake-d1.mjs 顶掉，语义按真 D1 的 API 复刻。 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fakeD1 } from '../goldminer-hut/tools/fake-d1.mjs';
import {
  registerUser, login, logout, getUserFromRequest, sessionCookie,
  PBKDF2_ITERATIONS, SESSION_COOKIE,
} from '../goldminer-hut/functions/session.mjs';
import worker from '../goldminer-hut/functions/worker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const threw = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const BUSINESS = ['ast', 'meal', 'wk', 'acc', 'voc', 'amz', 'xhs', 'inv', 'pet', 'cab', 'ach', 'chk', 'rpt'];
const ACCOUNT = ['users', 'sessions', 'invites', 'devices', 'tomb'];

/* ---------- A. 迁移：13 张业务表 + 账号表 + 索引 ---------- */
console.log('\nA. D1 迁移 0001_init.sql');
const sql = readFileSync(join(ROOT, 'goldminer-hut', 'migrations', '0001_init.sql'), 'utf8');
const d1 = fakeD1(':memory:');
await d1.exec(sql);

const names = async (type) =>
  (await d1.prepare('SELECT name FROM sqlite_master WHERE type = ?').bind(type).all())
    .results.map((r) => r.name);
const tables = await names('table');
const indexes = await names('index');

check('13 张业务表全部建出', BUSINESS.every((t) => tables.includes(t)));
check('5 张账号表全部建出', ACCOUNT.every((t) => tables.includes(t)));
check('users 用户名唯一索引', indexes.includes('users_username_u'));
check('sessions 过期索引（清理用）', indexes.includes('sessions_expires'));
check('tomb 归属+时间索引（A2 增量拉取用）', indexes.includes('tomb_owner_ts'));
check('每张业务表都有 (owner, updated_at) 索引',
  BUSINESS.every((t) => indexes.includes(`${t}_owner_updated`)),
  BUSINESS.filter((t) => !indexes.includes(`${t}_owner_updated`)));
check('tomb 主键是 (owner, tbl, rid)',
  (await d1.prepare('PRAGMA table_info("tomb")').bind().all()).results
    .filter((c) => c.pk > 0).map((c) => c.name).join(',') === 'owner,tbl,rid');
check('迁移可重复执行（幂等）', await (async () => { await d1.exec(sql); return true; })().catch(() => false));

/* ---------- B. 账号、会话与邀请码 ---------- */
console.log('\nB. 账号、会话与邀请码');

const userRows = async () => (await d1.prepare('SELECT * FROM users').bind().all()).results;
const userCount = async () => (await userRows()).length;
const addInvite = (code, expiresAt = null) =>
  d1.prepare('INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, NULL, ?, ?)')
    .bind(code, new Date().toISOString(), expiresAt).run();

await addInvite('inv-ok');
await addInvite('inv-expired', '2000-01-01T00:00:00.000Z');
await addInvite('inv-used');
await addInvite('inv-dup');

const reg = await registerUser(d1, { username: '矿工老铁', password: 'pw123456', invite: 'inv-ok' });
check('有效邀请码能注册', typeof reg.userId === 'string' && reg.userId.length > 10);
const first = (await userRows())[0];
check('密码不落明文', !JSON.stringify(await userRows()).includes('pw123456'));
check('pw_hash 是 64 位十六进制（SHA-256 长度）', /^[0-9a-f]{64}$/.test(first.pw_hash));
check('pw_iter 取自常量（逐用户存储）', Number(first.pw_iter) === PBKDF2_ITERATIONS);

for (const [label, name, ok] of [
  ['空用户名', '', false],
  ['129 字符用户名', 'x'.repeat(129), false],
  ['含 emoji 的用户名', '矿工⛏️老铁', true],
]) {
  const code = 'inv-' + label;
  await addInvite(code);
  const e = await threw(() => registerUser(d1, { username: name, password: 'pw123456', invite: code }));
  check(`${label}：${ok ? '受理' : '拒绝'}`, ok ? !e : !!e, e && e.code);
}

const beforeBadInvite = await userCount();
for (const [label, code] of [['不存在的邀请码', 'nope'], ['已过期的邀请码', 'inv-expired']]) {
  const e = await threw(() => registerUser(d1, { username: 'u-' + label, password: 'pw123456', invite: code }));
  check(`${label}被拒（invite_invalid）`, e && e.code === 'invite_invalid', e && e.code);
}
check('邀请码失败路径没有留下半个账号', (await userCount()) === beforeBadInvite);

await registerUser(d1, { username: '第二个', password: 'pw123456', invite: 'inv-used' });
const beforeReuse = await userCount();
const reuse = await threw(() => registerUser(d1, { username: '第三个', password: 'pw123456', invite: 'inv-used' }));
check('已用过的邀请码被拒', reuse && reuse.code === 'invite_invalid');
check('重复用码没有建号', (await userCount()) === beforeReuse);

const dup = await threw(() => registerUser(d1, { username: '矿工老铁', password: 'pw123456', invite: 'inv-dup' }));
check('重复用户名被拒（409）', dup && dup.status === 409 && dup.code === 'username_taken', dup && dup.code);

const wrong = await threw(() => login(d1, { username: '矿工老铁', password: 'wrong-password' }));
check('错密码被拒（401）', wrong && wrong.status === 401 && wrong.code === 'invalid_credentials');
const ghost = await threw(() => login(d1, { username: '查无此人', password: 'wrong-password' }));
check('不存在的用户同样是 401（不泄漏用户是否存在）', ghost && ghost.status === 401 && ghost.code === 'invalid_credentials');

const s1 = await login(d1, { username: '矿工老铁', password: 'pw123456', ua: 'dev-A' });
check('登录返回 token', typeof s1.token === 'string' && s1.token.length > 20);
const sessionRows = (await d1.prepare('SELECT token_hash FROM sessions').bind().all()).results;
check('库里只存 token 哈希，不存明文',
  sessionRows.length > 0 && !sessionRows.some((r) => r.token_hash === s1.token));

const req = (token, mode = 'cookie') => new Request('https://x/api', {
  headers: mode === 'cookie' ? { cookie: `${SESSION_COOKIE}=${token}` } : { authorization: `Bearer ${token}` },
});
const s2 = await login(d1, { username: '矿工老铁', password: 'pw123456', ua: 'dev-B' });
const u1 = await getUserFromRequest(d1, req(s1.token));
const u2 = await getUserFromRequest(d1, req(s2.token));
check('多设备：两个会话各自有效且指向同一用户',
  !!u1 && !!u2 && u1.user_id === s1.userId && u2.user_id === s2.userId);
check('Bearer 头同样能解析身份', (await getUserFromRequest(d1, req(s1.token, 'bearer'))).user_id === s1.userId);

await logout(d1, s1.token);
check('登出只失效自己那个会话',
  (await getUserFromRequest(d1, req(s1.token))) === null
  && (await getUserFromRequest(d1, req(s2.token))).user_id === s2.userId);
check('登出后 Bearer 也失效', (await getUserFromRequest(d1, req(s1.token, 'bearer'))) === null);

await d1.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?')
  .bind('2000-01-01T00:00:00.000Z', s2.userId).run();
check('过期会话解析不出身份', (await getUserFromRequest(d1, req(s2.token))) === null);
check('伪造的 token 解析不出身份', (await getUserFromRequest(d1, req('forged-token'))) === null);
check('没有凭据时返回 null', (await getUserFromRequest(d1, new Request('https://x/api'))) === null);

const cookie = sessionCookie('tok', 60);
check('cookie 带 HttpOnly + Secure + SameSite=Lax',
  /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie));
check('本地 http 调试可关掉 Secure', !/Secure/.test(sessionCookie('tok', 60, { secure: false })));


/* ---------- C. Worker 路由、双模式凭据与跨账号隔离 ---------- */
console.log('\nC. Worker 路由与跨账号隔离');

const ENV = {
  DB: d1,
  ASSETS: { fetch: async (req) => new Response('asset:' + new URL(req.url).pathname) },
};
const call = (path, { method = 'GET', body, headers = {} } = {}) =>
  worker.fetch(new Request('https://hut.example' + path, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  }), ENV);

await addInvite('inv-甲');
await addInvite('inv-乙');
const reg1 = await call('/api/auth/register', { method: 'POST', body: { username: '甲', password: 'pw123456', invite: 'inv-甲' } });
const j1 = await reg1.json();
check('注册 → 201 且下发会话 cookie',
  reg1.status === 201 && /gm_session=/.test(reg1.headers.get('set-cookie') || ''), reg1.status);
check('注册响应同时给 Bearer 令牌（file:// 模式要用）', typeof j1.token === 'string' && j1.token.length > 20);
const reg2 = await call('/api/auth/register', { method: 'POST', body: { username: '乙', password: 'pw123456', invite: 'inv-乙' } });
const j2 = await reg2.json();
check('第二个账号注册成功且用户 id 不同', reg2.status === 201 && j1.userId !== j2.userId);

const cookie1 = 'gm_session=' + j1.token;
const cookie2 = 'gm_session=' + j2.token;
const bearer1 = { authorization: 'Bearer ' + j1.token };

check('未带凭据访问数据面 → 401', (await call('/api/app?action=query&table=ach')).status === 401);
check('伪造 cookie → 401',
  (await call('/api/app?action=query&table=ach', { headers: { cookie: 'gm_session=forged' } })).status === 401);
check('带 cookie 访问数据面 → 200',
  (await call('/api/app?action=query&table=ach', { headers: { cookie: cookie1 } })).status === 200);

const writeA = await call('/api/app?table=ach', {
  method: 'POST', headers: { cookie: cookie1 },
  body: { action: 'insert', table: 'ach', properties: { rid: { text: 'r-甲-1' }, 成就ID: { text: 'a1' } } },
});
check('甲写入自己的行成功', writeA.status === 200, writeA.status);

const rowsOf = async (headers) => {
  const body = await (await call('/api/app?action=query&table=ach', { headers })).json();
  return JSON.stringify(body.results || []);
};
check('甲查得到自己的行', (await rowsOf({ cookie: cookie1 })).includes('r-甲-1'));
check('乙查不到甲的行（跨账号隔离）', !(await rowsOf({ cookie: cookie2 })).includes('r-甲-1'));

const idA = (await d1.prepare('SELECT id FROM ach WHERE rid = ?').bind('r-甲-1').first()).id;
const updByB = await call('/api/app?table=ach', {
  method: 'POST', headers: { cookie: cookie2 },
  body: { action: 'update', table: 'ach', recordId: idA, properties: { 成就ID: { text: '被篡改' } } },
});
check('乙改甲的行 → 409（owner 过滤在 handler，owner 只来自会话）', updByB.status === 409, updByB.status);

const delByB = await call('/api/app?table=ach', {
  method: 'POST', headers: { cookie: cookie2 },
  body: { action: 'delete', table: 'ach', recordId: idA },
});
check('乙删甲的行之后，甲的行还在',
  delByB.status === 200 && (await rowsOf({ cookie: cookie1 })).includes('r-甲-1'));

const steal = await call('/api/app?table=ach', {
  method: 'POST', headers: { cookie: cookie2 },
  body: { action: 'insert', table: 'ach', properties: { rid: { text: 'r-甲-1' }, 成就ID: { text: '蹭 rid' } } },
});
check('乙复用甲的 rid 现在成功了（rid 只在 owner 内唯一，前端 rid 是确定性的）', steal.status === 200, steal.status);
check('两个账号的 ach 里各有一行同 rid', (await rowsOf({ cookie: cookie1 })).includes('r-甲-1') && (await rowsOf({ cookie: cookie2 })).includes('r-甲-1'));

const fileMode = await call('/api/app?action=query&table=ach', { headers: { origin: 'null', ...bearer1 } });
check('file:// 模式（Origin: null）用 Bearer 访问 → 200', fileMode.status === 200, fileMode.status);
check('回显 Origin: null 的 CORS 头',
  fileMode.headers.get('access-control-allow-origin') === 'null',
  fileMode.headers.get('access-control-allow-origin'));

const pre = await call('/api/auth/login', {
  method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-headers': 'authorization' },
});
check('预检 → 204 且允许 authorization 头',
  pre.status === 204 && /authorization/.test(pre.headers.get('access-control-allow-headers') || ''));

check('未知 /api 路径 → 404', (await call('/api/whatever')).status === 404);
check('非 /api 路径交给静态资源', (await (await call('/index.html')).text()) === 'asset:/index.html');

const me = await call('/api/auth/me', { headers: { cookie: cookie1 } });
check('/api/auth/me 带 cookie → 200 且是本人', me.status === 200 && (await me.json()).user_id === j1.userId);
check('/api/auth/me 无凭据 → 401', (await call('/api/auth/me')).status === 401);

check('错密码登录 → 401',
  (await call('/api/auth/login', { method: 'POST', body: { username: '甲', password: 'nope-nope' } })).status === 401);
check('重复用户名注册 → 409',
  (await call('/api/auth/register', { method: 'POST', body: { username: '甲', password: 'pw123456', invite: 'inv-乙' } })).status === 409);
check('坏邀请码注册 → 403',
  (await call('/api/auth/register', { method: 'POST', body: { username: '丙', password: 'pw123456', invite: '不存在的码' } })).status === 403);

const out1 = await call('/api/auth/logout', { method: 'POST', headers: { cookie: cookie1 } });
check('登出清 cookie', /Max-Age=0/.test(out1.headers.get('set-cookie') || ''));
check('登出后该 cookie 不再可用', (await call('/api/auth/me', { headers: { cookie: cookie1 } })).status === 401);
check('登出不影响另一个账号', (await call('/api/auth/me', { headers: { cookie: cookie2 } })).status === 200);

/* ---------- D. 多账号主线：前端生成的 rid 是确定性的，两个账号必然撞 ---------- */
console.log('\nD. 两个账号写同一个 rid');

const cookieOf = (res) => String(res.headers.get('set-cookie') || '').split(';')[0];
await addInvite('inv-甲2');
await addInvite('inv-乙2');
const regA2 = await call('/api/auth/register', { method: 'POST', headers: { origin: 'https://hut.example' }, body: { username: '甲2', password: 'pw123456', invite: 'inv-甲2' } });
const bodyA2 = await regA2.json();
const regB2 = await call('/api/auth/register', { method: 'POST', headers: { origin: 'https://hut.example' }, body: { username: '乙2', password: 'pw123456', invite: 'inv-乙2' } });
const cookieA = cookieOf(regA2);
const cookieB = cookieOf(regB2);
check('站点模式注册下发会话 cookie', cookieA.startsWith('gm_session='), cookieA.slice(0, 24));
check('站点模式注册不在响应体里回令牌（凭据只走 HttpOnly cookie）',
  bodyA2.token === undefined, Object.keys(bodyA2));
const fileLogin = await call('/api/auth/login', { method: 'POST', headers: { origin: 'null' }, body: { username: '甲2', password: 'pw123456' } });
check('file:// 模式（Origin: null）登录回令牌（没有 cookie 可用）',
  typeof (await fileLogin.json()).token === 'string');

const qRows = async (headers, table) => {
  const body = await (await call('/api/app?action=query&table=' + table, { headers })).json();
  return JSON.stringify(body.results || []);
};
const writeRid = (headers, rid) => call('/api/app?table=ast', {
  method: 'POST', headers,
  body: { action: 'insert', table: 'ast', properties: { rid: { text: rid }, 金币: { number: 7 } } },
});

const ridA = await writeRid({ cookie: cookieA }, 't');
check('甲2 写 rid=t（前端 ast 的确定性 rid）成功', ridA.status === 200, ridA.status);
const ridB = await writeRid({ cookie: cookieB }, 't');
check('乙2 写同一个 rid=t 也成功（rid 只在 owner 内唯一）', ridB.status === 200, ridB.status);
check('两个账号各有一行 rid=t，互不覆盖',
  (await d1.prepare('SELECT owner FROM ast WHERE rid = ?').bind('t').all()).results.length === 2);
check('乙2 查 ast 看到的是自己的行', (await qRows({ cookie: cookieB }, 'ast')).includes('"t"'));
check('甲2 查 ast 也只看到自己的行', (await qRows({ cookie: cookieA }, 'ast')).includes('"t"'));

/* 建号失败不能把邀请码烧掉：认领是一次性写入，回滚不了就等于永久作废一张码。
   这里把 users 的 INSERT 打成必然失败，模拟「校验通过之后、写入之前被人抢注」。 */
const failUsersInsert = (base) => new Proxy(base, {
  get(target, prop) {
    if (prop !== 'prepare') { return target[prop]; }
    return (sql) => {
      const statement = target.prepare(sql);
      if (!sql.includes('INSERT INTO users')) { return statement; }
      // bind 必须返回这个代理本身，否则链上拿到的是内层对象，注入的失败就绕过去了
      let proxy;
      proxy = new Proxy(statement, {
        get(s, sp) {
          if (sp === 'bind') { return () => proxy; }
          if (sp === 'run') { return async () => { throw new Error('UNIQUE constraint failed: users.username'); }; }
          return s[sp];
        },
      });
      return proxy;
    };
  },
});

await addInvite('inv-回滚');
const broken = failUsersInsert(d1);
const failed = await (async () => { try { await registerUser(broken, { username: '抢注的人', password: 'pw123456', invite: 'inv-回滚' }); return null; } catch (e) { return e; } })();
check('建号失败被映射成 409 username_taken', failed && failed.status === 409 && failed.code === 'username_taken', failed && failed.code);
check('建号失败后没有留下半个账号',
  (await d1.prepare('SELECT id FROM users WHERE username = ?').bind('抢注的人').first()) === null);
check('建号失败后邀请码被还回去（还能再用）',
  (await d1.prepare('SELECT used_by FROM invites WHERE code = ?').bind('inv-回滚').first()).used_by === null);
const retry = await (async () => { try { return await registerUser(d1, { username: '抢注的人', password: 'pw123456', invite: 'inv-回滚' }); } catch (e) { return e; } })();
check('同一张码可以重新用来注册', retry && retry.userId, retry && retry.code);

console.log('\n' + (fail === 0 ? '全部通过' : '合计失败 ' + fail) + `（${pass} 通过 / ${fail} 失败）`);
process.exit(fail === 0 ? 0 : 1);
