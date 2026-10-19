# goldminer-hut —— 淘金矿工小屋的云端数据面

一个 Cloudflare Worker，同时干两件事：

- 把 `dist/` 里的站点静态资源发出去（`env.ASSETS`）；
- 提供 `/api/*`：账号、会话，以及 13 张业务表的数据面。

`wrangler.jsonc` 里 `assets.run_worker_first = ["/api/*"]` 保证 `/api/*` 先到 Worker，其余直接走静态资源。
数据真身在 D1；前端 localStorage 只是运行时缓存。

## 目录

| 路径 | 作用 |
|---|---|
| `functions/worker.mjs` | Worker 入口：路由、cookie / Bearer 双模式鉴权、CORS、静态资源 |
| `functions/session.mjs` | 账号、会话、邀请码（PBKDF2-SHA256；会话令牌只存哈希） |
| `functions/handler.mjs` | 数据面，只依赖注入的 `db` 与 `getUser`，三个后端共用同一份 |
| `functions/schema.mjs` | 13 张业务表 + 账号表的唯一真源（列名、DDL） |
| `backend/d1-db.mjs` | D1 适配器（云端） |
| `backend/sqlite-db.mjs` | SQLite 适配器（自建后端） |
| `backend/sql-builder.mjs` | 两个适配器共用的链式 Builder 与列白名单 |
| `migrations/0001_init.sql` | D1 迁移，由 `tools/gen-migration.mjs --d1` 生成 |
| `tools/build-dist.mjs` | 从 `淘金矿工小屋/` 拷出 `dist/`，并给 `dist/index.html` 打同步层补丁 |
| `tools/patch-sync.mjs` | **前端同步层本体**（12 条锚点补丁）：账号浮层、双模式鉴权、60s 轮询 |
| `tools/mint-invite.mjs` | 生成邀请码 SQL |
| `tools/selftest.mjs` | 数据面契约自测（三个宿主） |

## 前端同步层是构建期补丁（重要）

`淘金矿工小屋/淘金矿工小屋·自律工作台.html` 还有另一个写者（phase 系列）会按它自己的基线
**整份重写**这个文件，把我的改动抹掉过两次。所以前端同步层不在源文件里，而在
`tools/patch-sync.mjs`：`build-dist.mjs` 先把源文件拷成 `dist/index.html`，再对它打补丁。

- **不要手改源文件**去加同步层 —— 那个写者下次一跑就没了。
- 补丁幂等，可以反复跑；但锚点找不到会**让构建直接失败**，因为「站点看着正常、其实没有云同步」
  比构建失败坏得多（打完还会复检关键标记）。
- 单独跑：`node tools/patch-sync.mjs goldminer-hut/dist/index.html`
- 测试测的是「源文件 + 补丁」这条真实链路：`tests/goldminer-sync-harness.mjs` 自己先跑一遍 `applyPatches`。

## 部署（一次性）

在**你自己的终端**里跑（需要 Node 与 Cloudflare 账号，免费版够用）：

每一步都写了「跑完应该看到什么」，对不上就停在那一步，别往下走。

### 0. 先确认 `wrangler.jsonc` 里那个 D1 ID 是不是你的

第 18 行现在填的是 `092e19b7-5b82-4571-8b5d-77ab9ad0a996`。**它不一定存在于你的账号下**。

```bash
cd goldminer-hut
npm install
npx wrangler login            # 浏览器弹窗 → 点 Allow
npx wrangler d1 list          # 列表里有没有上面那个 UUID
```

- **在列表里** → 跳过第 1 步。
- **不在** → 跑第 1 步，用新生成的 ID 替换第 18 行那个值。

### 1. 建库（仅当第 0 步没找到时）

```bash
npx wrangler d1 create goldminer
```

成功标志：输出里有 `database_id = "..."` 和 `✅ Successfully created DB 'goldminer'`。
把这个 UUID 粘进 `wrangler.jsonc` 第 18 行，替换掉原来的值。

### 2. 建表

```bash
npx wrangler d1 migrations apply goldminer --remote
```

成功标志：列出 `0001_init.sql` 并提示 `✅ Applied`。它会建 13 张业务表 +
`users / sessions / invites / devices / tomb`。想确认：

```bash
npx wrangler d1 execute goldminer --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

### 3. 构建前端（**每次部署前都要跑**）

```bash
node tools/build-dist.mjs
```

成功标志：输出里有 `同步层补丁：全部生效（... → ... 字符）`。
如果出现 `MISS` / `AMBIG` 而构建失败，说明另一个写者改了同步层的结构 ——
把报错发我，我更新 `tools/patch-sync.mjs` 里的锚点。**不要**为了绕过它去手改源文件。

### 4. 部署

```bash
npx wrangler deploy
```

成功标志：输出 `Deployed goldminer-hut triggers` 和一个 `https://goldminer-hut.<你的子域>.workers.dev` 地址。
那个地址就是站点，也是 `/api/*`。

