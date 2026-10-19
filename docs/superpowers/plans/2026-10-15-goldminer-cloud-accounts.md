# 淘金矿工小屋多账号云同步（子项目 A：A0 + A1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `file://` 单机工作台改造成 Cloudflare Workers + D1 上的多账号系统：自建用户名/密码 + 邀请码注册，13 张业务表按 `owner` 隔离，站点与 `file://` 两个入口都能用。

**Architecture:** 沿用现有「可插拔宿主」设计——`functions/handler.mjs` 只依赖注入的 `db`（PostgREST 形状）与 `getUser(request)`。本次是第三次兑现：新增 D1 版 `db` 适配器与基于会话的 `getUser`，**handler 的身份逻辑零改动**；前端同步层的对账算法不动，只把硬编码的 `/functions/v1/app` 抽成可配置的 `API_BASE` 并加认证分支。

**Tech Stack:** Cloudflare Workers + D1 + Workers Static Assets；原生 JS（无打包器）；Node 24 内置 `node:sqlite`（测试用假 D1 绑定）；pytest 作为仓库唯一测试入口。

**Spec:** `docs/superpowers/specs/2026-10-15-goldminer-cloud-accounts-design.md`

**范围说明：** 本计划只覆盖 spec 的 **A0（spike + 环境）+ A1（地基）**。A2（墓碑 + `since` 增量拉取）、A3（运维）、子项目 B（社交）各自另开计划。

## Global Constraints

- 平台固定 Cloudflare Workers + D1 + Workers Static Assets（spec §2、§4.1）。
- **不改** 13 表契约、`EXTRACT`/`APPLY`、`doPull`/`doPush` 的对账算法（spec §1.3）。
- **不引入前端构建流程**：工作台仍是单文件 HTML + 原生 JS，`dist/` 仍由 `tools/build-dist.mjs` 拷贝产出。不引入打包器、TypeScript、框架（spec §1.3）。
- 界面文案与代码注释一律中文（spec §2）。
- 业务值一律存 text，勾选列 boolean；单值上限 `MAX_VALUE_CHARS = 200000`；请求体上限 1 MiB（`handler.mjs`）。
- 错误码语义沿用：401 `login_required`、403 `invalid_user_context`、409 `record_not_found`、413 `payload_too_large`、503 `database_request_failed`。
- 站点会话 cookie 必须 `HttpOnly; Secure; SameSite=Lax`（spec §5.3）。
- 所有业务路由的 `owner` **只从会话解析**，客户端传什么都不作数（spec §5.4）。
- A1 轮询间隔 **60s** 且 `document.hidden` 时暂停（两条必须同时做，spec §6.2）。
- 13 表 DDL 的**唯一真源**是 `functions/schema.mjs`，`sqlite-db.mjs` 与 D1 适配器都从它取（避免方言漂移）。
- 测试入口：`python -m pytest -q`（仓库唯一入口）；node 套件经 pytest 包装，用 `shutil.which('node')` 探测，缺 node 时 `pytest.skip`。
- **环境事实（实测）**：本会话的沙箱**拒绝写工作区内 `.git` 子树**（`.git`、`.git\refs`、`.git\objects` 全部 `Permission denied`，而工作区根可写；`.git` 的 ACL 本身已含沙箱令牌的 `S-1-4-…:(OI)(WC,DC)` 授权，无拒绝项，属路径规则而非权限缺口）。因此每个任务的 `git commit` 步骤在本会话会失败——执行者应把提交步骤标为「待用户在沙箱外执行」，或让用户把会话切到完全权限后补提交；**不要**为此修改 `.git` 权限。

## Review Focus

以下五类是 spec 隐含、但容易漏测、且一漏就会伤到真实用户的输入/状态。每条都在对应任务的测试里钉住。

1. **用户名边界**（空、超长、中文、emoji、含空格）——应给出可读的拒绝或正常受理，不能 500（Task 5）。
2. **邀请码复用/过期**——已用过、已过期、不存在的码都要拒绝，且**失败时不留下半个账号**（Task 5）。
3. **同一账号多设备同时登录**——两个会话都要有效、互不踢掉；登出只失效自己那一个（Task 5）。
4. **过期/伪造的会话**——必须 401 `login_required`，前端回到未登录态并停止重试，不能死循环打服务端（Task 5、Task 6）。
5. **`API_BASE` 填错**（末尾斜杠、缺协议、指向不可达主机）——必须给出可读错误并保持本地模式可用，不能白屏或无限重试（Task 9）。

