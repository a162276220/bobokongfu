# 淘金矿工小屋脱离单机（多账号云同步）— 设计规格

日期：2026-10-15
状态：已确认（用户回复「认，写 spec」）
分类：架构级
范围：**子项目 A（账号 + 多租户 + 云同步）**。子项目 B（社交玩法）在本规格中只预留接口，另开一轮 spec。

---

## 1. 背景与目标

### 1.1 现状（有据可查）

工作台**已经不是纯单机**，而是「单机优先 + 一层半成品云同步」：

| 部件 | 位置 | 现状 |
|---|---|---|
| 工作台本体 | `淘金矿工小屋/淘金矿工小屋·自律工作台.html`（4564 行） | 单文件、`file://` 双击即用、状态在 `localStorage`（`STORAGE_KEY`） |
| 前端同步层 | 同上，第 **4001–4561** 行 | 13 张业务表、`EXTRACT`/`APPLY`、行级 LWW（快照哈希）、删除传播、1.2s 防抖推送 + 30s 轮询 |
| 传输层 | 同上，第 **4315–4340** 行 | **硬编码同源 `/functions/v1/app`**，`credentials: 'same-origin'` |
| 在线判定 | 同上，第 **4033** 行 | `online() { return location.protocol !== 'file:'; }` → `file://` 下整层静默停用 |
| 数据面 | `goldminer-hut/functions/handler.mjs` | 唯一入口，query/insert/update/delete；中文键↔ASCII 列名翻译；insert 按 `(owner, rid)` 幂等 upsert；update 未命中返回 409 让客户端重建 |
| 表结构 | `goldminer-hut/functions/schema.mjs` | 13 表，公共列 `id/owner/rid/updated_at`，业务值一律 text（勾选列 boolean） |
| 宿主 ① | `functions/index.ts` + `adapter.mjs` + `auth.mjs` | Supabase Edge Function，身份取网关注入的 `x-qoder-user-context` |
| 宿主 ② | `backend/server.mjs` + `backend/sqlite-db.mjs` | Node HTTP + SQLite，**单个 Bearer 令牌 → 单个 owner** |
| 打包 | `goldminer-hut/tools/build-dist.mjs` | 工作台 + 桌宠图集 → `dist/`（约 25MB 静态资源） |
| 本地验证 | `goldminer-hut/tools/devserver.mjs` | 托管 `dist/`，`/functions/v1/app` 接到真 handler（合成身份头） |
| 自测 | `goldminer-hut/tools/selftest.mjs` | **同一组断言跑两个宿主**（内存假库 + 真 SQLite） |

### 1.2 目标

1. **多设备同账号同步**：手机、电脑、平板看到同一份数据。
2. **多人各自独立账号**：可部署给朋友用，数据互相隔离。
3. **数据托管到公网**：不依赖本机文件与本地 SQLite。

### 1.3 非目标

- **不做社交玩法**（互访小屋、排行榜、多人矿工）——子项目 B，见 §12 的接口预留。
- **不改 13 表契约、`EXTRACT`/`APPLY`、`doPull`/`doPush` 的对账算法**——这是现有架构最大的红利。
- **不引入前端构建流程**：工作台仍是单文件 HTML + 原生 JS，`dist/` 仍由拷贝脚本产出。不引入打包器、TypeScript、框架。
- **不重做 UI 换肤**：沿用现有 `showModal` / `showToast` / 侧边栏样式。
- **不引入显式离线待推队列**：现有「快照哈希 ≠ 本地哈希即待推」的机制已覆盖离线场景（见 §7.4）。
- **不做字段级冲突合并**：第一版保留行级 LWW。

---

## 2. 关键约束

| 约束 | 结论 |
|---|---|
| 部署平台 | **Cloudflare Workers + D1 + Workers Static Assets**（用户已选：免费云平台、零运维） |
| 运行入口 | **两个都要**：站点（HTTPS，云端账号模式）+ `file://` 直开（本地模式） |
| 登录方式 | **用户名/邮箱 + 密码 + 邀请码注册**（用户已选） |
| 身份实现 | 自建，不依赖第三方 OAuth |
| 前端依赖 | 无外部依赖，纯原生 JS |
| 语言 | 界面文案与代码注释保持中文 |
| 数据真源 | D1 的 13 张业务表（+ 账号表） |

