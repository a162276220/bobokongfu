/* 新媒体工作台数据面：7 张 nm_* 表 + 删除墓碑。
   与 13 张旧表的 /api/app 完全隔离，避免影响现有工作台同步。
   身份只来自会话（cookie / Bearer），owner 不接受请求体。 */

import { getUserFromRequest } from './session.mjs';

const TABLES = {
  topic: {
    name: 'nm_topic',
    cols: ['title', 'line', 'note', 'source', 'hot_id', 'status', 'created_at'],
  },
  hot: {
    name: 'nm_hot',
    cols: ['title', 'platform', 'heat', 'status', 'fetched_at'],
  },
  task: {
    name: 'nm_task',
    cols: ['topic_id', 'line', 'status', 'stage', 'progress', 'params', 'error', 'ip_id', 'content_id', 'started_at', 'created_at'],
  },
  content: {
    name: 'nm_content',
    cols: ['title', 'line', 'status', 'body', 'tags', 'assets', 'review_note', 'prev_version_id', 'task_id', 'topic_id', 'ip_id', 'version', 'finished_at', 'approved_at'],
  },
  ip: {
    name: 'nm_ip',
    cols: ['name', 'persona', 'config', 'status', 'appearances', 'created_at'],
  },
  pub: {
    name: 'nm_pub',
    cols: ['content_id', 'platform', 'method', 'status', 'published_at'],
  },
  stat: {
    name: 'nm_stat',
    cols: ['content_id', 'date', 'views', 'likes', 'comments', 'shares', 'favorites'],
  },
};

const TABLE_KEYS = Object.keys(TABLES);
const MAX_BODY = 1024 * 1024;
const MAX_CHANGES = 300;
const MAX_VALUE = 200000;

/* 本次查询与响应之间若有别的设备写入，严格的 now 水位会把它永久漏掉。
   往回留 5 秒重叠窗口：重复拉到同一行是幂等的，漏拉却不是。 */
const WATERMARK_OVERLAP_MS = 5000;
const watermark = () => new Date(Date.now() - WATERMARK_OVERLAP_MS).toISOString();

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const tsOf = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const asText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > MAX_VALUE ? null : s;
};

function outRow(tk, r) {
  const out = { rid: String(r.rid), updatedAt: String(r.updated_at) };
  for (const col of TABLES[tk].cols) out[col] = r[col] === null || r[col] === undefined ? '' : String(r[col]);
  return out;
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  const text = await request.text();
  if (!text || text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body;
  } catch {
    return null;
  }
}

async function snapshot(db, owner) {
  const rows = {};
  for (const tk of TABLE_KEYS) {
    const { name } = TABLES[tk];
    const out = await db.prepare(`SELECT * FROM ${name} WHERE owner = ? ORDER BY updated_at ASC`).bind(owner).all();
    rows[tk] = (out.results || []).map((r) => outRow(tk, r));
  }
  const tombs = await db
    .prepare('SELECT tbl, rid, updated_at FROM nm_tomb WHERE owner = ? ORDER BY updated_at ASC')
    .bind(owner)
    .all();
  return {
    serverTime: watermark(),
    rows,
    tombs: (tombs.results || []).map((t) => ({ table: t.tbl, rid: t.rid, updatedAt: t.updated_at })),
  };
}

async function handlePull(db, owner, url) {
  const since = url.searchParams.get('since');
  if (!since) {
    const data = await snapshot(db, owner);
    return json({ serverTime: new Date().toISOString(), full: true, ...data });
  }
  const sinceIso = tsOf(since);
  if (!sinceIso) return json({ error: 'invalid_since' }, 400);
  const rows = {};
  for (const tk of TABLE_KEYS) {
    const { name } = TABLES[tk];
    const out = await db
      .prepare(`SELECT * FROM ${name} WHERE owner = ? AND updated_at >= ? ORDER BY updated_at ASC`)
      .bind(owner, sinceIso)
      .all();
    rows[tk] = (out.results || []).map((r) => outRow(tk, r));
  }
  const tombs = await db
    .prepare('SELECT tbl, rid, updated_at FROM nm_tomb WHERE owner = ? AND updated_at >= ? ORDER BY updated_at ASC')
    .bind(owner, sinceIso)
    .all();
  return json({
    serverTime: watermark(),
    full: false,
    rows,
    tombs: (tombs.results || []).map((t) => ({ table: t.tbl, rid: t.rid, updatedAt: t.updated_at })),
  });
}