---

## File Structure

**新增**

| 路径 | 职责 |
|---|---|
| `goldminer-hut/package.json` | 仅放 devDependencies（wrangler）与 dev/deploy/migrate 脚本；**不参与前端构建** |
| `goldminer-hut/wrangler.jsonc` | Worker 配置：assets 指向 `dist/`、D1 绑定 `DB`、`run_worker_first: ["/api/*"]` |
| `goldminer-hut/functions/worker.mjs` | Worker 入口：`/api/auth/*` → session；`/api/*` → handleApp；其余 → ASSETS |
| `goldminer-hut/functions/session.mjs` | 账号/会话/邀请码：密码哈希、会话签发与解析、AuthError |
| `goldminer-hut/backend/d1-db.mjs` | D1 版 `db` 适配器（与 `sqlite-db.mjs` 同契约） |
| `goldminer-hut/tools/fake-d1.mjs` | 用 `node:sqlite` 顶的假 D1 绑定（`prepare/bind/all/run/first`），供测试 |
| `goldminer-hut/migrations/0001_init.sql` | D1 迁移：13 业务表 + 账号表 + 索引 |
| `goldminer-hut/tools/mint-invite.mjs` | 生成邀请码（写 D1） |
| `goldminer-hut/README.md` | 部署步骤、发邀请码、token 风险、额度注意 |
| `tests/goldminer-cloud-harness.mjs` | node 套件：迁移、session、worker、跨账号隔离 |
| `tests/goldminer-sync-harness.mjs` | node 套件：从 HTML 抽出同步层 IIFE，在 vm 里验证请求与登录序列 |
| `tests/test_goldminer_cloud.py` | pytest 包装：跑上面两个 node 套件与 `selftest.mjs` |

**修改**

| 路径 | 改动 |
|---|---|
| `goldminer-hut/functions/schema.mjs` | 新增 `ddlStatements()`（13 表 DDL 单一真源）与账号表定义 |
| `goldminer-hut/backend/sqlite-db.mjs` | DDL 改为调用 `schema.ddlStatements()`（行为不变） |
| `goldminer-hut/tools/selftest.mjs` | 新增 `d1Host()` 并加入第 295 行宿主列表；新增经会话的跨账号断言 |
| `goldminer-hut/tools/gen-migration.mjs` | 新增 `--d1` 模式产出 `migrations/0001_init.sql` |
| `淘金矿工小屋/淘金矿工小屋·自律工作台.html` | 第 4030–4033、4315–4340 行（传输层）；第 4540–4559 行（init/轮询）；新增登录覆盖层与侧边栏账号区 |
| `.gitignore` | 忽略 `.npm-cache/`、`.acl-recovery/`、`goldminer-hut/.wrangler/` |

---

### Task 1: PBKDF2 CPU 预算 spike（A0）

**Files:**
- Create: `goldminer-hut/tools/spike-pbkdf2/worker.mjs`
- Modify: `docs/superpowers/specs/2026-10-15-goldminer-cloud-accounts-design.md`（§5.2 决策行）

**Interfaces:**
- Consumes: 无
- Produces: 一个确定的迭代次数常量（Task 5 用它写进 `session.mjs`）

- [ ] **Step 1: 写探针 worker**

`export default { fetch(request) }`：读 `?iters=`，用 `crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations, hash:'SHA-256'}, key, 256)`，返回 `{ iters, ms: performance.now() - t0 }`。

- [ ] **Step 2: 本地起 Worker 并打 100 次**

Run: `cd goldminer-hut && npm run dev`（wrangler dev），另开一个 shell：
`for i in $(seq 100); do curl -s "http://127.0.0.1:8787/kdf?iters=100000"; echo; done | tail -20`

- [ ] **Step 3: 记录结果**

记录三项：是否出现错误 1102（CPU 超限）、挂钟耗时 p50 / p95。若 wrangler 装不上（npm cache EPERM），先设 `npm_config_cache=D:\桌宠\.npm-cache` 再重试；仍失败则记为阻塞并停下来问用户。

- [ ] **Step 4: 按 spec §5.2 三分支写决策**

