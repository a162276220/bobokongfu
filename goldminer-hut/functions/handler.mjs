// 工作台数据面：13 张业务表的 query / insert / update / delete。
// 只有本 Function 能碰云库；浏览器侧把这里的 HTTP 契约重新包成旧数据库对象的形状，
// 所以客户端的 qAll / doPull / doPush 与 EXTRACT / APPLY 一行都不用改。
//
// 契约（列名保持中文，中文键 ↔ ASCII 列名的翻译在 schema.mjs 里）：
//   GET  ?action=query&table=<tk>&cursor=<n>
//        → { results: [ { _id, rid, updatedAt, <中文列名>: oneof 包装 } ], hasMore, nextCursor }
//   POST { action: 'insert' | 'update' | 'delete', table, recordId?, properties? }
//        → { ok: true }
//
// 所有权：owner 一律取自宿主注入的身份（getUser），客户端传什么都不作数。
// Qoder 站点用网关校验过的 requireUser；自建后端用 bearer 令牌自己解析。
// 隔离强度是“应用层过滤 + 私有站点/令牌”，不是数据库级 RLS —— 见交付说明。

import { UserContextError } from './auth.mjs';
import { TABLES, tableDef } from './schema.mjs';

const PAGE_SIZE = 500;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_VALUE_CHARS = 200000;

const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

// 与客户端 pv() 同一套 oneof 解包规则，保证往返值一致。
function pv(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of ['text', 'number', 'checkbox', 'select', 'date']) {
      if (k in v) return v[k];
    }
  }
  return v;
}

