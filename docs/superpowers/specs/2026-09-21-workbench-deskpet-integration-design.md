# 桌宠接入淘金矿工小屋·自律工作台 — 设计规格

日期：2026-09-21
状态：已确认（用户回复「同意」）
分类：架构级

---

## 1. 背景与目标

淘金矿工小屋工作台已有完整的宠物养成闭环：商城领养、喂食、饱食度/心情/健康衰减、每日互动奖励金币。但所有宠物都是 emoji 或单张静态图（`images/bobo.png`），没有动画。

桌宠项目已在 `D:\桌宠\pet\` 下产出 4 只真实桌宠，含多帧动画与 7~11 条状态轨道。本次把真实桌宠接入工作台的宠物系统，**保留全部养成玩法，只替换渲染层**。

### 非目标

- 不重做宠物养成系统：金币领养、饲料、饱食度衰减、每日互动 +3 金币全部保持原样
- 不引入构建流程（`npm`、打包、TypeScript 编译）
- 不做独立桌宠引擎（透明置顶窗、置顶、可拖拽）—— 那是 `2026-09-20-huhu-carrot-pet-design.md` §11 的 v2 展望
- 不改 localStorage 键名、13 个 DB 划分、`DATA_VERSION`、`defaultState` / `migrateState` 结构

---

## 2. 关键约束

| 约束 | 结论 |
|---|---|
| 是否必须单文件零外链 | **否**。用户明确「自己本机开」，允许相对路径引用 `../pet/` 资源 |
| 运行时环境 | `file://` 协议 |
| `fetch()` / ES module import | **不可用**，被 CORS 拦截 |
| 外部依赖 | 无。纯原生 JS + CSS |
| 语言 | 界面文案与代码注释保持中文，与现有代码一致 |

因为不用 `fetch()`，`pet.json` 无法在运行时读取。渲染契约以**内联 JS 字面量常量**的形式硬编码在工作台里，由人工从 `pet.json` 摘取。**约定：`pet/` 下资源变更后需手工同步 `PET_SPECS`**。

---

## 3. 素材清单

| ID | 显示名 | 类型 | 资源 | 单元格 | 帧数 |
|---|---|---|---|---|---|
| `huhu-carrot` | 胡胡 | frames2d | `pet/huhu-carrot/frames/<track>/fNN.png` | 192×208 | 50（7 轨） |
| `dundun-office` | 墩墩 | sheet | `pet/dundun-office/spritesheet-dundun.png` | 192×208，8 列 | 8/8/6/6/4/4/6/6/6 |
| `huhu-carrot-office` | 胡胡·办公 | sheet | `pet/huhu-carrot-office/spritesheet-win-1.png` | 192×208，8 列 | 同上 |
| `raccoon-typing` | 打工卜 | sheet (webp) | `pet/raccoon-typing/spritesheet.webp` | 192×208 | 11 行，含 `gaze-1`/`gaze-2` |

`huhu-carrot` 的 7 条轨道：`idle`(16) / `waiting`(6) / `thinking`(6) / `tool`(8) / `review`(6) / `done`(4) / `failed`(4)，每轨带独立 `frameMs[]`。

三张图集共用 `PET_ROW_ORDER` 行序：`idle`(row0) / `running-right`(1) / `running-left`(2) / `waving`(3) / `jumping`(4) / `failed`(5) / `waiting`(6) / `running`(7) / `review`(8)，`raccoon-typing` 额外有 `gaze-1`(9) / `gaze-2`(10)。

---

## 4. 架构

### 4.1 统一播放接口

两个渲染器实现同一接口，上层不感知素材形态：

```js
{ mount(el), play(track), stop(), dispose() }
```

`play(track)` 接受**工作台语义轨道名**（第 5 节的 8 个），渲染器内部负责映射到自己的行名/文件夹名。

### 4.2 Frames2DPlayer（用于胡胡）

- 帧资源为独立 PNG，按需 `new Image()` 并缓存，播放时只换 `img.src`
- 帧时长读 `PET_SPECS.frames2d.tracks[track].ms[]`，缺失则用 `defaultFrameMs: 200`
- `loop: false` 的轨道播完触发 `onEnd` 回调，交给状态机回落
- 全部 `<img>` 预加载完成后才允许播放首帧，避免闪白