---

## 3. 方案选择

| 方案 | 做法 | 结论 |
|---|---|---|
| **1. 同域 Worker 一体化** | 一个 Worker 同时托管静态资源（`env.ASSETS` 接 `dist/`）与 `/api/*` 数据面，D1 作真源 | **选定**。单部署物、同源免 CORS、静态请求不计额度、免费额度利用率最高 |
| 2. Pages + 独立 API Worker | 静态走 Pages，数据面单独 Worker | 两套部署物 + 跨子域 cookie/CORS，运维复杂度翻倍，收益不明显 |
| 3. 沿用 Supabase 宿主只补账号 | 改动最小 | 用户已选 Cloudflare；免费项目会休眠；社交玩法的实时通道更被动 |

---

## 4. 架构

### 4.1 拓扑

```
浏览器（站点 https）──cookie──┐
浏览器（file://）  ──Bearer──┤→ Worker ─┬─ /api/*  → handleApp() → D1（13 业务表 + 账号表）
                             │          └─ 其余    → env.ASSETS（dist/：工作台 + 桌宠图集）
                             └─ 静态请求不计入 Worker 请求/CPU 额度
```

`wrangler.jsonc` 要点：`assets.directory = "./dist"`、`assets.binding = "ASSETS"`、`assets.run_worker_first = ["/api/*"]`、`d1_databases` 绑定 `DB`。

### 4.2 可插拔宿主的第三次兑现

`handler.mjs` 只依赖宿主注入的两样东西：`db`（PostgREST 形状的链式客户端）与 `getUser(request)`。这是既有的设计承诺（见 `backend/server.mjs` 顶部注释），本次是它的第三次兑现：

- **身份**：换 `getUser` 实现即可，`handler.mjs` **零改动**。多租户隔离（`.eq('owner', owner)`）已经在 SQL 里了。
- **数据库**：新增 D1 版适配器，实现同样的四种链式形状。

> `sqlite-db.mjs` 的 `then()` 是 `Promise.resolve().then(() => this.run())`，**异步 `run()` 天然被容忍**——D1 的 async API 不需要改 `handler.mjs` 的调用方式。

### 4.3 模块边界

| 文件 | 动作 | 职责 |
|---|---|---|
| `functions/worker.mjs` | 新增 | Worker entry：`/api/*` → `handleApp`，其余 → `ASSETS` |
| `backend/d1-db.mjs` | 新增 | D1 版 `db` 适配器（与 `sqlite-db.mjs` 同契约） |
| `functions/session.mjs` | 新增 | 账号/会话/邀请码：注册、登录、登出、cookie 与 Bearer 双模式解析 |
| `functions/auth.mjs` | 不动 | Supabase 宿主的身份读取，保留 |
| `functions/handler.mjs` | **仅 §6.2 增量拉取所需改动** | 数据面；身份相关零改动 |
| `functions/schema.mjs` | 扩展 | 13 表定义不变；新增账号表与墓碑表定义 |
| `backend/server.mjs` | 不动（保留为本地自建后端） | 离线自托管路径 |
| `tools/gen-migration.mjs` | 扩展 | 除现有 Supabase 迁移外，产出 D1 方言迁移 |
| `淘金矿工小屋/淘金矿工小屋·自律工作台.html` | 改第 4001–4561 行区域 + 新增登录 UI | 传输层、认证、轮询、指示器 |

---

## 5. 身份与会话

### 5.1 表结构（D1）

```sql
users    (id TEXT PK, username TEXT UNIQUE, email TEXT UNIQUE NULL,
          pw_hash TEXT, pw_salt TEXT, pw_iter INTEGER,
          nickname TEXT, created_at TEXT, last_login_at TEXT)
sessions (token_hash TEXT PK, user_id TEXT, created_at TEXT, expires_at TEXT, ua TEXT)
invites  (code TEXT PK, created_by TEXT, created_at TEXT, expires_at TEXT, used_by TEXT NULL, used_at TEXT NULL)
devices  (id TEXT PK, user_id TEXT, label TEXT, first_seen TEXT, last_seen TEXT)   -- 多设备可见列表
tomb     (owner TEXT, tbl TEXT, rid TEXT, ts TEXT, PRIMARY KEY (owner, tbl, rid))  -- 见 §6.2
```

