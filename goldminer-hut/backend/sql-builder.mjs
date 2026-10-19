/* PostgREST 形状的链式 Builder —— SQLite 与 D1 两个适配器共用的唯一一份 SQL 构建逻辑。
   只实现 handler 真正用到的四种链式形状：
     .from(t).select(cols).eq().order().order().range()  → { data: [row], error }
     .from(t).delete().eq().eq()                          → { data: null, error }
     .from(t).update(patch).eq().eq().select('id')        → { data: [row], error }
     .from(t).upsert(row, { onConflict: 'owner,rid' })    → { error }

   执行器接口（同步或异步实现都可以，Builder 一律 await）：
     executor.all(sql, params) -> rows[]
     executor.run(sql, params) -> { changes }

   表名与列名一律按 schema.mjs 白名单校验后才拼进 SQL（标识符不能参数化），
   值全部走占位符绑定。勾选列存 0/1，读回时还原成真布尔。 */

import { TABLE_KEYS, tableDef } from '../functions/schema.mjs';

const boolColsOf = new Map();
const allowedColsOf = new Map();
for (const tk of TABLE_KEYS) {
  const def = tableDef(tk);
  boolColsOf.set(tk, new Set(def.filter((d) => d.bool).map((d) => d.col)));
  allowedColsOf.set(tk, new Set(['id', 'owner', 'rid', 'updated_at', ...def.map((d) => d.col)]));
}
const TABLE_SET = new Set(TABLE_KEYS);
const isTable = (t) => typeof t === 'string' && TABLE_SET.has(t);
const isCol = (tk, c) => allowedColsOf.get(tk) && allowedColsOf.get(tk).has(c);

const bind = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);
const qq = (cols) => cols.map((c) => `"${c}"`).join(', ');

function normalize(row, bools) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = bools.has(k) ? !!v : v;
  return out;
}

class Builder {
  constructor(executor, table) {
    this.executor = executor;
    this.table = table;
    this.mode = 'select';
    this.cols = null;
    this.payload = null;
    this.conflict = null;
    this.filters = [];
    this.orders = [];
    this.limit = null;
    this.offset = null;
  }

  select(cols) {
    if (this.mode !== 'update' && this.mode !== 'insert' && this.mode !== 'upsert') this.mode = 'select';
    this.cols = typeof cols === 'string'
      ? cols.split(',').map((c) => c.trim()).filter(Boolean)
      : null;
    return this;
  }

  eq(col, value) { this.filters.push([col, value]); return this; }

  order(col, opts) {
    const asc = !opts || opts.ascending !== false;
    this.orders.push([col, asc ? 'ASC' : 'DESC']);
    return this;
  }

  range(from, to) { this.offset = from; this.limit = to - from + 1; return this; }

  insert(row) { this.mode = 'insert'; this.payload = row; return this; }
  upsert(row, opts) { this.mode = 'upsert'; this.payload = row; this.conflict = (opts && opts.onConflict) || null; return this; }
  update(patch) { this.mode = 'update'; this.payload = patch; return this; }
  delete() { this.mode = 'delete'; this.payload = null; return this; }

  // supabase-js 的 builder 是 thenable：await 才真正发请求。这里对齐同一时机。
  then(onFulfilled, onRejected) {
    return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
  }

  async run() {
    const tk = this.table;
    const bools = boolColsOf.get(tk);
    const whereSql = this.filters.length
      ? ' WHERE ' + this.filters.map(([c]) => `"${c}" = ?`).join(' AND ')
      : '';
    const whereArgs = this.filters.map(([, v]) => bind(v));
    const read = async (want) => {
      const orderSql = this.orders.length
        ? ' ORDER BY ' + this.orders.map(([c, dir]) => `"${c}" ${dir}`).join(', ')
        : '';
      const pageArgs = [];
      let pageSql = '';
      if (this.limit !== null) { pageSql = ' LIMIT ? OFFSET ?'; pageArgs.push(this.limit, this.offset); }
      const sql = `SELECT ${want.map((c) => `"${c}"`).join(', ')} FROM "${tk}"${whereSql}${orderSql}${pageSql}`;
      const rows = await this.executor.all(sql, [...whereArgs, ...pageArgs]);
      return { data: rows.map((r) => normalize(r, bools)), error: null };
    };

    if (this.mode === 'select') return read(this.cols || Array.from(allowedColsOf.get(tk)));

    // update 之后可能还要回读（handler 用 .select('id') 判断有没有真的改到行，
    // 0 行要回 409 让客户端退回 insert 重建），所以必须先写再读。
    if (this.mode === 'update') {
      const sets = Object.keys(this.payload);
      const sql = `UPDATE "${tk}" SET ${sets.map((c) => `"${c}" = ?`).join(', ')}${whereSql}`;
      await this.executor.run(sql, [...sets.map((c) => bind(this.payload[c])), ...whereArgs]);
      return this.cols ? read(this.cols) : { data: null, error: null };
    }

    if (this.mode === 'delete') {
      await this.executor.run(`DELETE FROM "${tk}"${whereSql}`, whereArgs);
      return { data: null, error: null };
    }

    // insert / upsert
    const cols = Object.keys(this.payload);
    const values = cols.map((c) => bind(this.payload[c]));
    const insertSql = `INSERT INTO "${tk}" (${qq(cols)}) VALUES (${cols.map(() => '?').join(', ')})`;
    if (this.mode === 'insert') {
      await this.executor.run(insertSql, values);
      return { data: null, error: null };
    }
    const targets = (this.conflict || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!targets.length) throw new Error('upsert_requires_on_conflict');
    for (const c of targets) if (!isCol(tk, c)) throw new Error('unknown_column');
    const updates = cols.filter((c) => !targets.includes(c));
    const conflictSql = ` ON CONFLICT (${qq(targets)}) DO ` + (updates.length
      ? `UPDATE SET ${updates.map((c) => `"${c}" = excluded."${c}"`).join(', ')}`
      : 'NOTHING');
    await this.executor.run(insertSql + conflictSql, values);
    return { data: null, error: null };
  }
}

// 任何标识符先过白名单，再交给 Builder 拼 SQL —— 表名/列名来自 handler，
// 但自建后端可能直接暴露在公网上，这里不赌上游一定干净。
function guard(builder) {
  return new Proxy(builder, {
    get(target, prop) {
      const value = target[prop];
      if (prop === 'eq') {
        return (col, v) => { if (!isCol(target.table, col)) throw new Error('unknown_column'); return target.eq(col, v); };
      }
      if (prop === 'order') {
        return (col, o) => { if (!isCol(target.table, col)) throw new Error('unknown_column'); return target.order(col, o); };
      }
      if (prop === 'select') {
        return (cols) => {
          if (typeof cols === 'string') {
            for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
              if (!isCol(target.table, c)) throw new Error('unknown_column');
            }
          }
          return target.select(cols);
        };
      }
      if (prop === 'update' || prop === 'insert' || prop === 'upsert') {
        return (payload, opts) => {
          if (!payload || typeof payload !== 'object') throw new Error('invalid_payload');
          for (const c of Object.keys(payload)) if (!isCol(target.table, c)) throw new Error('unknown_column');
          return value.call(target, payload, opts);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/* 给一个执行器，返回 `.from(table)`。表名不在白名单里直接抛 unknown_table。 */
export function createTableFactory(executor) {
  return function from(table) {
    if (!isTable(table)) throw new Error('unknown_table');
    return guard(new Builder(executor, table));
  };
}
