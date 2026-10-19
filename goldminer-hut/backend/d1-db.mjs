/* D1 版适配器 —— 第三次兑现「后端可插拔」：handler.mjs 一行不改就能跑在 D1 上。
   链式 Builder 与白名单校验都在 sql-builder.mjs（与 SQLite 适配器共用一份），
   这里只负责把 D1 的异步 API 包成执行器。
   建表不在这里做：D1 的表由 migrations/ 下的迁移负责。 */

import { createTableFactory } from './sql-builder.mjs';

export function openDb(d1) {
  const executor = {
    all: async (sql, params) => {
      const out = await d1.prepare(sql).bind(...params).all();
      return out && out.results ? out.results : [];
    },
    run: async (sql, params) => {
      const out = await d1.prepare(sql).bind(...params).run();
      return (out && out.meta) || {};
    },
  };

  return {
    from: createTableFactory(executor),
    close() {},
  };
}