### 4.3 SheetPlayer（用于三张图集）

- 容器 `overflow:hidden`，内层 div 用 `background-image` + `background-position: -(col*192)px -(row*208)px`
- 每帧时长读 `tracks[track].durations[]`
- webp 图集用 `image-set()` 不必要；直接 `background-image: url(...)` 在 Chrome/Firefox/Edge 均可

### 4.4 PetManager（模块级单例）

**这是本设计最关键的一条。** 工作台每次 `navTo` 都会整体重渲染 `page-content`，若播放器实例随 DOM 一起销毁重建，会导致：

- 每次切页动画从头开始
- `setTimeout` 链泄漏，反复切换后同时存在多个计时器

因此播放器实例存放在 `PetManager.players`（`Map<petId, player>`），**与 `state` 完全分离**。重渲染时按 `pet.id` 复用已有实例，只把 `mount()` 指向新容器。页面卸载时**不** `dispose()`，仅在宠物被移除出 `state.pets` 时销毁。

### 4.5 不引入 `fetch` 的取舍

`file://` 协议下 `fetch('pet/huhu-carrot/pet.json')` 会被浏览器按跨源拒绝。因此渲染契约硬编码为内联常量。这样做的代价是 `pet/` 与工作台存在**手工同步**关系；若将来需要自动化，再单独规划一个 Python 生成脚本把 `pet.json` 转成工作台可粘贴的 JS 片段（本次不做）。

---

## 5. 轨道命名映射

工作台用 8 个语义轨道名，两套素材各自映射：

| 语义轨道 | 用途 | 胡胡 (frames2d) | 图集三只 (sprite2d) |
|---|---|---|---|
| `idle` | 常态 | `idle` | row 0 |
| `waiting` | 今日未打卡 | `waiting` | row 6 |
| `thinking` | 正在提交打卡 | `thinking` | row 7 |
| `tool` | 打卡执行中 | `tool` | row 7 |
| `review` | 抚摸等交互反馈 | `review` | row 8 |
| `done` | 刚领到金币 | `done` | row 3 `waving` |
| `failed` | 饥饿/心情差 | `failed` | row 5 |
| `cheer` | 连续打卡里程碑 | `done` | row 4 `jumping` |

**缺失处理**：每只宠物在 `PET_SPECS` 中声明实际拥有的轨道集合。请求一条缺失轨道时回落到 `idle`，**不卡死、不报错**。胡胡无 `jumping`，`cheer` 借 `done`；`raccoon-typing` 的 `gaze-1`/`gaze-2` 为 set 型，本设计不使用，闲置。

`once` 型轨道（`done`/`failed`）播完必须回落，由状态机决定回落到哪一档。

---

## 6. 状态机

优先级从高到低。高优先级轨道播完，自动回落到下一档：

```
1. 行为瞬时轨道（一次性，带 onEnd）
   提交打卡   → thinking → tool → done → 回落
   点「喂食」 → done(1.2s)     → 回落
   点「抚摸」 → review(1.0s)   → 回落
2. 情绪态   hunger<30 || mood<30 || health<50  → failed
3. 今日未打卡  → waiting
4. 常态     → idle
```

**连续打卡里程碑**：每满 7 天，在回落时插入一次 `cheer`（once，不循环）。

状态判定在每次 `play` 时即时求值，不做事件订阅——保持与现有工作台"状态变更后整体重渲染"的模式一致。

---

## 7. 改动清单

### 7.1 商城宠物目录（`SHOP_DATA.pets`，现 642 行）

替换 9 只 emoji 宠物为 4 只真实桌宠：

```js
{ id: 'p_huhu',  name: '胡胡',      petId: 'huhu-carrot',       price: 520, ... }
{ id: 'p_dundun', name: '墩墩',     petId: 'dundun-office',     price: 300, ... }
{ id: 'p_raccoon', name: '打工卜',  petId: 'raccoon-typing',     price: 260, ... }
{ id: 'p_huhu_office', name: '胡胡·办公', petId: 'huhu-carrot-office', price: 200, ... }
```