把选定的分支与迭代次数写进 spec §5.2（`通过 → 100k`；`不通过 → 10k + pepper` 或 `挪进 Durable Object` 或 `升级付费版`），并把实测数字一并记入。

- [ ] **Step 5: 提交**

```bash
git add goldminer-hut/tools/spike-pbkdf2 docs/superpowers/specs/2026-10-15-goldminer-cloud-accounts-design.md
git commit -m "spike: measure PBKDF2 CPU budget in Workers and pin the iteration count"
```

---

### Task 2: 把数据面自测接进 pytest（回归闸门）

**Files:**
- Create: `tests/test_goldminer_cloud.py`

**Interfaces:**
- Consumes: `goldminer-hut/tools/selftest.mjs`（退出码 0 = 全过，见其第 305 行）
- Produces: `run_node(script) -> CompletedProcess`，后续任务复用它跑 node 套件

- [ ] **Step 1: 写测试**

```python
NODE = shutil.which('node')
def run_node(script):
    if not NODE:
        pytest.skip('node is not on PATH')
    return subprocess.run([NODE, str(ROOT / script)], capture_output=True, text=True, encoding='utf-8')

def test_data_plane_selftest_passes():
    proc = run_node('goldminer-hut/tools/selftest.mjs')
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    assert '全部通过' in proc.stdout
```

- [ ] **Step 2: 运行**

Run: `python -m pytest tests/test_goldminer_cloud.py -q`
Expected: PASS。这条是回归闸门而非新行为——它应当直接通过；若失败，说明 `selftest.mjs` 在当前环境下本来就红，先修到绿再继续。

- [ ] **Step 3: 提交**

```bash
git add tests/test_goldminer_cloud.py
git commit -m "test: run the data plane selftest from the single pytest entry point"
```

---

### Task 3: D1 适配器 + DDL 单一真源

**Files:**
- Modify: `goldminer-hut/functions/schema.mjs`、`goldminer-hut/backend/sqlite-db.mjs:169-178`
- Create: `goldminer-hut/tools/fake-d1.mjs`、`goldminer-hut/backend/d1-db.mjs`
- Modify: `goldminer-hut/tools/selftest.mjs:295`

**Interfaces:**
- Consumes: `schema.mjs` 的 `TABLE_KEYS`、`tableDef(tk)`
- Produces:
  - `schema.ddlStatements() -> string[]`（13 表的 CREATE TABLE + 唯一索引）
  - `fakeD1(file = ':memory:') -> { prepare(sql) -> { bind(...args) -> { all(), run(), first() } }, exec(sql), close() }`；`run()` 返回 `{ success: true, meta: { changes } }`，`all()` 返回 `{ results: [...], success: true }`
  - `d1-db.openDb(d1) -> { from(table) -> Builder, close() }`，Builder 与 `sqlite-db.mjs` 同形状（`select/eq/order/range/insert/upsert/update/delete` 且 thenable）
  - `selftest.mjs` 新增 `d1Host() -> { name, db, getUser, rows(tk), globalUniqueRid, queries(), close() }`

- [ ] **Step 1: 把 DDL 搬进 schema.mjs**

新增 `export function ddlStatements()`，内容与 `sqlite-db.mjs:169-178` 的 `DDL` 逐字一致；`sqlite-db.mjs` 改为 `for (const stmt of ddlStatements()) raw.exec(stmt);`。

- [ ] **Step 2: 运行既有自测，确认重构无行为变化**

Run: `node goldminer-hut/tools/selftest.mjs`
Expected: `全部通过`（两个宿主都绿，退出码 0）。

- [ ] **Step 3: 写假 D1 绑定**

`fake-d1.mjs` 用 `node:sqlite` 的 `DatabaseSync` 实现上表的四个方法；`prepare(sql)` 返回可 `bind(...)` 的语句对象，`all()` 用 `.all()`、`run()` 用 `.run()` 并把它返回的 `changes` 放进 `meta`。

- [ ] **Step 4: 在 selftest 里加第三个宿主，先看它失败**

`d1Host()` 用 `fakeD1()` + `d1-db.openDb()`；`rows(tk)` 读全列；`globalUniqueRid: true`；把它加进第 295 行的宿主列表。
Run: `node goldminer-hut/tools/selftest.mjs`
Expected: FAIL —— `Cannot find module '../backend/d1-db.mjs'`。

- [ ] **Step 5: 实现 `backend/d1-db.mjs`**

