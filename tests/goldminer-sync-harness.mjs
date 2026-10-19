/* 前端同步层的 node 套件：把工作台 HTML 里的同步层抽出来，跑在假 DOM 里。
   退出码 0 = 全过。本机没有浏览器可自动化，所以这里断言的是传输层与生命周期，
   不测渲染 —— 渲染由人眼在浏览器里验收（见 spec 的验收记录）。 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { applyPatches } from '../goldminer-hut/tools/patch-sync.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, '淘金矿工小屋', '淘金矿工小屋·自律工作台.html');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
};

/* 同步层是构建期补丁（源文件被另一个写者整份重写，直接改会被抹掉）。
   所以这里必须「先打补丁再抽」，测的才是真正会发出去的那份代码。 */
const patched = applyPatches(readFileSync(HTML, 'utf8'));
if (patched.failed) {
  console.error('同步层补丁没打全：\n  ' + patched.report.join('\n  '));
  process.exit(1);
}
const html = patched.text;
const marker = html.indexOf('在线数据表同步层');
const scriptOpen = html.lastIndexOf('<script', marker);
const bodyStart = html.indexOf('>', scriptOpen) + 1;
const bodyEnd = html.indexOf('</script>', bodyStart);
const RAW = html.slice(bodyStart, bodyEnd);

/* 夹具要给全：EXTRACT.meal 之类会直接读 s.tasks.diet.records，
   缺字段会在 doPush 里抛错 —— 那样测出来的「没推送」是夹具的问题，不是代码的问题。 */
const FULL_STATE = {
  coins: 7, createdAt: '2026-01-01T00:00:00Z', lastActiveDate: '2026-10-15',
  stats: {}, settings: {}, inventory: [], pets: [], achievements: [], checkinHistory: [], reports: {},
  cabin: { theme: 'default', placed: [] },
  tasks: {
    diet: { records: [] }, exercise: { records: [] }, accounting: { records: [] },
    vocabulary: { words: [], todayWords: [] },
    amazon: { notes: [], todayVideoIdx: 0 },
    xiaohongshu: { projects: [] },
  },
};

function boot({ protocol = 'https:', origin = '', storage = {}, state = FULL_STATE, routes = null } = {}) {
  let source = RAW;
  if (origin) { source = source.replace("var CLOUD_ORIGIN = '';", "var CLOUD_ORIGIN = '" + origin + "';"); }
  if (origin && !source.includes("CLOUD_ORIGIN = '" + origin + "'")) { throw new Error('CLOUD_ORIGIN 注入失败'); }

  const calls = [];
  const timers = [];
  const listeners = [];
  const els = {};
  const store = new Map(Object.entries(storage));
  const el = (tag) => ({
    tagName: tag, id: '', style: {}, children: [], textContent: '', className: '', innerHTML: '',
    setAttribute() {}, querySelector: () => null, addEventListener() {},
    appendChild(c) { this.children.push(c); if (c && c.id) { els[c.id] = c; } return c; },
  });
  const ok = (data, status = 200) => ({ ok: true, status, json: async () => data });
  const route = routes || ((url) => {
    if (url.includes('/api/auth/login') || url.includes('/api/auth/register')) return ok({ token: 'SESS-1', userId: 'u-1' });
    if (url.includes('/api/auth/me')) return ok({ userId: 'u-1', username: '甲' });
    if (url.includes('/api/auth/logout')) return ok({ ok: true });
    if (url.includes('action=query')) return ok({ results: [], hasMore: false, nextCursor: null });
    if (url.includes('/api/app')) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  });

  const ctx = {
    console,
    location: { protocol, href: protocol === 'file:' ? 'file:///workbench.html' : 'https://hut.example/' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      body: el('body'), head: el('head'), visibilityState: 'visible',
      createElement: el, getElementById: (id) => els[id] || null,
      addEventListener: (type, fn) => { calls.push(['listen', type]); listeners.push(fn); },
    },
    fetch: (url, opts) => {
      const o = opts || {};
      calls.push(['fetch', String(url), o.method || 'GET', (o.headers || {}).authorization || '', o.credentials || '']);
      return Promise.resolve(route(String(url), o));
    },
    setTimeout: (fn, ms) => { timers.push({ kind: 'timeout', ms, fn }); return timers.length; },
    setInterval: (fn, ms) => { timers.push({ kind: 'interval', ms, fn }); return timers.length; },
    clearTimeout: () => {},
    saveState: () => { calls.push(['saveState']); },
    ensureFields: (d) => d,
    showToast: () => {},
    navTo: () => {},
    currentPage: 'home',
    _state: state,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'sync-layer.js' });

  const realDrop = ctx.gmSyncDropSnapshot;
  ctx.gmSyncDropSnapshot = function () { calls.push(['drop-snapshot']); return realDrop.apply(this, arguments); };
  return { ctx, calls, timers, listeners, els, store };
}