// properties（中文键 + oneof 包装）→ 云库行（ASCII 列）。
// 只接受 schema 里声明过的列，id / owner / updated_at 永远不由请求决定。
function toRow(tk, properties, { owner, rowId, updatedAt }) {
  const row = { id: rowId, owner, updated_at: updatedAt };
  let rid = null;
  if (Object.prototype.hasOwnProperty.call(properties, 'rid')) {
    const rawRid = pv(properties.rid);
    rid = rawRid === undefined || rawRid === null ? null : String(rawRid);
  }
  if (rid) row.rid = rid;
  for (const { chinese, col, bool } of tableDef(tk)) {
    if (!Object.prototype.hasOwnProperty.call(properties, chinese)) continue;
    const raw = pv(properties[chinese]);
    if (raw === undefined || raw === null) { row[col] = null; continue; }
    if (bool) { row[col] = !!raw; continue; }
    const s = String(raw);
    if (s.length > MAX_VALUE_CHARS) throw new Error('value_too_long');
    // 业务数值也存 text：平台的迁移 SQL 子集没有 numeric，客户端用 num() 还原。
    row[col] = s;
  }
  return { row, rid };
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('body_too_large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('body_too_large');
  const body = JSON.parse(text);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
  return body;
}

async function handleQuery({ request, db, owner, tk }) {
  const raw = new URL(request.url).searchParams.get('cursor');
  const cursor = raw === null || raw === '' ? 0 : Number(raw);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return json({ error: 'invalid_cursor' }, 400);

  const cols = ['id', 'rid', 'updated_at', ...tableDef(tk).map((d) => d.col)];
  // 多取一行判断还有没有下一页；range 两端都含。
  const { data, error } = await db
    .from(tk)
    .select(cols.join(','))
    .eq('owner', owner)
    .order('rid', { ascending: true })
    .order('id', { ascending: true })
    .range(cursor, cursor + PAGE_SIZE);
  if (error || !Array.isArray(data)) return json({ error: 'database_request_failed' }, 503);

  const hasMore = data.length > PAGE_SIZE;
  const rows = hasMore ? data.slice(0, PAGE_SIZE) : data;
  const results = rows.map((r) => {
    const out = { _id: { text: r.id }, rid: { text: r.rid } };
    const ts = Date.parse(r.updated_at);
    if (Number.isFinite(ts)) out.updatedAt = { number: ts };
    for (const { chinese, col, bool } of tableDef(tk)) {
      const v = r[col];
      if (v === undefined || v === null) continue; // 客户端 rowCols 同样跳过空值
      out[chinese] = bool ? { checkbox: !!v } : { text: String(v) };
    }
    return out;
  });
  return json({ results, hasMore, nextCursor: hasMore ? cursor + PAGE_SIZE : null });
}

async function handleWrite({ request, db, owner, tk }) {
  const body = await readBody(request);
  const action = body.action;
  if (action !== 'insert' && action !== 'update' && action !== 'delete') {
    return json({ error: 'not_found' }, 404);
  }
  const now = new Date().toISOString();

  if (action === 'delete') {
    const recordId = pv(body.recordId);
    if (typeof recordId !== 'string' || !recordId) return json({ error: 'invalid_request' }, 400);
    // 删除是幂等的：命中 0 行也回 ok。这里与 update 故意不对称 —— update 命中 0 行必须回 409，
    // 因为「假装成功」会让客户端以为云端已经有了那个值；而 delete 的目标状态（这行不在）本就已达成。
    const { error } = await db.from(tk).delete().eq('id', recordId).eq('owner', owner);
    return error ? json({ error: 'database_request_failed' }, 503) : json({ ok: true });
  }

  if (action === 'update') {
    const recordId = pv(body.recordId);
    if (typeof recordId !== 'string' || !recordId) return json({ error: 'invalid_request' }, 400);
    const properties = body.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      return json({ error: 'invalid_request' }, 400);
    }
    const { row } = toRow(tk, properties, { owner, rowId: recordId, updatedAt: now });
    const patch = { ...row };
    delete patch.id;
    delete patch.owner;
    const { data, error } = await db
      .from(tk)
      .update(patch)
      .eq('id', recordId)
      .eq('owner', owner)
      .select('id');
    if (error) return json({ error: 'database_request_failed' }, 503);
    // 没改到任何行（例如别的设备删了它）必须报错：客户端会退回 insert 重建，
    // 若这里假装成功，则该行会在下一次 pull 时被当成“云端已删”而从本机抹掉。
    if (!Array.isArray(data) || data.length === 0) return json({ error: 'record_not_found' }, 409);
    return json({ ok: true });
  }

  // insert：按 (owner, rid) 幂等 upsert。更新失败后的重建走的就是这条路，
  // 独占键保证它不会写出第二份同 rid 的行。
  const properties = body.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { row, rid } = toRow(tk, properties, { owner, rowId: crypto.randomUUID(), updatedAt: now });
  if (!rid) return json({ error: 'invalid_request' }, 400);
  const { error } = await db.from(tk).upsert(row, { onConflict: 'owner,rid' });
  return error ? json({ error: 'database_request_failed' }, 503) : json({ ok: true });
}

export async function handleApp({ request, db, getUser }) {
  let owner;
  try {
    owner = getUser(request).user_id;
  } catch (e) {
    // 必须在这里消化掉：抛出去的 UserContextError 会被适配器当成未知故障换成 503，
    // 401/403 的语义就丢了。
    if (e instanceof UserContextError) return json({ error: e.code }, e.status);
    return json({ error: 'not_found' }, 404);
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
  }

  const table = new URL(request.url).searchParams.get('table')
    || (request.method === 'POST' ? (await request.clone().json().catch(() => ({}))).table : null);
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(TABLES, table)) {
    return json({ error: 'not_found' }, 404);
  }

  try {
    if (request.method === 'GET') {
      if (new URL(request.url).searchParams.get('action') !== 'query') {
        return json({ error: 'not_found' }, 404);
      }
      return await handleQuery({ request, db, owner, tk: table });
    }
    return await handleWrite({ request, db, owner, tk: table });
  } catch (e) {
    const code = e && e.message;
    if (code === 'invalid_body' || code === 'invalid_request' || code === 'value_too_long') {
      return json({ error: 'invalid_request' }, 400);
    }
    if (code === 'body_too_large') return json({ error: 'payload_too_large' }, 413);
    // 不把 provider 原始错误、租户 ID、请求 URL 或凭据写进日志或响应。
    return json({ error: 'database_request_failed' }, 503);
  }
}