照 `sqlite-db.mjs` 的 Builder 与 `guard()` 白名单策略实现，差异只在执行：`update` 的「0 行命中」用 `meta.changes === 0` 判定并返回 `data: []`（handler 据此回 409），不必像 SQLite 版那样回读。

- [ ] **Step 6: 运行，三个宿主全绿**

Run: `node goldminer-hut/tools/selftest.mjs`
Expected: 三行宿主小结 + `全部通过`。

- [ ] **Step 7: 提交**

```bash
git add goldminer-hut/functions/schema.mjs goldminer-hut/backend/sqlite-db.mjs goldminer-hut/backend/d1-db.mjs goldminer-hut/tools/fake-d1.mjs goldminer-hut/tools/selftest.mjs
git commit -m "feat: add the D1 adapter as the third pluggable host"
```

---

### Task 4: 账号表 DDL 与 D1 迁移文件

**Files:**
- Modify: `goldminer-hut/functions/schema.mjs`、`goldminer-hut/tools/gen-migration.mjs`
- Create: `goldminer-hut/migrations/0001_init.sql`
- Create: `tests/goldminer-cloud-harness.mjs`

**Interfaces:**
- Consumes: `fakeD1`、`ddlStatements()`
- Produces: `schema.accountDdl() -> string[]`（`users`/`sessions`/`invites`/`devices`/`tomb` + 索引）；`migrations/0001_init.sql`（D1 方言）

- [ ] **Step 1: 写失败测试**

`tests/goldminer-cloud-harness.mjs` 第一段：`fakeD1()` 上执行 `migrations/0001_init.sql`，断言 `sqlite_master` 里有 13 张业务表 + `users`/`sessions`/`invites`/`devices`/`tomb`，且存在 `users(username)` 与 `sessions(expires_at)` 索引，以及 13 张表各有一条 `(owner, updated_at)` 索引。脚本用退出码表达成败。

- [ ] **Step 2: 运行，确认失败**

Run: `node tests/goldminer-cloud-harness.mjs`
Expected: FAIL —— 迁移文件不存在。

- [ ] **Step 3: 加账号表定义并产出迁移**

`schema.mjs` 新增 `accountDdl()`；`gen-migration.mjs` 加 `--d1` 模式，把 `ddlStatements()` + `accountDdl()` 写成 `goldminer-hut/migrations/0001_init.sql`。字段照 spec §5.1 逐字实现（`sessions` 存 token 哈希、`tomb` 主键 `(owner, tbl, rid)`）。

- [ ] **Step 4: 重新生成并运行测试**

Run: `node goldminer-hut/tools/gen-migration.mjs --d1 && node tests/goldminer-cloud-harness.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add goldminer-hut/functions/schema.mjs goldminer-hut/tools/gen-migration.mjs goldminer-hut/migrations tests/goldminer-cloud-harness.mjs
git commit -m "feat: add the account schema and the D1 migration"
```

---

### Task 5: 会话与账号模块

**Files:**
- Create: `goldminer-hut/functions/session.mjs`
- Modify: `tests/goldminer-cloud-harness.mjs`

**Interfaces:**
- Consumes: `fakeD1`、Task 1 定下的迭代次数
- Produces:
  - `class AuthError extends Error { code: string; status: number }`
  - `registerUser(db, { username, password, invite }) -> Promise<{ userId }>`
  - `login(db, { username, password, ua }) -> Promise<{ token, userId, expiresAt }>`
  - `logout(db, token) -> Promise<void>`
  - `getUserFromRequest(db, request) -> Promise<{ user_id } | null>`（先 cookie `gm_session`，再 `Authorization: Bearer`）
  - `sessionCookie(token, maxAgeSeconds) -> string`（`HttpOnly; Secure; SameSite=Lax`）

- [ ] **Step 1: 写失败测试（含 Review Focus 1–4）**

在 `goldminer-cloud-harness.mjs` 追加一段，逐条断言：

```
注册：有效邀请码 → 建用户；users 行内不含明文密码子串
用户名边界：'' 与 129 字符 → AuthError；中文 '矿工老铁' 与含 emoji → 受理成功
邀请码：不存在 / 已用过 / 已过期 → AuthError，且 users 行数不变
登录：错密码 → AuthError；对密码 → 返回 token，且 sessions 里查不到 token 明文
多设备：同用户登录两次 → 两个 token 都能解析出同一 user_id；logout(第一个) 后第二个仍有效
过期：把该会话 expires_at 改到过去 → getUserFromRequest 返回 null
```