### 5. 生成邀请码

```bash
node tools/mint-invite.mjs 3 30
```

它打印 3 个邀请码和一条 `npx wrangler d1 execute ... --command "INSERT ..."` 命令，**原样复制执行**即可
（SQL 里只有单引号，PowerShell 的双引号包裹不会破坏它）。

### 6. 浏览器验收（6 步）

1. 打开 Worker 地址 → 左下角金色按钮显示 `🔒 登录 / 注册`
2. 点它 → 填用户名 / 密码（≥8 位）/ 邀请码 → 点「注册并登录」→ 变成 `☁️ 你的用户名`
3. 记一笔数据 → 刷新 → 还在
4. 换浏览器或手机登录同一账号 → **看到同一份数据**
5. 用另一个邀请码注册第二个账号 → 看到的是**空数据**
6. 点「退出登录」→ 回到 `🔒 登录 / 注册`

若第 2 步报 `1102`（CPU 超限）：把 `functions/session.mjs` 的 `PBKDF2_ITERATIONS` 调小再部署；
迭代数逐用户存在 `pw_iter` 里，改常量不会锁住已有用户。

### 7.（可选）让 `file://` 直开也能连云端

```bash
CLOUD_ORIGIN=https://你的地址.workers.dev node tools/build-dist.mjs && npx wrangler deploy
```

站点模式不需要这一步 —— 同源请求自己找得到 `/api/app`。
PowerShell 里用 `$env:CLOUD_ORIGIN='https://...'; node tools/build-dist.mjs`。

## 本地开发

```bash
cd goldminer-hut
npx wrangler dev            # 需要先 node tools/build-dist.mjs
npx wrangler d1 migrations apply goldminer --local
node tools/mint-invite.mjs 1 30   # 打印的 SQL 用 --local 执行
```

**不想装 wrangler 也能本地验**（它跑不起时尤其有用）：`node goldminer-hut/tools/devserver.mjs` ——
它托管 `dist/`，把 `/api/*` 转发给**同一个 Worker**，D1 用 `node:sqlite` 顶掉，启动时自动跑迁移，
库文件在 `goldminer-hut/.wrangler/dev.sqlite`。浏览器打开 `http://127.0.0.1:8788/` 就能走完整的
注册 → 登录 → 同步；`/__debug/store?table=ast` 可以直接看库里存了什么。

本地是 http，带 `Secure` 的 cookie 浏览器不会存；Worker 只在 `https:` 上加 `Secure`，所以本地登录靠响应里的
`token`（前端会存进 localStorage 当 Bearer 用）。

## 自建后端（可选）

`backend/server.mjs` + SQLite 仍是可用的自建后端，走设置页里的「接口地址 / 访问令牌」。
它和云端实现同一套 `query / insert / update / delete` 契约，因为用的就是同一份 `handler.mjs` 与
`sql-builder.mjs`。

## 数据搬家

老数据用侧边栏「导出数据」拿一份 JSON，在云端站点「导入数据」灌进去（导入会整表上传并丢掉对账快照）。

## 已知边界

- **没有数据库级 RLS**：行级归属只靠 `handler.mjs` 里的 `.eq('owner', owner)`，而 `owner` 只从会话推出，
  请求体里带什么都不看。跨账号隔离由 `tests/goldminer-cloud-harness.mjs` 的 C 段守。
- **`file://` 的 CORS 不是保护**：`Origin: null` 任何本地页面都能伪造，真正的保护是 Bearer 里的会话令牌。
- **D1 免费额度按行计费**：一次拉取是 13 张表全表读。前端因此用 60s 轮询 + 页面不可见时暂停；
  更省的增量拉取（墓碑表 + `since`）是下一个计划的事，`tomb` 表与 `(owner, updated_at)` 索引已经建好。
- **前端同步层在补丁里，不在源文件里**：见上面那节；改同步层请改 `tools/patch-sync.mjs`。
- **PBKDF2 的 CPU 计入未实测**：本机量到 100k 迭代约 13ms（见 spec §5.2）。若部署后登录出现 1102，
  把 `functions/session.mjs` 里的 `PBKDF2_ITERATIONS` 调小即可 —— 迭代数逐用户存在 `pw_iter` 里，
  改常量不会把既有用户挡在门外。

## 测试

```bash
node tools/selftest.mjs                        # 数据面：内存假库 + SQLite + D1 三宿主
node ../tests/goldminer-cloud-harness.mjs   # 迁移、账号、会话、Worker、跨账号隔离
node ../tests/goldminer-sync-harness.mjs    # 前端同步层（抽出来跑在假 DOM 里）
node ../tests/goldminer-devserver-smoke.mjs # 本地开发服务器：真进程 + 真 HTTP
cd .. && python -m pytest tests/test_goldminer_cloud.py -q   # 上面四条的统一入口
```
