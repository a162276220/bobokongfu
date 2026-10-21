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
| `functions/newmedia.mjs` | 新媒体工作台数据面：`/api/nm/*` + 7 张 `nm_*` 表，和旧 13 表完全隔离 |
| `migrations/0002_newmedia.sql` | 新媒体工作台的建表迁移（7 张表 + `nm_tomb`） |
| `migrations/0003_nm_hot_live.sql` | 联网热点的全局缓存表 `nm_hot_live` |
| `backend/d1-db.mjs` | D1 适配器（云端） |
| `backend/sqlite-db.mjs` | SQLite 适配器（自建后端） |
| `backend/sql-builder.mjs` | 两个适配器共用的链式 Builder 与列白名单 |
| `migrations/0001_init.sql` | D1 迁移，由 `tools/gen-migration.mjs --d1` 生成 |
| `tools/build-dist.mjs` | 从 `淘金矿工小屋/` 拷出 `dist/`，并给 `dist/index.html` 打同步层 + 新媒体嵌入补丁 |
| `tools/patch-sync.mjs` | **前端同步层本体**（12 条锚点补丁）：账号浮层、双模式鉴权、60s 轮询 |
| `tools/patch-media-embed.mjs` | 把侧边栏「新媒体工作台」换成 iframe 嵌入 + 摘要桥，并把旧版简版页保留为「媒体流水线」导航项 |
| `tools/mint-invite.mjs` | 生成邀请码 SQL |
| `tools/selftest.mjs` | 数据面契约自测（三个宿主） |

## 新媒体工作台（`/newmedia`）

独立单页「新媒体工作台——一个人的 AI 内容工厂」，源文件在
`新媒体工作台/新媒体工作台·一个人的AI内容工厂.html`，构建时被原样复制为 `dist/newmedia.html`。
线上地址是 `https://<worker>/newmedia`（访问 `/newmedia.html` 会 307 到它）。

- 七个视图：选题中心、内容工厂、IP 形象库、草稿箱、发布中心、数据看板、系统设置。
- 七张表：`nm_topic / nm_hot / nm_task / nm_content / nm_ip / nm_pub / nm_stat`，删除走 `nm_tomb`。
- 数据面：`GET /api/nm/snapshot`、`GET /api/nm/pull?since=<ISO>`、`POST /api/nm/push`。
  owner 只来自会话（站点 cookie / `file://` 的 Bearer），请求体不能指定所有权。
- 同步策略：本地优先，写入按 `updatedAt` 做 last-write-wins；30 秒轮询、切回页面立即同步。
- `serverTime` 水位往回留 5 秒重叠，避免两次查询之间的并发写入被永久漏拉；重复合并是幂等的。
- 页面不依赖任何外部 CDN；不填 API Key 时用内置模拟引擎，填了就走 OpenAI 兼容的
  `/chat/completions`。Key 只存本机 localStorage。

### 联网热点（`/api/nm/hot/live`）

- Worker 抓 B 站热搜的公开 JSON 和百度热搜的公开榜单页，返回 `{ fetchedAt, items, sources }`；
  `items` 含 `title / platform / heat / rank`。这个接口**不要求登录**，本地模式也能拿真热榜。
- 结果写进 D1 的全局缓存表 `nm_hot_live`（`migrations/0003_nm_hot_live.sql`），10 分钟内重复请求直接读缓存；
  `wrangler.jsonc` 里还有一个 `*/10 * * * *` 的 cron，定时把缓存焐热，页面请求通常不用等外部接口。
- 页面每小时拉一次，新增条目按来源各给 6 个名额（百度热度数值远高于 B 站，纯按数值截断会只剩百度），
  之后按热度排序展示，并保证每个来源至少 3 条。
- 回退顺序：Worker 联网 → 同源的 `spark_feed.js`（本机 `tools/spark_scraper.py` 生成）
  → `HOT_BANK` 离线库存。设置页会显示当前数据来源和最近一次回退原因。