- [ ] **Step 2: 运行，确认失败**

Run: `node tests/goldminer-cloud-harness.mjs`
Expected: FAIL —— `Cannot find module '../goldminer-hut/functions/session.mjs'`。

- [ ] **Step 3: 实现 `session.mjs`**

密码：`crypto.subtle.deriveBits` PBKDF2-SHA256，迭代次数取 Task 1 的决策值，16 字节随机 salt，存 `pw_hash`/`pw_salt`/`pw_iter`。会话：32 字节随机 token（`crypto.getRandomValues` + base64url），库里只存 `sha256(token)`。用户名规则：trim 后 1–64 字符，允许中文与 emoji。邀请码：`used_by` 为空且未过期才受理，**先校验后建号**，任何失败路径都不写 `users`。

- [ ] **Step 4: 运行，确认通过**

Run: `node tests/goldminer-cloud-harness.mjs`
Expected: PASS（全部断言）。

- [ ] **Step 5: 提交**

```bash
git add goldminer-hut/functions/session.mjs tests/goldminer-cloud-harness.mjs
git commit -m "feat: add accounts, sessions and invite codes"
```

---

### Task 6: Worker 入口与认证路由

**Files:**
- Create: `goldminer-hut/functions/worker.mjs`
- Modify: `tests/goldminer-cloud-harness.mjs`

**Interfaces:**
- Consumes: `session.mjs` 全部导出、`handleApp`、`d1-db.openDb`
- Produces: `worker.default.fetch(request, env, ctx)`，`env = { DB, ASSETS }`

- [ ] **Step 1: 写失败测试**

追加一段，用 `worker.fetch(new Request(...), { DB: fakeD1(), ASSETS: { fetch: async () => new Response('asset') } })` 断言：

```
未登录 GET /api?action=query&table=ast → 401 { error: 'login_required' }
注册+登录后带 cookie 的同一请求 → 200，且返回行只属于该用户
GET /api/auth/me 未登录 → 401；登录后 → 200 { user_id, username }
POST /api/auth/logout → 之后同一 cookie 请求 401
未知表 → 404；非 /api 路径 → 落到 ASSETS（响应体 'asset'）
OPTIONS /api 带 Origin: null → 204，且响应头不含 access-control-allow-credentials
过期会话 cookie → 401 login_required（Review Focus 4）
```

- [ ] **Step 2: 运行，确认失败**

Run: `node tests/goldminer-cloud-harness.mjs`
Expected: FAIL —— `Cannot find module '../goldminer-hut/functions/worker.mjs'`。

- [ ] **Step 3: 实现 `worker.mjs`**

路由：`/api/auth/{register,login,logout,me}` → session；`/api/*` → `handleApp({ request, db: openDb(env.DB), getUser: (r) => getUserFromRequest(db, r) })`；其余 → `env.ASSETS.fetch(request)`。CORS：`Origin: null` 放行但**不开** `allow-credentials`；站点同源不需要 CORS 头。`getUser` 拿不到会话时抛 `UserContextError('login_required', 401)`，让 handler 的既有分支返回 401。

- [ ] **Step 4: 运行，确认通过**

Run: `node tests/goldminer-cloud-harness.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add goldminer-hut/functions/worker.mjs tests/goldminer-cloud-harness.mjs
git commit -m "feat: add the Worker entry with session-based identity"
```

---

### Task 7: 跨账号隔离（经会话）

**Files:**
- Modify: `goldminer-hut/tools/selftest.mjs`

**Interfaces:**
- Consumes: Task 6 的 `worker.fetch`、Task 5 的 `registerUser`/`login`
- Produces: 一条把 spec §6.4 钉死的回归断言

**背景：** `selftest.mjs:258-268` 已覆盖 handler 层的 owner 隔离（合成身份头），本任务补的是**经真实会话**那条路。

- [ ] **Step 1: 写断言**

新增 `runSessionSuite()`：建 A、B 两个账号并各拿一个 cookie；A 先插一行，B 用**自己的** cookie 对 A 的 `recordId` 发 `update` 与 `delete`，断言：两次都不产生副作用（A 的行内容与数量不变），且 A 的 query 结果里没有 B 的行。

