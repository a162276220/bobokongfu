/* app 数据面的本地自测：同一组断言在两个宿主下各跑一遍。
   宿主 A 用内存假库（只实现 handler 用到的那点 PostgREST 形状），
   宿主 B 用 backend/sqlite-db.mjs 的真实 SQLite 适配器 + node:sqlite。

   验证的是“应用逻辑与 HTTP 契约”，不是云端权限/原子性 —— 两者证据要分开记。
   跑第二遍的意义：证明自建后端与云库语义对齐（分页、幂等 upsert、
   update 0 行→409、跨 owner 隔离、列白名单、rid 唯一约束），
   而不是只证明假库陪我演戏。

   最关键的一条是往返稳定性：客户端 serializeRow 推上去的值，经 handler 落库、
   query 读回、rowCols 还原后，必须与本地值 canon() 相等。否则每次推送都会判定
   “内容不同”而重推，快照永远收敛不了。 */

import { handleApp } from '../functions/handler.mjs';
import { requireUser } from '../functions/auth.mjs';
import { TABLES, tableDef, ddlStatements } from '../functions/schema.mjs';
import { openDb } from '../backend/sqlite-db.mjs';
import { openDb as openD1Db } from '../backend/d1-db.mjs';
import { fakeD1 } from './fake-d1.mjs';

/* ---------- 客户端等价实现（照抄 HTML 里的 pv/rowCols/canon/serializeRow） ---------- */
const TABS = {};
for (const tk of Object.keys(TABLES)) {
  TABS[tk] = { cols: {} };
  for (const { chinese, col, bool } of tableDef(tk)) TABS[tk].cols[chinese] = bool ? 'c' : 't';
}
function pv(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of ['text', 'number', 'checkbox', 'select', 'date']) if (k in v) return v[k];
  }
  return v;
}
function canon(c) {
  const o = c || {};
  const keys = Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null).sort();
  return JSON.stringify(keys.map((k) => [k, String(o[k])]));
}
function rowCols(tk, r) {
  const c = {};
  Object.keys(TABS[tk].cols).forEach((col) => {
    const v = pv(r[col]);
    if (v !== undefined && v !== null) c[col] = v;
  });
  return c;
}
function serializeRow(tk, rid, c, now) {
  const props = { rid: { text: rid }, updatedAt: { number: now } };
  Object.keys(c).forEach((col) => {
    const v = c[col];
    if (v === undefined || v === null) return;
    const t = TABS[tk].cols[col];
    if (t === 'n') props[col] = { number: Number(v) };
    else if (t === 'c') props[col] = { checkbox: !!v };
    else props[col] = { text: String(v) };
  });
  return props;
}

/* ---------- 身份头 ---------- */
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const UID = 'u-1';
const ctxHeader = (uid = UID, expSkew) => b64url(JSON.stringify({
  user_id: uid, site_id: 's1', host_id: 'h1', name: '', picture: '',
  session_expires_at: Math.floor(Date.now() / 1000) + (expSkew ?? 3600),
}));