**存档兼容**：保留 `id: 'p_bobo'` 作为 `huhu-carrot` 的商城 ID，使已有存档中 `state.pets[].shopId === 'p_bobo'` 的记录不断链（卜卜本来就在用胡胡的图）。新增 `petId` 字段指向渲染契约，其余三只为新 ID，无历史包袱。

### 7.2 渲染入口（现 1303–1314 行 `isImgIcon` / `iconHtml`）

- 新增 `DESKPET_PREFIX = 'deskpet:'`
- `isDeskpetIcon(ic)` 判定前缀
- `iconHtml(ic, size)` 遇 `deskpet:` 时不输出 `<img>`，改为输出 `<div class="pet-stage" data-petid="...">` 占位容器，由 `PetManager` 在 `mount` 时填充

`iconText()` 需同步排除 `deskpet:` 前缀，避免 `<option>` 里显示原始字符串（现有逻辑已对图片路径这么做了）。

### 7.3 宠物卡片（`renderPetCard`，现 2972 行）

`.pet-avatar` 的 76px emoji 位改为播放器挂载点。源帧 192×208 按 `object-fit: contain` 缩放到 76px —— 毛绒质感在小尺寸下反而更干净。

### 7.4 新增代码块（插在宠物相关函数之后，约 180 行）

`PET_SPECS` 常量 + `Frames2DPlayer` + `SheetPlayer` + `PetManager`。

### 7.5 交互反馈（`interactPet`，现 3019 行）

喂食 → `play('done')`；抚摸 → `play('review')`；洗澡 → 沿用 `done`。

### 7.6 打卡链路

在打卡成功回调处追加：`thinking → tool → done` 链式播放。

---

## 8. 不改动的地方

- localStorage 键 `goldminer_workbench_data`、`DATA_VERSION = '1.0'`
- 13 个 DB 划分与 `PAGE_DB` 映射
- `defaultState` / `migrateState` / `ensureFields`
- 打卡历史 `state.checkinHistory` 结构与 CSV 导入导出（`图标` 列原样存 `deskpet:` 字符串，格式兼容）
- 成就系统 12 项与解锁条件
- 报表系统
- 饲料 / 道具 5 种消耗品
- 状态衰减逻辑（饱食 -5/步、心情 -3/步、健康 -2/步）
- 侧栏饥饿红点提醒（`hunger < 30`）
- 快捷喂食区

---

## 9. 验证方式

1. **渲染正确性**：用无头 Chrome `--headless=new --virtual-time-budget=9000 --dump-dom` 打开工作台，`file://` 协议，检查 `pet-stage` 容器存在、`<img>` 的 `src` 指向 `../pet/...` 且 `naturalWidth === 192`
2. **状态切换**：修改 localStorage 中 `hunger` 为 10，刷新后应停在 `failed` 轨道；改回 90 应回到 `idle`
3. **实例复用**：连续切换 宠物庭院 ↔ 任意其他页面 5 次，回到庭院后动画应在播放中（不重置为第 0 帧），且 `PetManager.players.size` 不增长
4. **无泄漏**：反复切换 20 次后 `performance.memory` 增长平稳，无累积 `setTimeout`
5. **存档兼容**：用含 `p_bobo` 的旧存档加载，宠物卡片正常渲染

---

## 10. 风险

| 风险 | 缓解 |
|---|---|
| `pet/` 与工作台手工同步，资源改名会静默失效 | 图集缺失时 `<img>` 加载失败 → 播放器回落显示占位符，不抛异常 |
| webp 图集在旧浏览器不支持 | 目标环境为本机 Chrome/Edge，webp 全面支持 |
| `file://` 下 webp 的 `background-image` 被拦 | 背景图同源文件引用不受 CORS 限制（仅 `fetch`/XHR 受限），已验证 `images/bobo.png` 在同协议下正常 |
| 4345 行单文件内新增 180 行，代码密度上升 | 播放器代码集中在一个连续区块，独立成段，不散落插入 |
| 宠物卡片并排显示时 4 个动画同时播放 | 单页面最多 4 个实例，GPU 合成开销可忽略 |