- [ ] **Step 2: 运行**

Run: `node goldminer-hut/tools/selftest.mjs`
Expected: 若 Task 6 实现正确，直接 PASS（这条是把关断言）；若 FAIL，缺口就在 `worker.mjs` 的 `getUser` 接线，修到绿。

- [ ] **Step 3: 接进 pytest 并提交**

Run: `python -m pytest tests/test_goldminer_cloud.py -q`
Expected: PASS。

```bash
git add goldminer-hut/tools/selftest.mjs
git commit -m "test: pin cross-account isolation through real sessions"
```

---

### Task 8: wrangler 配置与本地端到端冒烟

**Files:**
- Create: `goldminer-hut/package.json`、`goldminer-hut/wrangler.jsonc`、`goldminer-hut/tools/mint-invite.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 4 的迁移文件、Task 6 的 Worker
- Produces: `npm run dev` / `npm run migrate:local` / `npm run deploy` 三个脚本

- [ ] **Step 1: 装 wrangler（缓存指到工作区内）**

`goldminer-hut/package.json` 加 `devDependencies: { "wrangler": "^4" }` 与脚本；`.gitignore` 加 `.npm-cache/`、`goldminer-hut/node_modules/`、`goldminer-hut/.wrangler/`。
Run: `cd goldminer-hut && npm_config_cache=D:\桌宠\.npm-cache npm install`
Expected: 安装成功。若仍 EPERM，停下来问用户（这是环境阻塞，不是代码问题）。

- [ ] **Step 2: 写 `wrangler.jsonc`**

`name`、`main: "functions/worker.mjs"`、`compatibility_date`、`assets: { directory: "../goldminer-hut/dist", binding: "ASSETS", run_worker_first: ["/api/*"] }`（dist 路径以实际 `build-dist.mjs` 输出为准）、`d1_databases: [{ binding: "DB", database_name: "goldminer", migrations_dir: "migrations" }]`。

- [ ] **Step 3: 建库并应用迁移**

Run: `cd goldminer-hut && npx wrangler d1 create goldminer`（把返回的 `database_id` 填进 `wrangler.jsonc`），然后 `npm run migrate:local`
Expected: 迁移成功，输出包含 13 张业务表与账号表。

- [ ] **Step 4: 端到端冒烟**

Run: `cd goldminer-hut && npm run dev`，另一个 shell：

```bash
curl -s -X POST http://127.0.0.1:8787/api/auth/register -H 'content-type: application/json' -d '{"username":"矿工老铁","password":"pw123456","invite":"<mint-invite 输出的码>"}'
curl -s -c /tmp/c.txt -X POST http://127.0.0.1:8787/api/auth/login -H 'content-type: application/json' -d '{"username":"矿工老铁","password":"pw123456"}'
curl -s -b /tmp/c.txt 'http://127.0.0.1:8787/api?action=query&table=ast'
```

Expected: 注册 200；登录 200 且带 `Set-Cookie`；query 200 且 `results` 为数组（空表为空数组）。

- [ ] **Step 5: 提交**

```bash
git add goldminer-hut/package.json goldminer-hut/wrangler.jsonc goldminer-hut/tools/mint-invite.mjs .gitignore
git commit -m "chore: add the wrangler setup and the invite minting tool"
```

---

### Task 9: 前端传输层（API_BASE + 双模式认证）

**Files:**
- Modify: `淘金矿工小屋/淘金矿工小屋·自律工作台.html:4030-4033`、`:4315-4340`
- Create: `tests/goldminer-sync-harness.mjs`

**Interfaces:**
- Consumes: 无（纯前端）
- Produces: 同步层新增 `apiBase()`、`authMode()`、`authHeaders()`、`syncOnline()` 四个函数；`cfgLoad()` 的配置对象新增 `apiBase`、`authMode`、`token` 三个字段

- [ ] **Step 1: 写 harness（从 HTML 抽出同步层）**

`tests/goldminer-sync-harness.mjs`：读 HTML，按同步层的横幅注释（`在线数据表同步层`）与结尾 `})();` 之间的文本抽出 IIFE，在 `vm` 沙箱里注入假的 `location`/`localStorage`/`fetch`/`document` 后执行（照 `tests/jianghu-harness.mjs` 的既有做法）。断言：

```
站点模式：fetch 的 URL 以 '/api?' 或 '/api' 开头，init.credentials === 'include'，无 Authorization 头
本地模式：URL 以配置的 apiBase 开头，init.headers.Authorization === 'Bearer <token>'，credentials 不为 'include'
apiBase 末尾带 '/' → 拼出的 URL 里没有 '//'
apiBase 为 'foo.bar'（缺协议）→ 不调用 fetch，且把可读错误交给调用方（Review Focus 5）
```

- [ ] **Step 2: 运行，确认失败**

Run: `node tests/goldminer-sync-harness.mjs`
Expected: FAIL —— 现在 URL 是硬编码的 `/functions/v1/app`，且没有 Authorization 分支。

- [ ] **Step 3: 改传输层**

`cfgLoad()/cfgSave()` 扩展三个字段；新增 `apiBase()`（默认 `'/api'`，去掉尾部斜杠，缺协议时抛可读错误）；`httpJson` 按 `authMode()` 决定 `credentials` 与 `Authorization`；`Q/A/U/DL` 与 `callFn` 全部改用 `apiBase()`。**对账算法与 `TABS` 一行不动。**

- [ ] **Step 4: 运行，确认通过**

Run: `node tests/goldminer-sync-harness.mjs`
Expected: PASS。

- [ ] **Step 5: 打包一致性 + 提交**

Run: `node goldminer-hut/tools/build-dist.mjs && fc /b "淘金矿工小屋\淘金矿工小屋·自律工作台.html" "goldminer-hut\dist\index.html"`
Expected: 无差异。

```bash
git add "淘金矿工小屋/淘金矿工小屋·自律工作台.html" tests/goldminer-sync-harness.mjs
git commit -m "feat: make the sync transport configurable and auth-aware"
```

---

### Task 10: 登录 UI、三态指示器与轮询策略

**Files:**
- Modify: `淘金矿工小屋/淘金矿工小屋·自律工作台.html:4540-4559`（`init()`）+ 新增登录覆盖层与侧边栏账号区
- Modify: `tests/goldminer-sync-harness.mjs`

**Interfaces:**
- Consumes: Task 9 的 `apiBase()`/`authMode()`
- Produces: `syncState() -> 'local' | 'logged-out' | 'synced'`（指示器与同步层共用同一判据）、`login(username, password)`、`logout()`

- [ ] **Step 1: 写断言**

追加到 harness（用 spy 记录调用顺序）：

```
未登录：syncState() === 'local'，且 init() 不抛异常、不发 fetch（本地模式可用）
登录成功：调用序列严格为 ['gmSyncDropSnapshot', 'pull', 'push']
轮询：注册的间隔是 60000；document.hidden 为 true 时到点不调用 pull
指示器：文案由 syncState() 单一判据决定（三态各一条断言）
```

- [ ] **Step 2: 运行，确认失败**

Run: `node tests/goldminer-sync-harness.mjs`
Expected: FAIL —— 四个函数都不存在。

- [ ] **Step 3: 实现**

登录覆盖层复用 `showModal`/`showToast`；侧边栏底部账号区显示 `syncState()` 对应文案（本地模式 / 未登录 / 已同步）——**判据必须与同步层同一个函数**，避免两处漂移（这是 2026-10-15 侧边栏改造踩过的坑）。`init()` 里把 `setInterval` 从 30s 改 60s，并加 `visibilitychange` 暂停/恢复。登录序列按 spec §7.3 的三步，顺序不可调换。

- [ ] **Step 4: 运行，确认通过**

Run: `node tests/goldminer-sync-harness.mjs && python -m pytest tests/test_goldminer_cloud.py -q`
Expected: 两条都 PASS。

- [ ] **Step 5: 提交**

```bash
git add "淘金矿工小屋/淘金矿工小屋·自律工作台.html" tests/goldminer-sync-harness.mjs
git commit -m "feat: add the login overlay, the three-state indicator and the 60s poll"
```

---

### Task 11: 端到端验收与文档

**Files:**
- Create: `goldminer-hut/README.md`
- Modify: `docs/superpowers/specs/2026-10-15-goldminer-cloud-accounts-design.md`（验收记录）

**Interfaces:**
- Consumes: 前十个任务的全部产物
- Produces: 一份可照着从零部署的说明 + 验收记录

- [ ] **Step 1: 人工验收（记录证据）**

Run: `cd goldminer-hut && npm run dev`，然后：

1. 两个浏览器 profile 同时登录同一账号，A 改一行，B 在 ≤60s 内看到（记时间）。
2. `file://` 直开工作台，未登录，全功能可用且控制台 0 报错。
3. 站点未登录 → 降级为本地模式，不报错。
4. 记录 `wrangler dev` 日志里单日行读的估算依据（次数 × 行数）。