- `sessions` 存 **token 的哈希**，不存 token 明文；cookie 值即 token。
- 索引：`sessions(expires_at)`、`tomb(owner, ts)`、13 张业务表各加 `(owner, updated_at)`（增量拉取用）。

### 5.2 密码哈希与 CPU 风险（**唯一架构级未知，必须先 spike**）

计划：PBKDF2-SHA256，100k 迭代，随机 16 字节 salt，`crypto.subtle.deriveBits`。

**风险**：Workers 免费版有单次调用 CPU 时间上限（记忆值 10ms，付费 30s），PBKDF2 可能超限并触发错误 1102。WebCrypto 是原生实现、可能不计入 CPU，但**未经验证**（本会话联网检索不可用，未核实到原文）。

**Spike 结果（2026-10-15，本机 Node 24 WebCrypto，与 Workers 同族的原生实现）**：

| 迭代 | min | median | max |
|---|---|---|---|
| 10k | 1.34ms | 1.40ms | 2.40ms |
| 50k | 6.45ms | 6.60ms | 6.99ms |
| 100k | 12.92ms | 13.17ms | 13.67ms |

**决策**：默认 `PBKDF2_ITERATIONS = 100000`，并把迭代数**逐用户存进 `pw_iter`**——校验时用该用户存的值，因此日后下调常量不会把既有用户挡在门外（低于当前常量的用户在登录成功后可顺手重算）。若部署实测登录触发 1102，按 ①50k → ②10k + 服务端 pepper → ③升级 Paid 的顺序下调，只改常量。

**仍未 settled 的**：WebCrypto 的 PBKDF2 是否计入 CPU 时间——本机测不出来，只能在部署后实测（Task 8）。另：`wrangler dev` 在本会话不可用（spawn workerd 走管道 stdio → EPERM，属沙箱文档化边界），所以本机无法跑 Workers 运行时。

### 5.3 双模式认证

| 入口 | 认证方式 | 原因 |
|---|---|---|
| 站点（HTTPS） | `HttpOnly; Secure; SameSite=Lax` cookie | 同源，最安全，前端不需要碰 token |
| `file://` | `Authorization: Bearer <token>`，token 存 `localStorage` | 第三方 cookie 会被浏览器拦截（Safari 默认拦、Chrome 逐步淘汰），cookie 方案在 `file://` 下不可靠 |

Worker 两种都接受。前端据此分叉：站点模式依赖 cookie（`credentials: 'include'`），本地模式显式带 Bearer 头。

### 5.4 安全边界（必须写进文档的代价）

`file://` 页面的 `Origin` 是字符串 `null`，任何本地页面都能伪造它 → **CORS 白名单放行 `null` 不构成任何保护**。本地模式的唯一保护是 Bearer token 本身。因此：

- CORS 对 `null` 放行时**不允许携带凭据**（`Access-Control-Allow-Credentials` 不开）。
- 本地模式 token 泄漏 = 账号失守，用户须知悉（文档明写）。
- 所有业务路由一律 `.eq('owner', owner)`，**owner 只从会话解析，客户端传什么都不作数**（现有 `handler.mjs` 已如此，保持）。

