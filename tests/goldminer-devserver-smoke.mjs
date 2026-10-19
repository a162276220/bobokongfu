/* 开发服务器的冒烟测试：起真进程、走真 HTTP，验「浏览器要走的那条路」是通的。
   为什么需要它：devserver 曾经只接 /functions/v1/app（Supabase 时代的路径），
   前端改用 /api/app 之后本地同步会整层静默失效 —— 那是本地验收会得出错误结论的坑。

   沙箱注意：本环境禁止捕获子进程输出的管道，所以子进程用 stdio: 'ignore'，
   靠轮询 /api/health 判断服务起来了，而不是读它的 stdout。不要改成 pipe。 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.SMOKE_PORT || 8799);
const BASE = 'http://127.0.0.1:' + PORT;
const DB = fileURLToPath(new URL('../goldminer-hut/.wrangler/smoke.sqlite', import.meta.url));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
};

for (const f of [DB, DB + '-journal', DB + '-wal']) { rmSync(f, { force: true }); }
const child = spawn(process.execPath, ['goldminer-hut/tools/devserver.mjs'], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DEV_DB: DB },
});

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(BASE + '/api/health')).ok; } catch { await delay(250); }
  }
  check('开发服务器起来了（/api/health）', up);
  if (!up) { throw new Error('devserver 没起来'); }

  const seed = new DatabaseSync(DB);
  const cols = seed.prepare('PRAGMA table_info(invites)').all().map((c) => c.name);
  check('启动时自动建好了库（invites 表在）', cols.length > 0, cols);
  seed.prepare('INSERT INTO invites (code, created_at) VALUES (?, ?)').run('smoke-invite', new Date().toISOString());
  seed.close();

  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://smoke.local' },
    body: JSON.stringify({ username: '冒烟甲', password: 'pw123456', invite: 'smoke-invite' }),
  });
  const cookie = ((reg.headers.getSetCookie && reg.headers.getSetCookie()) || [])[0]?.split(';')[0] || '';
  check('注册 → 201 且下发会话 cookie', reg.status === 201 && cookie.startsWith('gm_session='), reg.status);

  const me = await fetch(BASE + '/api/auth/me', { headers: { cookie } });
  check('带 cookie 取身份 → 200 且是本人', me.status === 200 && !!(await me.json()).user_id, me.status);

  const ins = await fetch(BASE + '/api/app?table=ast', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'insert', table: 'ast', properties: { rid: { text: 't' }, 金币: { number: 42 } } }),
  });
  check('往数据面写一行 → 200', ins.status === 200, ins.status);

  const q = await fetch(BASE + '/api/app?action=query&table=ast', { headers: { cookie } });
  const rows = (await q.json()).results || [];
  // 线上契约：数值列在 wire 上是 text（平台没有 numeric），前端读回时用 num() 还原。
  check('查回来是刚写的那行，且是 wire 格式（数值列为 text）',
    q.status === 200 && rows.length === 1 && rows[0]['金币'] && rows[0]['金币'].text === '42', rows);

  const anon = await fetch(BASE + '/api/app?action=query&table=ast');
  check('没凭据访问数据面 → 401', anon.status === 401, anon.status);

  const home = await fetch(BASE + '/');
  const html = await home.text();
  check('静态资源从 dist/ 发出', home.status === 200 && html.includes('<!DOCTYPE html>'), home.status);
} catch (e) {
  fail++;
  console.log('  FAIL 异常：' + (e && e.message));
} finally {
  child.kill();
  await delay(200);
}

console.log('\n' + (fail === 0 ? '全部通过' : '合计失败 ' + fail) + `（${pass} 通过 / ${fail} 失败）`);
process.exit(fail === 0 ? 0 : 1);
