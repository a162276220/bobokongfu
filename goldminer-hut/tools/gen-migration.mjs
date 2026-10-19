/* 从 functions/schema.mjs 生成 13 张云表的迁移 SQL 与访问策略。
   生成的 migration.json 供站点 MCP 的 create_database_migration 使用；
   这里只做“把已定稿的结构翻译成平台支持的 DDL 子集”，不连接任何云端。

   平台迁移子集约束（逐条对照过）：
   - 类型只用 text / boolean / uuid / timestamptz —— 没有 numeric，故数值列也存 text；
   - 列名全 ASCII（中文键 ↔ 列名的翻译在 handler 里），避免中文标识符；
   - 业务列可空、无默认值：某行没填的字段就是 NULL；
   - 语句只用 CREATE TABLE app.<t> 与 CREATE INDEX <idx> ON app.<t> (cols)；
   - UNIQUE 加在列级（rid），供 handler 的 upsert(onConflict) 使用。 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TABLE_KEYS, tableDef, ddlStatements, indexStatements, accountDdl } from '../functions/schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/* --d1：产出给 `wrangler d1 migrations apply` 用的 D1 方言迁移。
   内容是 13 张业务表 + (owner, updated_at) 索引 + 账号表；全部 IF NOT EXISTS，可重复执行。 */
if (process.argv.includes('--d1')) {
  const dir = join(here, '..', 'migrations');
  mkdirSync(dir, { recursive: true });
  const statements = [...ddlStatements(), ...indexStatements(), ...accountDdl()];
  const file = join(dir, '0001_init.sql');
  writeFileSync(file, statements.map((s) => s + ';').join('\n\n') + '\n', 'utf8');
  console.log('D1 迁移:', file);
  console.log('语句数:', statements.length, '| 业务表:', TABLE_KEYS.length);
  process.exit(0);
}

const lines = [];
for (const tk of TABLE_KEYS) {
  const cols = tableDef(tk)
    .map(({ col, bool }) => `  ${col} ${bool ? 'boolean' : 'text'}`)
    .join(',\n');
  lines.push(
    `CREATE TABLE app.${tk} (\n` +
    `  id uuid PRIMARY KEY,\n` +
    `  owner text NOT NULL,\n` +
    `  rid text NOT NULL,\n` +
    `  updated_at timestamptz NOT NULL,\n` +
    `${cols}\n` +
    `);`
  );
  lines.push(`CREATE UNIQUE INDEX ${tk}_owner_rid_u ON app.${tk} (owner, rid);`);
}
const sql = lines.join('\n');

// 访问策略是“涉及到的每张表的完整托管状态”。这里给 app Function 的匿名调用面
// 开 CRUD —— 适配器用的是 anonymous + x-instance-id，不开就没有任何表可用。
// 注意：这等于让持有凭据的一方能读整表，行级归属只靠 handler 的 owner 过滤，
// 不是数据库级 RLS。该边界已获用户明确接受。
const accessPolicies = TABLE_KEYS.map((table) => ({
  table,
  principal: 'anonymous',
  actions: ['select', 'insert', 'update', 'delete'],
  template: 'public',
}));

const out = {
  displayName: '创建工作台 13 张业务表',
  sql,
  accessPolicies,
};
writeFileSync(join(here, 'migration.json'), JSON.stringify(out, null, 2), 'utf8');

console.log('表数:', TABLE_KEYS.length, '| DDL 语句数:', lines.length);
console.log('SQL 长度:', sql.length, '字符');
console.log('--- SQL ---');
console.log(sql);
console.log('--- accessPolicies ---');
console.log(JSON.stringify(accessPolicies, null, 2));