async function applyChange(db, owner, ch) {
  const tk = ch && ch.table;
  if (!TABLE_KEYS.includes(tk)) return { ok: false, error: 'invalid_table' };
  const rid = typeof ch.rid === 'string' ? ch.rid.trim() : '';
  if (!rid || rid.length > 160) return { ok: false, error: 'invalid_rid' };
  const updatedAt = tsOf(ch.updatedAt);
  if (!updatedAt) return { ok: false, error: 'invalid_time' };

  const { name, cols } = TABLES[tk];
  const existing = await db
    .prepare(`SELECT * FROM ${name} WHERE owner = ? AND rid = ?`)
    .bind(owner, rid)
    .first();

  if (ch.deleted) {
    if (existing && String(existing.updated_at) > updatedAt) {
      return { ok: true, status: 'conflict', row: outRow(tk, existing) };
    }
    await db
      .prepare(
        `INSERT INTO nm_tomb (owner, tbl, rid, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(owner, tbl, rid) DO UPDATE SET updated_at = excluded.updated_at
         WHERE excluded.updated_at >= nm_tomb.updated_at`,
      )
      .bind(owner, tk, rid, updatedAt)
      .run();
    await db.prepare(`DELETE FROM ${name} WHERE owner = ? AND rid = ? AND updated_at <= ?`)
      .bind(owner, rid, updatedAt)
      .run();
    return { ok: true, status: 'deleted' };
  }

  const data = ch.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'invalid_data' };
  if (existing && String(existing.updated_at) > updatedAt) {
    return { ok: true, status: 'conflict', row: outRow(tk, existing) };
  }

  const values = [];
  for (const col of cols) {
    const v = asText(Object.prototype.hasOwnProperty.call(data, col) ? data[col] : '');
    if (v === null && Object.prototype.hasOwnProperty.call(data, col) && data[col] !== null && data[col] !== undefined) {
      return { ok: false, error: 'value_too_long' };
    }
    values.push(v);
  }

  const placeholders = ['?', '?', '?', '?'].concat(cols.map(() => '?')).join(',');
  const updates = ['updated_at = excluded.updated_at'].concat(cols.map((c) => `${c} = excluded.${c}`)).join(',');
  const sql = `INSERT INTO ${name} (id, owner, rid, updated_at, ${cols.join(', ')}) VALUES (${placeholders})
    ON CONFLICT(owner, rid) DO UPDATE SET ${updates}`;
  await db
    .prepare(sql)
    .bind(existing ? existing.id : crypto.randomUUID(), owner, rid, updatedAt, ...values)
    .run();
  await db.prepare('DELETE FROM nm_tomb WHERE owner = ? AND tbl = ? AND rid = ? AND updated_at <= ?')
    .bind(owner, tk, rid, updatedAt)
    .run();
  return { ok: true, status: 'applied' };
}

/* ---------- 联网热榜 ----------
   抓 B 站热搜的公开 JSON 与百度热搜的公开榜单页。两者都不需要 key。
   结果全局缓存 10 分钟：热榜本来就是分钟级更新，没必要每个账号各抓一遍。
   这个接口不读用户数据，所以放在登录校验之前，本地模式也能拿到真热搜。 */
const HOT_LIVE_TTL_MS = 10 * 60 * 1000;
const HOT_LIVE_MAX = 16;
const HOT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const hotNorm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

