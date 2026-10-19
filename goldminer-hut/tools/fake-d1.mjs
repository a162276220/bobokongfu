/* 用 node:sqlite 顶出来的假 D1 绑定 —— 让 D1 适配器能进现有测试环境。
   真 D1 的 API 形状：`prepare(sql).bind(...).all()/run()/first()`，全部异步；
   `run()` 返回 `{ success, meta: { changes } }`，`all()` 返回 `{ results, success }`。
   只实现适配器与迁移测试用到的那部分。 */

import { DatabaseSync } from 'node:sqlite';

export function fakeD1(file = ':memory:', ddl = []) {
  const raw = new DatabaseSync(file);
  for (const stmt of ddl) raw.exec(stmt);

  const prepare = (sql) => {
    let params = [];
    const statement = {
      bind(...args) { params = args; return statement; },
      async all() {
        return { results: raw.prepare(sql).all(...params), success: true, meta: {} };
      },
      async run() {
        const info = raw.prepare(sql).run(...params);
        return {
          success: true,
          meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
        };
      },
      async first(col) {
        const row = raw.prepare(sql).get(...params) ?? null;
        return col && row ? row[col] : row;
      },
    };
    return statement;
  };

  return {
    prepare,
    async exec(sql) { raw.exec(sql); return { count: 0, duration: 0 }; },
    close() { raw.close(); },
  };
}