- [ ] **Step 2: 写 README**

内容：部署三步（create d1 → migrate → deploy）、`mint-invite` 用法、**`file://` 模式 token 存 localStorage 的风险**、免费额度注意事项、以及 A2（墓碑 + `since`）尚未做、轮询暂为 60s 的现状。

- [ ] **Step 3: 把验收结果写回 spec**

在 spec §13 下面加「验收记录（2026-10-15）」小节，逐条记实测值与证据位置。

- [ ] **Step 4: 全量测试**

Run: `python -m pytest -q`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add goldminer-hut/README.md docs/superpowers/specs/2026-10-15-goldminer-cloud-accounts-design.md
git commit -m "docs: deployment notes and A1 acceptance record"
```

---

## Self-Review

**1. Spec 覆盖**

| Spec 章节 | 落在哪个任务 |
|---|---|
| §4.1 拓扑（Worker + assets + D1） | Task 8（配置）、Task 6（路由） |
| §4.2 第三次兑现（handler 零改动） | Task 3（D1 适配器）、Task 6（getUser 注入） |
| §5.1 账号表 | Task 4 |
| §5.2 PBKDF2 风险 | Task 1（spike）→ Task 5（落地迭代次数） |
| §5.3 双模式认证 | Task 6（服务端）、Task 9（客户端） |
| §5.4 安全边界（`Origin: null` 不放凭据） | Task 6 Step 3 + Step 1 的断言 |
| §5.5 端点契约 | Task 6 |
| §6.1 D1 适配器 | Task 3 |
| §6.2 增量拉取 | **不在本计划**（A2，spec §14 已分阶段）——本计划只做「60s + 可见性暂停」，落在 Task 10 |
| §6.4 跨租户断言 | Task 7（会话级）+ 既有 handler 级断言 |
| §7.1–7.3 前端改造 | Task 9、Task 10 |
| §7.4 离线与冲突（不做队列） | 无任务，**符合预期**（非目标） |
| §8 迁移（导入 JSON） | 无任务，**符合预期**（现成路径，零代码） |
| §9 测试策略 | Task 2、4、5、6、7、9、10、11 |
| §10 部署与运维 | Task 8、Task 11 |
| §13 验收标准 | Task 11 |

**2. 步骤扫描**：每个 step 是一个动作 + 一个可检验结果。Task 3 Step 5 与 Task 6 Step 3 给了实现要点而非代码正文（签名与测试已定死形状）；没有「处理边界情况」「适当校验」这类不决定任何事的行。

**3. 类型一致性**：`ddlStatements()`（Task 3）在 Task 4 被 `gen-migration.mjs --d1` 复用；`fakeD1()`（Task 3）在 Task 4/5/6 复用；`getUserFromRequest`（Task 5）在 Task 6 注入；`apiBase()`/`authMode()`（Task 9）在 Task 10 复用。`d1Host()` 的字段名与 `sqliteHost()` 一致（`name/db/getUser/rows/globalUniqueRid/queries/close`）。

**4. Review Focus 对应**：五条各自钉在 Task 5（1–4）与 Task 9（5）的断言里，无遗漏。

**5. 篇幅**：本计划约为 spec 的 0.9 倍，无代码正文块（只有断言与签名），比例正常。

**已知缺口（有意留给 A2/A3）**：墓碑与 `since` 增量拉取、乐观锁、D1 备份导出、子项目 B 的投影端点与 Durable Object。本计划落地后，行读额度处于「60s + 可见性暂停」的安全区，不是根治。

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-10-15-goldminer-cloud-accounts.md`。

**执行前请注意两条环境事实：**

1. **本会话无法 git 提交**（沙箱按路径拒绝写 `.git` 子树，实测证据见 Global Constraints）。每个任务的提交步骤要么由你在沙箱外执行，要么先把会话切到完全权限。
2. **Task 1 与 Task 8 需要联网**（装 wrangler / `wrangler d1 create`）。若 `npm_config_cache` 重定向后仍 EPERM，这两个任务会停下来问你。
