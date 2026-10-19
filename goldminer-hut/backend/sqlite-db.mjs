/* SQLite 版适配器 —— 让同一份 handler.mjs 不改动就能跑在自建后端上。
   链式 Builder 与白名单校验都在 sql-builder.mjs（与 D1 适配器共用一份），
   这里只负责把 node:sqlite 的同步 API 包成执行器、并建表。 */

import { DatabaseSync } from 'node:sqlite';
import { ddlStatements } from '../functions/schema.mjs';
import { createTableFactory } from './sql-builder.mjs';

export function openDb(file = ':memory:') {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  for (const stmt of ddlStatements()) raw.exec(stmt);

  const executor = {
    all: async (sql, params) => raw.prepare(sql).all(...params),
    run: async (sql, params) => raw.prepare(sql).run(...params),
  };

  return {
    from: createTableFactory(executor),
    close() { raw.close(); },
    _raw: raw,
  };
}