const flush = () => new Promise((r) => setImmediate(r));

/* ---------- A. 数据面地址解析 ---------- */
console.log('\nA. 数据面地址解析');
{
  const site = boot();
  await site.ctx.gmApiProbe();
  const q = site.calls.find((c) => c[0] === 'fetch');
  check('站点模式请求同源 /api/app', q && q[1] === '/api/app?action=query&table=rpt', q && q[1]);
  check('站点模式带 cookie（credentials=same-origin）', q && q[4] === 'same-origin', q && q[4]);
  check('站点模式没有身份时是未登录态', site.ctx.gmSyncState() === 'logged-out', site.ctx.gmSyncState());
}
{
  const file = boot({ protocol: 'file:' });
  check('file:// 且没填 CLOUD_ORIGIN → 本地模式', file.ctx.gmSyncState() === 'local', file.ctx.gmSyncState());
}
{
  const file = boot({ protocol: 'file:', origin: 'https://hut.example', storage: { goldminer_session_v1: 'SESS-FILE' } });
  check('file:// + CLOUD_ORIGIN + 会话令牌 → 已同步', file.ctx.gmSyncState() === 'synced', file.ctx.gmSyncState());
  await file.ctx.gmApiProbe();
  const q = file.calls.find((c) => c[0] === 'fetch');
  check('file:// 模式请求绝对地址', q && q[1] === 'https://hut.example/api/app?action=query&table=rpt', q && q[1]);
  check('file:// 模式带 Bearer 会话令牌', q && q[3] === 'Bearer SESS-FILE', q && q[3]);
}
{
  const custom = boot({
    protocol: 'file:', origin: 'https://hut.example',
    storage: { goldminer_sync_cfg_v1: JSON.stringify({ endpoint: 'http://127.0.0.1:8790/app', token: 'FIXED' }) },
  });
  await custom.ctx.gmApiProbe();
  const q = custom.calls.find((c) => c[0] === 'fetch');
  check('设置页里的接口地址优先级最高', q && q[1] === 'http://127.0.0.1:8790/app?action=query&table=rpt', q && q[1]);
  check('自定义后端用固定令牌', q && q[3] === 'Bearer FIXED', q && q[3]);
  check('自定义后端不带本站 cookie（credentials=omit）', q && q[4] === 'omit', q && q[4]);
  check('自定义后端 + 固定令牌 → 已同步', custom.ctx.gmSyncState() === 'synced', custom.ctx.gmSyncState());
}

/* ---------- B. 401 处理 ---------- */
console.log('\nB. 会话失效');
{
  const dead = boot({
    protocol: 'file:', origin: 'https://hut.example',
    storage: { goldminer_session_v1: 'SESS-DEAD' },
    routes: () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }),
  });
  await dead.ctx.gmApiProbe();
  check('401 后清掉本地会话令牌', !dead.store.get('goldminer_session_v1'), dead.store.get('goldminer_session_v1'));
  check('401 后指示器回到未登录', dead.ctx.gmSyncState() === 'logged-out', dead.ctx.gmSyncState());
}