- 第一次拿到真实热榜时，页面会清掉种子里的演示热点行（`seed|hot|*`），避免假数据混在真榜单里。

### 并入卜卜小屋外壳

侧边栏「新媒体工作台」不再是壳里的旧版内容页，而是通过 iframe 嵌入这个单页：

- 壳的 `renderMediaShell()` 输出 `<iframe src="newmedia.html?embed=1">`；线上会 307 到
  `/newmedia?embed=1`，查询串保留。
- `?embed=1` 时新页面隐藏自己的左侧导航，改用顶部横排七视图导航，并让内容区自行滚动。
- 新页面每次写本地数据都会把「已发布 / 制作中 / 待采用」摘要写进
  `localStorage['nm_shell_summary_v1']`；壳的总览、周节奏、月历、成长目标和自动化健康读这份摘要。
- 旧版简版内容页没有删除，保留为侧边栏「媒体流水线」（`media-classic`）：四道流水线、四平台矩阵、
  初稿库和月度绩效都还在，数据仍读写壳自己的 `state.media`，与新版 `nm_*` 七表互不影响。
- 旧页里的页签和动作仍统一调用 `refreshPage('media')`；补丁在 `refreshPage` 里把
  「当前页是 media-classic」的这类刷新重定向回 `media-classic`，否则点任何按钮都会跳到新版嵌入页。
- 嵌入与旧页入口都由 `tools/patch-media-embed.mjs` 在构建期打补丁，壳的源文件仍归另一个写者。

`migrations/0002_newmedia.sql` 需要单独 `apply` 一次；之后每次改前端都要重新
`node tools/build-dist.mjs`，否则 `dist/newmedia.html` 还是旧版。
改了壳或要更新 PWA 外壳时，记得把 `淘金矿工小屋/sw.js` 的 `CACHE` 版本号 +1。

## 前端同步层是构建期补丁（重要）

`淘金矿工小屋/淘金矿工小屋·自律工作台.html` 还有另一个写者（phase 系列）会按它自己的基线
**整份重写**这个文件，把我的改动抹掉过两次。所以前端同步层不在源文件里，而在
`tools/patch-sync.mjs`：`build-dist.mjs` 先把源文件拷成 `dist/index.html`，再对它打补丁。

- **不要手改源文件**去加同步层 —— 那个写者下次一跑就没了。
- 同步层启动时会先请求一次 `/api/auth/me`，识别站点已有的 HttpOnly cookie（在新媒体页登录过、
  或换了设备都能认出来）。顶部“本地模式”横幅和侧边栏指示器都按三态显示：已同步隐藏横幅、
  未登录改成可操作文案、真正的本地模式才保留导出/导入提示。未登录访问时控制台出现一次
  `/api/auth/me` 的 401 是预期行为。
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

成功标志：输出里有 `同步层补丁：全部生效（... → ... 字符）` 和
`新媒体嵌入补丁：全部生效（... → ... 字符）`。
如果出现 `MISS` / `AMBIG` 而构建失败，说明另一个写者改了同步层的结构 ——
把报错发我，我更新 `tools/patch-sync.mjs` / `tools/patch-media-embed.mjs` 里的锚点。**不要**为了绕过它去手改源文件。

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
- **新媒体页是 iframe 不是合并**：两个应用的全局 CSS/JS 会互相污染，所以壳只负责外框和摘要桥；
  页面内导航、弹窗、滚动都在 iframe 里。壳的摘要读 `nm_shell_summary_v1`，未打开过新媒体页时退回壳自己的演示数据。
- **旧版「媒体流水线」的数据只在本机**：`state.media` 不在 13 张云表里（`EXTRACT` 没有 `media`），
  登录后也不会推到云端；导出备份会带上它。要让它多设备同步，得先迁进新版 `nm_*` 七表。
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