async function fetchHotBilibili() {
  const res = await fetch('https://s.search.bilibili.com/main/hotword', {
    headers: { 'user-agent': HOT_UA, accept: 'application/json', referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('bili_http_' + res.status);
  const data = await res.json();
  const list = Array.isArray(data && data.list) ? data.list : [];
  const out = [];
  list.forEach((it, i) => {
    if (out.length >= HOT_LIVE_MAX) return;
    const title = String((it && (it.keyword || it.show_name)) || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    out.push({
      title,
      platform: 'B站热搜',
      heat: Math.max(0, Math.round(Number(it.heat_score) || 0)),
      rank: i + 1,
    });
  });
  return out;
}

async function fetchHotBaidu() {
  const res = await fetch('https://top.baidu.com/board?tab=realtime', {
    headers: { 'user-agent': HOT_UA, accept: 'text/html', referer: 'https://top.baidu.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('baidu_http_' + res.status);
  const html = await res.text();
  const re = /<div class="category-wrap_[^"]*"[\s\S]*?<div class="c-single-text-ellipsis"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div class="hot-index_[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && out.length < HOT_LIVE_MAX) {
    const title = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({
      title,
      platform: '百度热搜',
      heat: Number(String(m[2]).replace(/\D/g, '')) || 0,
      rank: out.length + 1,
    });
  }
  return out;
}

async function readHotCache(env) {
  try {
    const row = await env.DB
      .prepare("SELECT fetched_at, payload FROM nm_hot_live WHERE id = 'global'")
      .first();
    if (!row || !row.payload) return null;
    const data = JSON.parse(row.payload);
    if (!data || !Array.isArray(data.items) || !data.items.length) return null;
    return { fetchedAt: String(row.fetched_at || data.fetchedAt || ''), ...data };
  } catch {
    return null;
  }
}

async function writeHotCache(env, payload) {
  try {
    await env.DB
      .prepare("INSERT INTO nm_hot_live (id, fetched_at, payload) VALUES ('global', ?, ?) "
        + 'ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload')
      .bind(payload.fetchedAt, JSON.stringify(payload))
      .run();
  } catch {
    /* 缓存只是省钱，写不进去也要把这一轮结果返回给页面 */
  }
}

async function collectHotLive() {
  const settled = await Promise.allSettled([fetchHotBilibili(), fetchHotBaidu()]);
  const sources = [];
  const errors = [];
  const byTitle = new Map();
  settled.forEach((r, i) => {
    const name = i === 0 ? 'B站热搜' : '百度热搜';
    if (r.status === 'fulfilled') {
      sources.push(name);
      for (const it of r.value) {
        const key = hotNorm(it.title);
        const prev = byTitle.get(key);
        if (!prev || it.heat > prev.heat) byTitle.set(key, it);
      }
    } else {
      errors.push(String((r.reason && r.reason.message) || 'fetch_failed').slice(0, 80));
    }
  });

  const items = [...byTitle.values()].sort((a, b) => b.heat - a.heat).slice(0, 40);
  if (!items.length) return { payload: null, errors };
  return { payload: { fetchedAt: new Date().toISOString(), items, sources }, errors };
}

/* 定时任务（wrangler.jsonc 的 crons）用它把全局缓存焐热，用户请求就不用等外部接口。 */
export async function refreshHotLive(env) {
  const { payload, errors } = await collectHotLive();
  try {
    await env.DB
      .prepare("INSERT INTO nm_hot_live (id, fetched_at, payload) VALUES ('diag', ?, ?) "
        + 'ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload')
      .bind(new Date().toISOString(), JSON.stringify({ ok: !!payload, errors, count: payload ? payload.items.length : 0 }))
      .run();
  } catch { /* 诊断行写不进去不影响主流程 */ }
  if (payload) await writeHotCache(env, payload);
  return payload;
}

async function handleHotLive(env) {
  const cached = await readHotCache(env);
  if (cached && Date.now() - Date.parse(cached.fetchedAt || 0) < HOT_LIVE_TTL_MS) {
    return json({ ...cached, cached: true, stale: false, errors: [] });
  }

  const { payload, errors } = await collectHotLive();
  if (!payload) {
    if (cached) return json({ ...cached, cached: true, stale: true, errors });
    return json({ error: 'hot_sources_unavailable', errors }, 502);
  }
  await writeHotCache(env, payload);
  return json({ ...payload, cached: false, stale: false, errors });
}

async function handlePush(db, owner, request) {
  const body = await readBody(request);
  if (!body || !Array.isArray(body.changes) || body.changes.length > MAX_CHANGES) {
    return json({ error: 'invalid_request' }, 400);
  }
  const applied = [];
  for (const ch of body.changes) {
    try {
      const res = await applyChange(db, owner, ch);
      if (!res.ok) return json({ error: res.error || 'invalid_request' }, 400);
      applied.push({ table: ch.table, rid: ch.rid, status: res.status, row: res.row });
    } catch {
      return json({ error: 'database_request_failed' }, 503);
    }
  }
  return json({ ok: true, serverTime: new Date().toISOString(), applied });
}

export async function handleNewmedia({ request, env, url }) {
  if (request.method === 'GET' && url.pathname === '/api/nm/hot/live') {
    return handleHotLive(env);
  }

  const user = await getUserFromRequest(env.DB, request);
  if (!user) return json({ error: 'login_required' }, 401);
  const owner = user.user_id;

  if (request.method === 'GET') {
    if (url.pathname === '/api/nm/snapshot') {
      const data = await snapshot(env.DB, owner);
      return json({ full: true, ...data });
    }
    if (url.pathname === '/api/nm/pull') return handlePull(env.DB, owner, url);
    return json({ error: 'not_found' }, 404);
  }
  if (request.method === 'POST' && url.pathname === '/api/nm/push') {
    return handlePush(env.DB, owner, request);
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return json({ error: 'not_found' }, 404);
}