### 5.5 端点契约

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/auth/register` | POST | `{username, password, invite}` → 校验邀请码、建用户、建会话 |
| `/api/auth/login` | POST | `{username, password}` → 建会话（cookie 或返回 token） |
| `/api/auth/logout` | POST | 销毁会话 |
| `/api/auth/me` | GET | `{user_id, username, nickname}`，未登录返回 401 |
| `/api/*`（业务） | GET/POST | 沿用现有 `handler.mjs` 契约（`?action=query&table=...` / `{action, table, ...}`） |

沿用现有错误码语义：401 `login_required`、403 `invalid_user_context`、409 `record_not_found`、413 `payload_too_large`、503 `database_request_failed`。

---

## 6. 数据面

### 6.1 D1 适配器（`backend/d1-db.mjs`）

实现与 `sqlite-db.mjs` 相同的四种链式形状，用 `env.DB.prepare(sql).bind(...)`：

- 表名/列名一律按 `schema.mjs` 白名单校验后再拼 SQL（标识符不可参数化），值全走占位符——与 `sqlite-db.mjs` 的 `guard()` 同一策略，**不因平台可信就放松**。
- `update(...).select('id')` 的「0 行命中 → 409」语义用 `meta.changes` 判定（D1 的 `run()` 返回 `meta.changes`），不必像 SQLite 版那样回读。
- 勾选列 D1 存 0/1，读回还原布尔。
- 可选优化：一次 push 的多个写操作走 `env.DB.batch()`（D1 的 batch 是事务性顺序执行）。**第一版不做**，先求正确性。

### 6.2 增量拉取（**A2 必做**，额度决定的）

现状每次 `pull` 对 13 表各做一次 `qAll`（全表分页读），每次 `push` 前**再**各做一次 `qAll` 对账。D1 免费额度按「行读/日」计（记忆值 500 万，未联网核实）。

**估算**（假设业务数据合计约 3000 行，按每次 pull 全量 3000 行读计）：

| 轮询间隔 | 次/日 | 行读/日 | 相对 500 万额度 |
|---|---|---|---|
| 30s（现状） | 2880 | 约 860 万 | **超** |
| 60s | 1440 | 约 430 万 | 贴边，叠加 push 前对账即超 |
| 60s + 可见性暂停（按每日活跃 8h 计） | 约 480 | 约 150 万 | 安全 |

所以：

- **A1 先行**：轮询降到 **60s**，且 `document.hidden` 时暂停（两条同时做才安全）。
- **A2 根治**：`?since=<iso>` 水位线 + **墓碑表**，行读降到「实际变更行数」量级。

**墓碑是必需项，不是优化项**：客户端判定「云端没这行 = 被删了」依赖**全量**列表，一旦改成增量，删除就再也看不见了。所以 delete 操作要写 `tomb` 行，`since` 查询同时返回 `{ results, deleted: [rid...] }`，客户端的删除传播改读 `deleted`。这是本次唯一需要动 `handler.mjs` 的地方（新增 `since` 分支与墓碑写入）。

### 6.3 乐观锁（可选增量）

多设备并发改同一行时，现有 LWW 会丢一边。可选增量：`update` 附带快照里的 `updated_at`，服务端不匹配则返回 409，客户端先拉后合。**A2 视实际丢数据情况再决定是否做**。

### 6.4 多租户隔离与回归测试

多用户之后，隔离墙只有 `.eq('owner', owner)` 一道（无数据库级 RLS）。**必须新增跨租户断言**：用 A 的凭据对 B 的 `rid` 发 update/delete，要求 0 行命中且无副作用。现有 `selftest.mjs` 的双宿主框架直接扩成三宿主（内存假库 + SQLite + D1）。

---

## 7. 前端改造

### 7.1 改造点清单

| 位置 | 现状 | 改成 |
|---|---|---|
| 4030–4031 | `cfgLoad`/`cfgSave`（`goldminer_sync_cfg_v1`） | 增加 `apiBase`、`authMode`、`token` 字段 |
| 4033 | `online() { return location.protocol !== 'file:'; }` | 三态：本地模式 / 未登录 / 已同步 |
| 4315–4320 | `httpJson` 硬编码 `credentials: 'same-origin'` | 按 `authMode` 分支：cookie 模式 `include`，token 模式加 `Authorization` |
| 4321–4340 | `callFn` / `Q`/`A`/`U`/`DL` 硬编码 `/functions/v1/app` | 全部走 `API_BASE`（默认同源 `/api`） |
| 4377–4436 | `doPull` 全量对账 | A2 改读 `{results, deleted}` |
| 4439–4498 | `doPush` 前先 `qAll` 对账 | A2 用 `since` 或按 rid 查询替代 |
| 4540–4559 | `init()`：`online()` 判定 + 30s `setInterval` | 登录门 + 60s 轮询 + `visibilitychange` 暂停 |
| 新增 | — | 登录/注册/邀请码覆盖层；侧边栏账号区 |

`TABS`（4017–4026）、`EXTRACT`/`APPLY`、对账算法**不动**。

### 7.2 API 基址与三态指示器

`API_BASE` 默认同源 `/api`；`file://` 模式由用户在登录面板填服务器地址（如 `https://xxx.workers.dev`），存 `localStorage`。侧边栏底部现有「本地模式/云端已同步」指示器扩成三态：**本地模式 / 未登录 / 已同步**（判定依据与同步层 `online()` 同一处，避免两处判据漂移——这是 2026-10-15 侧边栏改造时踩过的坑）。

### 7.3 登录 UI

复用 `showModal` / `showToast`。字段：用户名、密码、邀请码（注册时）。

**未登录语义（两个入口一致）**：不阻塞使用。同步层停用，数据只写 `localStorage`，指示器显示「本地模式」。这是现有 `online()` 行为的最小延伸，避免「没登录就什么都干不了」。

**登录成功后的固定序列**（顺序不能变）：

1. 先 `gmSyncDropSnapshot()` 清同步快照——否则登录前在本地写下的行会被当成「已对过账」，下一次拉取按「云端已删」抹掉。
2. `pull()`：云端为真源，覆盖同名 `rid` 的行；本地独有的行保留下来。
3. `push()`：把本地独有的行补推上去（补推即合并，不会丢）。

**退出登录**：清会话、清同步快照，**保留本地 `localStorage` 数据**，回到本地模式。

### 7.4 离线与冲突（YAGNI 取舍）

- **待推队列不新建**：现有机制中「本地哈希 ≠ 快照哈希」就是待推集合，`doPush` 每次重算。离线期间照常写 `localStorage`，恢复后下一次 `push()` 自然补推。
- **冲突保留 LWW**：第一版接受「两端同时改同一行丢一边」，不做字段级合并。
- 推送失败保持现有语义：`allOk = false` → 快照不更新 → 下轮重试。

---

## 8. 迁移

现成的搬家路径已经存在，**零成本**：

1. 用户登录新账号后，用侧边栏「导入数据」导入本地导出的 JSON。
2. `applyImportedData`（HTML 第 3957–3970 行）已调用 `gmSyncDropSnapshot()` 清同步快照——这是必需的，否则导入的行在本机快照里「已经对过账」，下一次拉取会把它们当成「云端已删」而抹掉。
3. `saveState()` 已被包装为触发防抖推送 → 整表上传到云端。

**服务端历史数据**：现有 SQLite 库 / Supabase 项目里的数据 owner 是旧归属 id，需要一个一次性脚本把 `owner` 改成目标 `user_id`（或按上一条走 JSON 导出/导入，更简单）。**A1 采用 JSON 路径**，脚本仅在数据量大到不可行时才做。

---

## 9. 测试策略

| 层 | 手段 |
|---|---|
| 数据面契约 | `selftest.mjs` 扩成三宿主（内存假库 + SQLite + D1），同一组断言 |
| **跨租户** | 新增：A 的凭据改/删 B 的行 → 0 行命中，无副作用 |
| 认证 | 注册/登录/登出/过期会话/无效邀请码/重复用户名；密码不落明文 |
| 前端 | 现有无头 Chrome 流程（`tests/` 里的 boot-browser / cdp 脚本）+ 新增：未登录可本地使用、登录后同步、三态指示器 |
| 打包 | `build-dist.mjs` 后 `dist/index.html` 与源**逐字节一致**（现有约束保持） |
| 额度 | 记录单日行读实测值，确认在免费额度内 |

---

## 10. 部署与运维

- **环境准备**（当前实测状态）：`node v24.15.0` ✅、`wrangler` 未安装 ❌、无 `CLOUDFLARE_API_TOKEN` ❌、`npx` 因 npm cache 在工作区外报 **EPERM** ❌ → 需先把 `npm_config_cache` 指到工作区内（如 `.npm-cache`），再 `wrangler login`。
- **迁移流程**：`wrangler d1 migrations apply <db> --remote`；迁移 SQL 由 `gen-migration.mjs` 产出（D1 方言）。
- **部署**：`wrangler deploy`。
- **备份**：D1 有 Time Travel；另加定期 `wrangler d1 export` 导出到本地。
- **域名**：先用 `*.workers.dev`；自有域名可选。

---

## 11. 风险与待验证项

| # | 风险 | 处理 |
|---|---|---|
| 1 | **PBKDF2 撞 CPU 上限**（唯一架构级未知） | 先 spike（§5.2），三分支决策 |
| 2 | D1 行读额度被全量轮询吃满 | A1 降频 + 可见性暂停；A2 墓碑 + `since` 增量 |
| 3 | 增量拉取丢掉删除传播 | 墓碑表是必需项，A2 与增量同批交付 |
| 4 | 多用户隔离只有应用层一道墙 | 跨租户回归测试（§6.4），列入验收 |
| 5 | `file://` 模式 token 存 `localStorage` | 文档明写风险；CORS 不放行凭据 |
| 6 | 免费额度数字未联网核实 | 落地时以 wrangler 实测为准，不按记忆值承诺 |

---

## 12. 子项目 B 接口预留（本次不实现）

- **跨用户读必须走独立投影端点**（如 `/api/social/leaderboard` 只返回昵称/等级/金币），**绝不放开 13 表的 owner 过滤**。
- 公开数据用**显式公开表**（如 `cabin_public`），由本人主动「开放参观」时写入，不是自动镜像。
- 实时通道用 Durable Object 按房间分片（多人矿工）；互访与排行榜用轮询足够。
- `devices` 表已为「多设备可见列表」预留。

---

## 13. 验收标准

1. 两个浏览器 profile 同时登录同一账号，A 改动后 B 在 ≤60s 内看到（A2 后 ≤10s）。
2. 未登录时 `file://` 直开仍可全功能使用（本地模式），站点未登录时同样降级为本地模式而非报错，两处控制台均 0 报错。
3. 用 A 的凭据对 B 的行发 update/delete → 0 行命中、无副作用（自动化断言）。
4. D1 中只有 `pw_salt` + `pw_hash`，无明文密码；站点会话 cookie 为 `HttpOnly` + `Secure` + `SameSite=Lax`。
5. `pytest` 入口全绿，含 D1 宿主的 selftest 与跨租户断言。
6. `build-dist.mjs` 产出的 `dist/index.html` 与源逐字节一致；站点可登录、可同步。
7. 记录单日行读实测值，确认在免费额度内。

---

## 14. 分阶段交付

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **A0 spike** | PBKDF2 CPU 实测；wrangler 环境打通（npm cache 重定向 + login） | §5.2 三分支决策落地；能 `wrangler dev` 起本地 Worker |
| **A1 地基** | Worker entry + D1 适配器 + 账号表与端点 + 登录 UI + `API_BASE` + 双模式认证 + 三宿主/跨租户测试 + 60s 轮询 | 验收 1（60s 档）、2、3、4、5、6 |
| **A2 额度与冲突** | 墓碑 + `since` 增量拉取；轮询升到 10s；乐观锁（视情况） | 验收 1（10s 档）、7 |
| **A3 运维** | D1 migrations 流程、备份导出、部署脚本、使用文档（含 token 风险） | 文档齐备，能从零部署一次 |
| **B 社交** | 另开 spec | — |

## 15. 验收记录（2026-10-15，A0 + A1 实现完成）

### 15.1 已通过的闸门

| 闸门 | 命令 | 结果 |
|---|---|---|
| 数据面契约（三宿主） | `node goldminer-hut/tools/selftest.mjs` | exit 0；内存假库 30 通过、SQLite 适配器 32 通过、D1 适配器 32 通过，全 0 失败 |
| 迁移 / 账号 / 会话 / Worker / 跨账号隔离 | `node tests/goldminer-cloud-harness.mjs` | exit 0；72 通过 / 0 失败 |
| 前端同步层 | `node tests/goldminer-sync-harness.mjs` | exit 0；28 通过 / 0 失败 |
| 本地开发服务器（真进程 + 真 HTTP） | `node tests/goldminer-devserver-smoke.mjs` | exit 0；8 通过 / 0 失败 |
| 仓库统一入口 | `python -m pytest tests/test_goldminer_cloud.py -q` | 4 passed |
| dist 与源文件一致 | `node goldminer-hut/tools/build-dist.mjs` | `dist/index.html` 与源文件 SHA256 相同 |

跨账号隔离由真实会话验证，不是断言式声明：乙查不到甲的行、乙改甲的行得到 409（`record_not_found`）、
乙删甲的行之后甲的行仍在、乙复用甲的 `rid` 被数据库拒绝（503）。

### 15.2 未验证（本机环境做不到，需要用户终端与账号）

- **wrangler 全链路**：本机沙箱禁止「捕获子进程输出的管道」，而 wrangler spawn workerd 时正是管道 stdio
  → `EPERM`。因此 `wrangler dev / login / d1 create / migrations apply / deploy` 全部未实测；
  配置与逐步命令写在 `goldminer-hut/README.md`。
- **浏览器真机验收**：注册、登录、两台设备看到同一份数据、圆片三态、退出登录 —— 未在浏览器里跑过。
- **PBKDF2 在 Workers 上的 CPU 计入与免费额度**：本机只能给量级（100k ≈ 13ms），见 §5.2。
- **D1 免费额度实测**：60s + 可见性暂停的估算（约 150 万行/天）未在真实额度上验过。

### 15.3 与规格的偏差

- §6.1 原计划「照抄一份 Builder 给 D1」，实际改为抽出 `backend/sql-builder.mjs` 供两个适配器共用
  （执行器接口化），避免两份 SQL 构建逻辑漂移；既有 31 条断言作为重构回归闸门。
- §5.2 的 spike 用 Node WebCrypto 完成（wrangler 不可用），Workers 侧留待部署实测；
  迭代数改为逐用户存 `pw_iter`，所以下调常量不会把既有用户挡在门外。
- 新增 `accountDdl()` 里的 `tomb` 表与 `indexStatements()` 的 `(owner, updated_at)` 索引，
  属于 A2 的前置结构，现在就建以免迁移改两次。
- **`rid` 的唯一性从列级挪到 `(owner, rid)` 复合唯一索引**（§15.4 第 1 条）：原云库把 `rid` 声明成全库唯一，
  而前端生成的 `rid` 是确定性的（`ast` 恒为 `t`、日志行 `前缀|日期#序号`），第二个账号第一行就会撞。
  库还没建，所以直接改 schema + 重生成迁移，没有存量数据要迁。
- `tools/devserver.mjs` 从「合成身份头 + 内存假库 + `/functions/v1/app`」改成
  「`/api/*` 转发给真 Worker + `node:sqlite` 顶 D1 绑定 + 启动时自动跑迁移」，
  于是本地不用 wrangler 也能端到端验完整链路（见新增的冒烟测试）。

### 15.4 全新评审轮（同一天，独立上下文，只读评审）

评审者复跑四条闸门，数字与记录一致；报了 3 条必须改 + 5 条建议改。每条都先加断言复现、再改。

**必须改，已修：**

1. **`rid` 全库唯一 → 多账号主线断裂。** 前端生成的 `rid` 是确定性的（`ast` 恒为 `'t'`、日志行
   `前缀|日期#序号`），而业务表的 `rid` 是列级全局 UNIQUE，`handler` 的 upsert 冲突目标却只指向
   `(owner, rid)` 复合索引 —— 第二个账号第一行就撞唯一约束、被 503 挡下，还会被 1.2s 防抖无限重试。
   已把唯一性挪到 `(owner, rid)` 复合唯一索引并重生成迁移。
   **selftest 的 F 段原本把「别的 owner 复用同 rid 被拒 503」断言成期望行为**，把缺陷钉成了规格 ——
   已反过来：现在断言「跨 owner 可重名 + 同 owner 重复写幂等」。
2. **注册会烧掉邀请码。** 顺序是先认领邀请码、后建号，建号失败则码永久作废（并发抢注同名时尤其真）。
   已改为建号失败时回滚认领（`WHERE code = ? AND used_by = ?`，不误伤并发下别人刚认领的那份），
   并把唯一约束冲突映射成 409 `username_taken`。
3. **devserver 仍只接 `/functions/v1/app`**，前端改用 `/api/app` 后本地同步会整层静默失效 ——
   本地验收会得出「同步没生效」的错误结论。已重写为转发真 Worker + `node:sqlite` 顶 D1 + 启动跑迁移，
   并新增真进程真 HTTP 的冒烟测试。

**建议改，已修：**

4. **401 后不停轮询。** 新增 `canSync()` 门槛（`online() && syncState() !== 'logged-out' && !_syncing`），
   `pull` / `push` / 防抖 `schedule` 三处共用。错误码也从 `unauthorized` 对齐到 §5.5 的 `login_required`。
5. **站点模式把令牌放进响应体，抵消了 HttpOnly。** 改为只在非站点来源（无 Origin 或 `Origin: null`）
   回 body 令牌；`file://` 模式仍回。
6. **`/api/auth/me` 字段与 §5.5 不一致**，已改为 `{user_id, username, nickname}`。
7. **两条「看着在测、其实没测」的断言**：删掉恒真断言；把「最后推」从「依赖 pull 恰好发现待推数据」
   改成「自己造一次本机改动，验证推送路径真的 POST」；补上跨账号同 `rid` 的回归断言
   —— 正是这条缺失让第 1 条缺陷一路绿灯。
8. **前端夹具太薄**（`{coins: 7}`）会让 `EXTRACT.meal` 抛错、`doPush` 静默失败，
   于是「没推送」是夹具造成的假象。已换成完整夹具。

### 15.5 第二次回滚与架构调整：前端同步层改成构建期补丁

评审轮之后、准备部署时发现：源文件与 `goldminer-hut/dist/index.html` 在 **10-16 07:37:42**
被那个写者（phase 系列）同时覆盖，我的 9 处前端补丁**再次全丢**（`CLOUD_ORIGIN`/`canSync`/
`gmAcctChip` 全为 0，`/functions/v1/app` 与 30s 轮询回来了），磁盘上**没有任何打好补丁的副本**。
它自己的备份命名 `_backup-pre-phase3.html` 说明它按自己的基线整份重写，基线里没有我的改动。

用户裁定：那个写者停不掉、也不该停，于是同步层改为**构建期补丁**。

- 新增 `goldminer-hut/tools/patch-sync.mjs`：12 条锚点补丁，幂等；锚点 MISS/AMBIG 或
  打完复检不到关键标记就**失败退出**（漏打的后果是「站点看着正常、其实没有云同步」）。
- `build-dist.mjs` 拷完 `dist/` 后对 `dist/index.html` 打补丁；**源文件不被碰**。
- `CLOUD_ORIGIN` 也由补丁写入（`CLOUD_ORIGIN=... node tools/build-dist.mjs`），
  这样 `file://` 入口也不用去手改那个随时会被覆盖的源文件。
- 前端套件改成「先 `applyPatches` 再抽同步层」，测的就是真正会发出去的那份代码。

重建过程本身验证了一件事：**多行锚点必须行尾无关**。那个写者整份重写时用 CRLF（实测 6024 行
全是 CRLF），而锚点是 LF，第一轮 12 条里 10 条 MISS；补丁脚本改成「统一在 LF 上打、最后还原
成原文件风格」后 12 条全部命中。重建后的前端同步层一次通过全部 28 条断言。

**评审提出、核实后不采纳的：**

- **「跨账号 delete 回 200 静默吞掉失败」**：这是有意的幂等语义，与 update 的不对称是设计。
  update 命中 0 行必须回 409，因为「假装成功」会让客户端以为云端已经有了那个值；
  而 delete 的目标状态（这行不在）本已达成。已在 `handler.mjs` 就地注释，免得下次评审再当缺陷提。
- **「`syncState()` 的 `me` 兜底是唯一没有凭据也能显示已同步的分支」**：这个分支是站点模式必需的 ——
  站点模式凭据在 HttpOnly cookie 里、`localStorage` 没有令牌，不问服务端就无从判断登录态。
  它不是漏洞，而是「凭据不落在前端」的代价。