/* ---------- 宿主 A：内存假库 ---------- */
function memoryHost() {
  const store = new Map(); // table -> rows[]
  const bump = { count: 0 };

  class Query {
    constructor(tk, op, payload) {
      this.tk = tk; this.op = op; this.payload = payload;
      this.filters = []; this.orders = []; this.rangeArgs = null; this.selectCols = null;
    }
    eq(k, v) { this.filters.push([k, v]); return this; }
    order(k, o) { this.orders.push([k, o && o.ascending !== false]); return this; }
    range(a, b) { this.rangeArgs = [a, b]; return this; }
    select(cols) { this.selectCols = cols; return this; }
    rows() { return store.get(this.tk) || (store.set(this.tk, []), store.get(this.tk)); }
    matched() {
      return this.rows().filter((r) => this.filters.every(([k, v]) => r[k] === v));
    }
    _run() {
      bump.count++;
      if (this.op === 'delete') {
        const hit = this.matched();
        store.set(this.tk, this.rows().filter((r) => !hit.includes(r)));
        return { error: null };
      }
      if (this.op === 'update') {
        const hit = this.matched();
        for (const r of hit) Object.assign(r, this.payload);
        const cols = this.selectCols ? this.selectCols.split(',').map((c) => c.trim()) : null;
        return { data: cols ? hit.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) : hit, error: null };
      }
      if (this.op === 'upsert') {
        const keys = this.payload.__onConflict;
        const found = this.rows().find((r) => keys.every((k) => r[k] === this.payload.row[k]));
        if (found) { Object.assign(found, this.payload.row, { id: found.id }); }
        else { this.rows().push({ ...this.payload.row }); }
        return { error: null };
      }
      // select
      let out = this.matched().slice();
      for (let i = this.orders.length - 1; i >= 0; i--) {
        const [k, asc] = this.orders[i];
        out.sort((a, b) => {
          const av = a[k] == null ? '' : String(a[k]); const bv = b[k] == null ? '' : String(b[k]);
          return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.rangeArgs) out = out.slice(this.rangeArgs[0], this.rangeArgs[1] + 1);
      const cols = this.selectCols ? this.selectCols.split(',').map((c) => c.trim()) : null;
      return { data: cols ? out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) : out, error: null };
    }
    then(res, rej) { return Promise.resolve(this._run()).then(res, rej); }
  }

  const db = {
    from(tk) {
      return {
        select: (cols) => new Query(tk, 'select', null).select(cols),
        insert: (row) => new Query(tk, 'upsert', { row, __onConflict: ['rid'] }),
        upsert: (row, opts) => new Query(tk, 'upsert', { row, __onConflict: (opts.onConflict || 'rid').split(',') }),
        update: (patch) => new Query(tk, 'update', patch),
        delete: () => new Query(tk, 'delete', null),
      };
    },
  };

  return {
    name: '内存假库',
    db,
    getUser: requireUser,
    rows: async (tk) => store.get(tk) || [],
    // 假库没有数据库级约束，只验证逻辑；真实约束由 SQLite 那一路证明。
    globalUniqueRid: false,
    queries: () => bump.count,
  };
}

/* ---------- 宿主 B：真实 SQLite 适配器（node:sqlite，内存库） ---------- */
function sqliteHost() {
  const db = openDb(':memory:');
  const allCols = (tk) => ['id', 'owner', 'rid', 'updated_at', ...tableDef(tk).map((d) => d.col)].join(',');
  return {
    name: 'SQLite 适配器',
    db,
    getUser: requireUser,
    rows: async (tk) => (await db.from(tk).select(allCols(tk))).data,
    // 云库里 rid 是列级 UNIQUE（见 tools/migration.json），适配器必须复刻它。
    globalUniqueRid: true,
    queries: () => null,
    close: () => db.close(),
  };
}

/* ---------- 宿主 C：D1 适配器（假绑定顶掉真 D1，语义按真 API 复刻） ---------- */
function d1Host() {
  const d1 = fakeD1(':memory:', ddlStatements());
  const db = openD1Db(d1);
  const allCols = (tk) => ['id', 'owner', 'rid', 'updated_at', ...tableDef(tk).map((d) => d.col)].join(',');
  return {
    name: 'D1 适配器（假绑定）',
    db,
    getUser: requireUser,
    rows: async (tk) => (await db.from(tk).select(allCols(tk))).data,
    globalUniqueRid: true,
    queries: () => null,
    close: () => d1.close(),
  };
}

/* ---------- 同一组断言，两个宿主各跑一遍 ---------- */
const get = (qs, headers = {}, method = 'GET') => new Request('https://x/app' + qs, {
  method,
  headers: { 'x-qoder-user-context': ctxHeader(), ...headers },
});
const post = (body, headers = {}) => new Request('https://x/app', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-qoder-user-context': ctxHeader(), ...headers },
  body: JSON.stringify(body),
});

const sample = (tk) => {
  const c = {};
  Object.keys(TABS[tk].cols).forEach((col, i) => {
    const t = TABS[tk].cols[col];
    if (t === 'c') c[col] = i % 2 === 0;
    else if (t === 'n') c[col] = i * 3.5;
    else c[col] = '值' + i + '/a b?c';
  });
  return c;
};