/* ---------- C. 登录序列 ---------- */
console.log('\nC. 登录序列与轮询');
{
  const t = boot({ protocol: 'file:', origin: 'https://hut.example' });
  await t.ctx.gmCloudLogin('甲', 'pw123456');
  const order = t.calls.filter((c) => c[0] === 'drop-snapshot' || c[0] === 'fetch').map((c) => c[0] === 'drop-snapshot' ? 'drop' : c[1].replace('https://hut.example', ''));
  check('登录后写入会话令牌', t.store.get('goldminer_session_v1') === 'SESS-1', t.store.get('goldminer_session_v1'));
  check('登录后指示器为已同步', t.ctx.gmSyncState() === 'synced', t.ctx.gmSyncState());
  check('先丢快照，再拉，最后推',
    order[0] === '/api/auth/login' && order[1] === '/api/auth/me' && order[2] === 'drop'
    && order[3] === '/api/app?action=query&table=ast',
    order.slice(0, 5));
  check('快照在第一次数据面请求之前被丢掉',
    order.indexOf('drop') < order.findIndex((u) => u.includes('?action=query') || u === '/api/app'),
    order.slice(0, 6));
  // 登录后的推送不能靠「pull 恰好发现有待推数据」来触发 —— 拉取怎么写基线是它自己的事。
  // 这里自己造一次本机改动，直接验证推送路径真的会 POST。
  // pull() 内部那次 push 是不等待地起飞的，登录链 resolve 时它可能还在飞（_syncing 仍为 true），
  // 所以先让后台推送落地，再改本机数据。
  for (let i = 0; i < 12; i++) { await flush(); }
  t.ctx._state.tasks.diet.records.push({ date: '2026-10-15', meal: '早餐', food: '鸡蛋' });
  t.ctx.saveState();
  const debounce = t.timers.filter((x) => x.kind === 'timeout' && x.ms === 1200).pop();
  check('本机改动触发了 1.2s 防抖推送', !!debounce);
  if (debounce) { debounce.fn(); for (let i = 0; i < 12; i++) { await flush(); } }
  check('登录后本机改动会推到云端（POST /api/app）',
    t.calls.some((c) => c[0] === 'fetch' && c[2] === 'POST' && c[1].includes('/api/app')),
    t.calls.filter((c) => c[0] === 'fetch').map((c) => c[2] + ' ' + c[1].replace('https://hut.example', '')).slice(-4));
  const intervals = t.timers.filter((x) => x.kind === 'interval');
  check('轮询间隔是 60s（不是 30s）', intervals.length === 1 && intervals[0].ms === 60000,
    intervals.map((x) => x.ms));
  check('监听了页面可见性变化', t.calls.some((c) => c[0] === 'listen' && c[1] === 'visibilitychange'));
}
{
  const t = boot({ protocol: 'file:', origin: 'https://hut.example', storage: { goldminer_session_v1: 'S' } });
  const interval = t.timers.find((x) => x.kind === 'interval');
  const before = t.calls.filter((c) => c[0] === 'fetch').length;
  t.ctx.document.visibilityState = 'hidden';
  interval.fn();
  await flush();
  check('页面不可见时轮询不拉取', t.calls.filter((c) => c[0] === 'fetch').length === before);
  t.ctx.document.visibilityState = 'visible';
  t.listeners.forEach((fn) => fn());
  await flush();
  check('回到前台立刻补一次拉取', t.calls.filter((c) => c[0] === 'fetch').length > before);
}
{
  // 会话失效后必须停手：不然 60s 一次的轮询会一直打注定 401 的请求
  const dead = boot({
    protocol: 'file:', origin: 'https://hut.example', storage: { goldminer_session_v1: 'S' },
    routes: () => ({ ok: false, status: 401, json: async () => ({ error: 'login_required' }) }),
  });
  const interval = dead.timers.find((x) => x.kind === 'interval');
  await dead.ctx.gmApiProbe().catch(() => {});
  const after401 = dead.calls.filter((c) => c[0] === 'fetch').length;
  interval.fn();
  await flush();
  check('401 之后轮询不再打网络', dead.calls.filter((c) => c[0] === 'fetch').length === after401);
}
{
  // 站点模式：Worker 现在只在非站点来源回 body 令牌，凭据全在 HttpOnly cookie 里
  const siteOnly = boot({
    protocol: 'https:',
    routes: (url) => {
      if (url.includes('/api/auth/login')) { return { ok: true, status: 200, json: async () => ({ userId: 'u-1' }) }; }
      if (url.includes('/api/auth/me')) { return { ok: true, status: 200, json: async () => ({ user_id: 'u-1', username: '甲', nickname: null }) }; }
      if (url.includes('action=query')) { return { ok: true, status: 200, json: async () => ({ results: [] }) }; }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const r = await siteOnly.ctx.gmCloudLogin('甲', 'pw123456');
  check('站点模式没有 body 令牌也能登录（凭据走 cookie）', r.ok === true, r);
  check('站点模式登录后指示器为已同步（靠 /api/auth/me 的 user_id）', siteOnly.ctx.gmSyncState() === 'synced', siteOnly.ctx.gmSyncState());
  const q = siteOnly.calls.find((c) => c[0] === 'fetch' && c[1].includes('action=query'));
  check('站点模式数据面不带 Authorization 头，但带 cookie', q && q[3] === '' && q[4] === 'same-origin', q && [q[3], q[4]]);
}
{
  const t = boot({ protocol: 'file:', origin: 'https://hut.example', storage: { goldminer_session_v1: 'S' } });
  t.ctx.saveState();
  const debounce = t.timers.filter((x) => x.kind === 'timeout' && x.ms === 1200);
  check('本地改动仍然防抖 1.2s 后推送', debounce.length >= 1, t.timers.map((x) => x.ms));
}

console.log('\n' + (fail === 0 ? '全部通过' : '合计失败 ' + fail) + `（${pass} 通过 / ${fail} 失败）`);
process.exit(fail === 0 ? 0 : 1);