async function runSuite(host) {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ok  ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
  };
  const call = (request) => handleApp({ request, db: host.db, getUser: host.getUser });
  const now = Date.now();

  console.log('\n=== 宿主：' + host.name + ' ===');

  /* ---------- A. 身份与守卫 ---------- */
  console.log('\nA. 身份与守卫');
  check('无身份头 → 401 login_required',
    (await call(new Request('https://x/app?action=query&table=ast'))).status === 401);
  check('过期身份 → 403 invalid_user_context',
    (await call(new Request('https://x/app?action=query&table=ast',
      { headers: { 'x-qoder-user-context': ctxHeader(UID, -10) } }))).status === 403);
  check('未登录的写请求也先拒（401，不会先报 405）',
    (await call(new Request('https://x/app', { method: 'PUT' }))).status === 401);
  check('未知表 → 404',
    (await call(get('?action=query&table=nope'))).status === 404);
  check('GET 非 query → 404',
    (await call(get('?action=list&table=ast'))).status === 404);
  check('已登录 PUT → 405 + allow',
    (await call(get('', {}, 'PUT'))).status === 405);

  /* ---------- B. 往返稳定性（13 表逐个） ---------- */
  console.log('\nB. 往返稳定性：serializeRow → 落库 → query → rowCols 必须 canon 相等');
  for (const tk of Object.keys(TABLES)) {
    const rid = 'r-' + tk;
    const local = sample(tk);
    const ins = await call(post({ action: 'insert', table: tk, properties: serializeRow(tk, rid, local, now) }));
    const body = await (await call(get('?action=query&table=' + tk))).json();
    const row = (body.results || []).find((r) => pv(r.rid) === rid);
    const back = row ? rowCols(tk, row) : null;
    check(tk + ' insert 200 且回读 canon 相等',
      ins.status === 200 && !!row && canon(back) === canon(local),
      { status: ins.status, back, local, canonBack: back && canon(back), canonLocal: canon(local) });
  }

  /* ---------- C. 分页 ---------- */
  console.log('\nC. 分页 hasMore/nextCursor');
  for (let i = 0; i < 501; i++) {
    await call(post({ action: 'insert', table: 'ach', properties: { rid: { text: 'p' + i }, 成就ID: { text: 'a' + i } } }));
  }
  const p1 = await (await call(get('?action=query&table=ach'))).json();
  check('满页 → hasMore true, nextCursor 500', p1.results.length === 500 && p1.hasMore === true && p1.nextCursor === 500, { n: p1.results.length, hm: p1.hasMore, nc: p1.nextCursor });
  const p2 = await (await call(get('?action=query&table=ach&cursor=500'))).json();
  check('次页取到剩余 2 行且 hasMore false', p2.results.length === 2 && p2.hasMore === false && p2.nextCursor === null, { n: p2.results.length });
  check('非法 cursor → 400', (await call(get('?action=query&table=ach&cursor=-1'))).status === 400);

  /* ---------- D. 写路径 ---------- */
  console.log('\nD. 写路径');
  const upd = await call(post({ action: 'update', table: 'meal', recordId: 'missing-id', properties: { 食物: { text: 'x' } } }));
  check('update 未命中 → 409（客户端据此退回 insert）', upd.status === 409, { status: upd.status });

  // 行 id 一律从库里读回来拿，不依赖宿主的内部存储形状
  const rowMeal = (await host.rows('meal')).find((r) => r.owner === UID);
  const updOk = await call(post({ action: 'update', table: 'meal', recordId: rowMeal.id, properties: { 食物: { text: '改了' }, 热量: { number: 12 } } }));
  const changed = (await host.rows('meal')).find((r) => r.id === rowMeal.id);
  check('update 命中 → 200 且值已改',
    updOk.status === 200 && changed && changed.food === '改了' && changed.calories === '12',
    { status: updOk.status, food: changed && changed.food, cal: changed && changed.calories });

  check('insert 缺 rid → 400',
    (await call(post({ action: 'insert', table: 'meal', properties: { 食物: { text: 'x' } } }))).status === 400);

  // 同 rid 二次 insert（update 失败后的重建路径）必须幂等，不能出现两行
  const before = (await host.rows('meal')).length;
  await call(post({ action: 'insert', table: 'meal', properties: serializeRow('meal', 'r-meal', { 食物: '重建' }, now) }));
  const after = (await host.rows('meal')).length;
  check('同 rid 重复 insert 幂等（行数不变）', before === after, { before, after });

  const del = await call(post({ action: 'delete', table: 'meal', recordId: rowMeal.id }));
  const del2 = await call(post({ action: 'delete', table: 'meal', recordId: rowMeal.id }));
  check('delete 200 且重复删除仍 200（幂等）', del.status === 200 && del2.status === 200);

  const achRows = await host.rows('ach');
  const achMine = achRows.find((r) => r.owner === UID);
  const wrongOwner = new Request('https://x/app', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-qoder-user-context': ctxHeader('u-2') },
    body: JSON.stringify({ action: 'delete', table: 'ach', recordId: achMine.id }),
  });
  await call(wrongOwner);
  check('另一个 owner 删不动别人的行', (await host.rows('ach')).length === 502, { n: (await host.rows('ach')).length });

  const iso = await call(get('?action=query&table=ach', { 'x-qoder-user-context': ctxHeader('u-2') }));
  check('另一个 owner 查不到 u-1 的行', (await iso.json()).results.length === 0);

  /* ---------- E. 列白名单 ---------- */
  console.log('\nE. 列白名单：请求不能写 owner/id/updated_at');
  await call(post({ action: 'insert', table: 'cab', properties: { rid: { text: 'evil' }, owner: { text: 'u-2' }, id: { text: 'forced' }, updated_at: { text: '1999-01-01T00:00:00Z' }, 名称: { text: 'ok' } } }));
  const evil = (await host.rows('cab')).find((r) => r.rid === 'evil');
  check('owner 仍取自身份、id 由服务端生成、updated_at 不由请求决定',
    evil && evil.owner === UID && evil.id !== 'forced' && evil.updated_at !== '1999-01-01T00:00:00Z',
    evil && { owner: evil.owner, id: evil.id, updated_at: evil.updated_at });

  /* ---------- F. 宿主专属：真实数据库约束 ---------- */
  if (host.globalUniqueRid) {
    console.log('\nF. 宿主专属：rid 只在 owner 内唯一');
    const r200 = await call(post({ action: 'insert', table: 'ach', properties: { rid: { text: achMine.rid }, 成就ID: { text: '别人家的同 rid' } } }, { 'x-qoder-user-context': ctxHeader('u-2') }));
    const same = (await host.rows('ach')).filter((r) => r.rid === achMine.rid);
    check('别的 owner 复用同一 rid 成功（前端 rid 是确定性的，人人会撞）',
      r200.status === 200 && same.length === 2,
      { status: r200.status, owners: same.map((r) => r.owner) });
    const twice = await call(post({ action: 'insert', table: 'ach', properties: { rid: { text: 'dup-rid' }, 成就ID: { text: 'x' } } }));
    const again = await call(post({ action: 'insert', table: 'ach', properties: { rid: { text: 'dup-rid' }, 成就ID: { text: 'y' } } }));
    const dups = (await host.rows('ach')).filter((r) => r.rid === 'dup-rid');
    check('同一 owner 重复写同 rid 仍只有一行（幂等）',
      twice.status === 200 && again.status === 200 && dups.length === 1,
      { status: [twice.status, again.status], rows: dups.length });
  }

  const q = host.queries();
  if (q !== null) console.log('\n查询次数:', q);
  console.log('\n' + host.name + '：' + pass + ' 通过 / ' + fail + ' 失败');
  return { pass, fail };
}

let totalFail = 0;
for (const host of [memoryHost(), sqliteHost(), d1Host()]) {
  try {
    totalFail += (await runSuite(host)).fail;
  } catch (e) {
    totalFail++;
    console.log('  FAIL 宿主 ' + host.name + ' 跑挂了：' + (e && e.message));
  }
  if (host.close) host.close();
}
console.log(totalFail === 0 ? '\n全部通过' : '\n合计失败 ' + totalFail);
process.exit(totalFail === 0 ? 0 : 1);
