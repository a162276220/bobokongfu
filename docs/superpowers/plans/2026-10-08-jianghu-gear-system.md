# 江湖装备与器物系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给江湖的银两一个可持续的出口——掉落与商城供货、背包手动穿戴、按品阶封顶的强化，并让装备加成并入四维属性。

**Architecture:** 内容（`wuxia-content.js` 的 `GEAR` 表、敌人掉落声明）与规则（`jianghu.js` 的派生值、动作、渲染）分离，沿用本模块既有约定。新增 `gearBonus()`/`setBonus()` 两层加成接进 `stats()`，成为 `power()`/`maxHp()`/`foeTurn` 防御/事件门槛 `meets()` 的统一真源；新增状态 `state.jianghu.gear`，由既有 `ensureFields` 补默认值、由既有 `sanitize()` 做存档自愈。

**Tech Stack:** 纯 ES5 浏览器脚本（无构建链、无依赖）；测试为 Node vm 沙箱探针（`tests/jianghu-harness.mjs`）加 pytest 断言（`tests/test_jianghu.py`）。

**Spec:** `docs/superpowers/specs/2026-10-08-jianghu-gear-system-design.md`

## Global Constraints

- 核心前提不可破坏：时辰只来自真实打卡（`WUXIA.TASK_HOURS` → `Jianghu.earnHours`）。
- 门派加成（`SECTS[].bonus`）与宠物伙伴加成（`PET_BONUSES`）的既有语义不变。
- `stats()` 的叠加顺序固定为：自身四维 → 门派 → 宠物伙伴 → 装备 → 套装，每层纯加法。
- 四槽珍品满强化的四维合计恰为 **+48**；含套装的四维合计上限 **~71**。调参不得突破。
- 槽位固定四个：`weapon` / `armor` / `boots` / `charm`。
- 品阶 `tier` ∈ {0,1,2}，对应强化上限 2 / 4 / 6 级。
- 强化消耗公式固定：`round(price × 0.25 × 目标等级)`；效果为**仅主属性 +1**。
- 主属性 = `bonus` 中数值最大的键；**并列时按 `neili > gengu > shenfa > wuxing` 取**（保证确定性）。
- 套装属性 = `Object.keys(sect().bonus)[0]`（少林根骨 / 武当内力 / 唐门身法），穿齐 2 件 +1、4 件 +2。
- 旧存档必须能打开江湖页；失效引用由 `sanitize()` 清理且**幂等**，健康存档**一字不动**。
- 装备条目 `bonus` 的键必须属于 `neili`/`gengu`/`shenfa`/`wuxing`，值为**正整数**。
- 现有 70 项 `tests/jianghu-verify.mjs`、35 项 `tests/jianghu-gaps.mjs`、13 项 `tests/test_jianghu.py` 必须继续全绿。

## Review Focus

spec 未明说、但使用者会合理期待不崩的输入类别，按可能性排序。每条都在拥有该代码的任务里配了测试。

1. **`state.jianghu.gear` 存在但类型错**（`owned` 是数组、`equipped` 是字符串、`owned[id]` 是数字而非对象）——玩家手改存档或早期版本残留。期望：不崩、被自愈成合法结构。
2. **装备 `bonus` 出现 0 或负数**（内容编写笔误）——期望：内容校验直接拒绝，而不是让玩家刷出负属性或零收益装备。
3. **同一件装备重复 `equipGear`**——期望：幂等，不产生重复计数、不改变 `setBonus()` 的件数。
4. **`upgradeGear` 时银两恰好等于消耗**——期望：成功，且 `taels` 归零而非变负。
5. **穿 3 件同门装备**（既非 2 也非 4）——期望：按 2 件档给 +1，而不是给 +2 或 0。

---

### Task 1: GEAR 内容表与内容校验

**Files:**
- Modify: `淘金矿工小屋/wuxia-content.js`（新增 `GEAR` 常量与导出）
- Modify: `tests/jianghu-harness.mjs`（新增 GEAR 内容校验）
- Test: `tests/test_jianghu.py`

**Interfaces:**
- Consumes: 无（本任务是最底层数据）
- Produces: `WUXIA.GEAR` — 数组，元素形如
  `{ id: string, name: string, slot: 'weapon'|'armor'|'boots'|'charm', sect: string|null, tier: 0|1|2, bonus: {neili?:number, gengu?:number, shenfa?:number, wuxing?:number}, price: number }`

内容要求（24 件，按 spec §4.1 与 §5.4）：

- **通用款 12 件**（`sect: null`）：4 槽 × 3 品阶。凡品 `bonus` 合计 2、价 60–120；精品合计 4、价 250–400；珍品合计 6、价 600–900。
- **门派款 12 件**（3 门派 × 4 槽）：均为 `tier: 1`（精品）、`price: 350`，`bonus` 偏向该门派身份属性（少林根骨 / 武当内力 / 唐门身法）并合计 4。
- 每件的 `id` 形如 `<slot>_<general|sectid>_t<tier>`（如 `weapon_general_t0`、`armor_shaolin_t1`）。

- [ ] **Step 1: 写失败的内容校验测试**

在 `tests/test_jianghu.py` 追加：

```python
def test_gear_table_is_valid(report):
    assert report["contentProblems"] == [], report["contentProblems"]

def test_gear_table_shape(report):
    gear = report["coverage"]["gear"]
    assert gear["total"] == 24
    assert gear["general"] == 12
    assert gear["sect"] == 12
    assert gear["slots"] == ["armor", "boots", "charm", "weapon"]
```

（`report` 是本文件既有的 module 级 fixture，产出 harness 的 JSON；用法照抄同文件现有测试。）

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/test_jianghu.py -q -k gear`
Expected: FAIL —— `coverage` 里没有 `gear` 键，且 `contentProblems` 报 `GEAR 表缺失`。

- [ ] **Step 3: 在 `wuxia-content.js` 写 `GEAR` 表并导出**

按上面的内容要求逐件写出 24 条。文件末尾的导出语句加入 `GEAR: GEAR`。

- [ ] **Step 4: 在 `tests/jianghu-harness.mjs` 加 GEAR 校验**

在既有内容校验块之后追加，问题写入 `contentProblems`，统计写入 `coverage.gear`：

- `id` 全局唯一且非空；`name` 非空
- `slot` ∈ `['weapon','armor','boots','charm']`
- `bonus` 非空对象；每个键 ∈ 四维；**每个值必须是正整数**（拒绝 0 与负数——Review Focus 第 2 条）
- `bonus` 值合计等于该 `tier` 的规格（0→2、1→4、2→6）
- `tier` ∈ {0,1,2}；`price` 为正整数
- `sect` 要么 `null`，要么存在于 `WUXIA.SECTS`
- 门派款必须是 `tier === 1` 且 `price === 350`
- `coverage.gear` 输出 `{total, general, sect, slots}`，`slots` 为出现过的槽位排序数组

- [ ] **Step 5: 跑测试确认通过**

Run: `python -m pytest tests/test_jianghu.py -q`
Expected: PASS（原 13 项 + 新增 2 项）

- [ ] **Step 6: 提交**

```bash
git add 淘金矿工小屋/wuxia-content.js tests/jianghu-harness.mjs tests/test_jianghu.py
git commit -m "feat: add the jianghu gear table and its content validation"
```

---

### Task 2: 存档字段、默认值与自愈

**Files:**
- Modify: `淘金矿工小屋/淘金矿工小屋·自律工作台.html`（`defaultState().jianghu` 增加 `gear`）
- Modify: `淘金矿工小屋/jianghu.js`（`sanitize()` 扩展）
- Test: `tests/jianghu-gaps.mjs`

**Interfaces:**
- Consumes: `WUXIA.GEAR`（Task 1）
- Produces:
  - `state.jianghu.gear === { owned: {}, equipped: { weapon: null, armor: null, boots: null, charm: null } }`
  - `SLOTS = ['weapon','armor','boots','charm']`（`jianghu.js` 模块内常量）
  - `gearItem(id) -> item | null`（`WUXIA.GEAR` 查找）
  - `gearTierCap(item) -> number`（返回 `item.tier`）
  - 扩展后的 `sanitize()` 返回 `true` 表示有改动

- [ ] **Step 1: 写失败的自愈测试**

在 `tests/jianghu-gaps.mjs` 追加断言（沿用该文件既有的 `check`/`healthy` 结构）：

- `owned` 指向已删装备 → `render()` 不抛异常，且该键被删除
- `equipped.weapon` 指向已删装备 → 被置为 `null`
- `equipped.armor` 指向不在 `owned` 里的 id → 被置为 `null`
- `equipped` 出现非法槽位键（如 `ring`）→ 该键被删除
- `owned[id].lvl` 超过 `gearTierCap` → 被截断到上限
- `gear.owned` 是数组、`gear.equipped` 是字符串（**Review Focus 第 1 条**）→ 不抛异常，被重建成合法结构
- 自愈幂等（连续两次 `sanitize()`，第二次返回 `false`）
- 健康存档（含已穿装备）经 `sanitize()` 后字段一字不动

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/jianghu-gaps.mjs`
Expected: FAIL —— `state().gear` 为 `undefined`，断言取不到 `owned`。

- [ ] **Step 3: 在 `defaultState().jianghu` 加入 `gear` 默认值**

在 `淘金矿工小屋·自律工作台.html` 的 `defaultState()` 中，`jianghu` 对象内追加：

```js
gear: { owned: {}, equipped: { weapon: null, armor: null, boots: null, charm: null } },
```

`ensureFields` 会为旧存档补齐这一子键（其内层循环逐个子键比对 `defaultState().jianghu`）。

注意：`tests/test_jianghu.py` 已有一个 `test_the_default_state_covers_every_field_the_engine_touches(html)`
用例在守这件事，改完 `defaultState()` 后务必一并跑它。

- [ ] **Step 4: 在 `jianghu.js` 实现 `SLOTS`、`gearItem`、`gearTierCap` 与 `sanitize()` 扩展**

`sanitize()` 在既有清理之后追加装备段，顺序为：先规整结构（`owned` 必须是普通对象、`equipped` 必须是普通对象且键 ∈ `SLOTS`），再逐项校验引用，最后截断 `lvl`。每类清理都走 `log()`，`changed` 置真。

- [ ] **Step 5: 跑测试确认通过**

Run: `node tests/jianghu-gaps.mjs`
Expected: PASS（原 35 项 + 新增 8 项）

- [ ] **Step 6: 提交**

```bash
git add 淘金矿工小屋/jianghu.js 淘金矿工小屋/淘金矿工小屋·自律工作台.html tests/jianghu-gaps.mjs
git commit -m "feat: persist a gear field and self-heal saves whose gear ids are gone"
```

---

### Task 3: gearBonus、setBonus 与 stats() 接入

**Files:**
- Modify: `淘金矿工小屋/jianghu.js`（新增 `mainStat`/`gearBonus`/`setBonus`，修改 `stats()`）
- Test: `tests/jianghu-verify.mjs`

**Interfaces:**
- Consumes: `SLOTS`、`gearItem`、`state().gear`（Task 2）；`WUXIA.SECTS[].bonus`（既有）
- Produces:
  - `mainStat(item) -> 'neili'|'gengu'|'shenfa'|'wuxing'`
  - `gearBonus() -> {neili:number, gengu:number, shenfa:number, wuxing:number}`（四个键恒存在，未加成者为 0）
  - `setBonus() -> {}` 或 `{<统计属性>: 1|2}`
  - `stats()` 返回值 = 自身 + 门派 + 宠物伙伴 + `gearBonus()` + `setBonus()`

- [ ] **Step 1: 写失败的玩法测试**

在 `tests/jianghu-verify.mjs` 追加断言：

- 单槽装备 → `gearBonus()` 等于该件 `bonus`
- 四槽全穿 → 各属性为四件之和
- 强化 2 级后 → **只有主属性 +2**，其余键不变
- `mainStat({neili:3, gengu:3})` → `'neili'`（**并列取 `neili`**）
- 未入门派穿门派款 → `setBonus()` 为空对象（不生效）
- 入门派后穿 1 件本门 → 空对象；穿 2 件 → `+1`；穿 3 件 → **仍为 +1**（**Review Focus 第 5 条**）；穿 4 件 → `+2`
- 穿别派门派款 4 件 → `setBonus()` 仍为空对象
- `stats()` 顺序断言：构造"自身 5 / 门派 +4 / 宠物 +1 / 装备 +2 / 套装 +1"，断言合计恰为 13
- **数值纪律**：四槽珍品满强化的 `gearBonus()` 四维合计恰为 **48**

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/jianghu-verify.mjs`
Expected: FAIL —— `Jianghu.gearBonus is not a function`。

- [ ] **Step 3: 在 `jianghu.js` 实现三个函数并修改 `stats()`**

`mainStat` 按 `['neili','gengu','shenfa','wuxing']` 顺序遍历取严格最大者（并列时先出现者胜）。`gearBonus` 遍历 `SLOTS`，每槽加上 `item.bonus` 全部键，再给 `mainStat(item)` 加 `owned[id].lvl`。`setBonus` 统计已穿中 `sect === state().sect` 且 `sect !== null` 的件数，按 2/4 档返回。`stats()` 在既有门派与宠物之后追加这两层。

**关键**：`Jianghu` 导出对象需新增 `gearBonus`、`setBonus`、`mainStat`，否则测试取不到（沿用既有导出写法）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/jianghu-verify.mjs`
Expected: PASS（原 70 项 + 新增 9 项）

- [ ] **Step 5: 提交**

```bash
git add 淘金矿工小屋/jianghu.js tests/jianghu-verify.mjs
git commit -m "feat: fold gear and set bonuses into the four stats"
```

---

### Task 4: 四个动作（买 / 穿 / 卸 / 强化）

**Files:**
- Modify: `淘金矿工小屋/jianghu.js`
- Test: `tests/jianghu-verify.mjs`

**Interfaces:**
- Consumes: Task 2、Task 3 的全部产物
- Produces:
  - `upgradeCost(item, currentLvl) -> number`（`Math.round(item.price * 0.25 * (currentLvl + 1))`）
  - `buyGear(id)`、`equipGear(id)`、`unequipGear(slot)`、`upgradeGear(id)`
  - 四个动作均遵循既有模式：校验 → `showToast` → 改状态 → `log` → `save` → `rerender`

- [ ] **Step 1: 写失败的玩法测试**

在 `tests/jianghu-verify.mjs` 追加断言：

- `buyGear`：银两不足 → 被拒且 `taels` 不变；别派门派款 → 被拒；已拥有 → 被拒；成功 → 扣 `price` 且 `owned[id].lvl === 0`
- `equipGear`：未拥有 → 被拒；成功 → `equipped[item.slot] === id`；**穿第二件同槽 → 旧件仍在 `owned` 里**
- **重复 `equipGear` 同一件 → 幂等**（**Review Focus 第 3 条**）：`equipped` 与 `setBonus()` 件数都不变
- `unequipGear`：合法槽位置空；非法槽位 → 被拒且状态不变
- `upgradeGear`：未拥有 → 被拒；已达 `gearTierCap` → 被拒且 `taels` 不变；银两不足 → 被拒；成功 → `lvl + 1` 且 `taels` 减少 `upgradeCost`
- **银两恰好等于消耗时成功且 `taels === 0`**（**Review Focus 第 4 条**）
- `upgradeCost(item, 0)` 恰为 `Math.round(price * 0.25)`
- 不变量：任何动作后 `taels >= 0`、四维无 NaN

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/jianghu-verify.mjs`
Expected: FAIL —— `Jianghu.buyGear is not a function`。

- [ ] **Step 3: 在 `jianghu.js` 实现四个动作**

别派判定为 `item.sect && item.sect !== state().sect`。全部校验用早返回加 `showToast(..., 'warning')`，与既有 `learn()` 的写法保持一致。`buyGear` 成功后 `owned[id] = { lvl: 0 }`；`upgradeGear` 用 `upgradeCost(item, lvl)` 扣费并把 `lvl` 加一。

导出对象新增这四个函数。

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/jianghu-verify.mjs`
Expected: PASS（累计约 90 项）

- [ ] **Step 5: 提交**

```bash
git add 淘金矿工小屋/jianghu.js tests/jianghu-verify.mjs
git commit -m "feat: add buy, equip, unequip and upgrade actions for gear"
```

---

### Task 5: 获取途径——掉落、事件奖励与重复折算

**Files:**
- Modify: `淘金矿工小屋/wuxia-content.js`（`FOES[].drops`、事件 `outcome.gain.gear`）
- Modify: `淘金矿工小屋/jianghu.js`（`finishDuel()`、`applyOutcome()`、新增 `grantGear`）
- Modify: `tests/jianghu-harness.mjs`（掉落引用闭合校验）
- Test: `tests/jianghu-verify.mjs`、`tests/test_jianghu.py`

**Interfaces:**
- Consumes: Task 1 的 `GEAR`、Task 4 的 `buyGear` 状态结构
- Produces:
  - 掉落声明两种形态：
    - `{ kind: 'general', gear: '<id>', chance: 0.15 }`
    - `{ kind: 'sect', slot: 'armor', chance: 0.10 }` —— 运行时解析为**玩家本门**该槽位的装备
  - `resolveDrop(drop) -> item | null`（`kind:'sect'` 时按 `sect === state().sect && slot === drop.slot` 查找）
  - `grantGear(id) -> 'owned' | 'duplicate' | 'unknown'`（已拥有时折算 `Math.round(price * 0.3)` 银两）

**设计说明（解决 spec §5.3 的内部矛盾）：** 掉落表在内容期编写，那时不知道玩家会入哪个门派。因此门派款掉落**按槽位声明**、运行时解析为本门对应件，既保证"掉落为主"，又不会给玩家别派的无用件。

- [ ] **Step 1: 写失败的测试**

`tests/jianghu-verify.mjs` 追加：

- `finishDuel` 胜利时，`drops` 中 `chance: 1` 的 `general` 条目必然入库
- `{kind:'sect', slot:'weapon', chance:1}` 在少林弟子身上解析为少林兵器，在唐门弟子身上解析为唐门兵器
- `chance: 0` 的条目必然不掉
- 重复掉落 → `owned` 不新增条目，`taels` 增加 `Math.round(price * 0.3)`，且 `log` 有记录
- 事件 `outcome.gain.gear` → 该件入库；重复时同样折算
- `applyOutcome` 与 `finishDuel` 之后 `taels >= 0`、无 NaN

`tests/test_jianghu.py` 追加掉落引用闭合断言：

```python
def test_gear_drop_references_resolve(report):
    assert report["contentProblems"] == [], report["contentProblems"]
```

（由 harness 校验：每个 `drops` 条目的 `gear` id 存在于 `GEAR`、`slot` ∈ 四槽、`chance` ∈ (0,1]；每个 `outcome.gain.gear` 的 id 存在。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/jianghu-verify.mjs` 与 `python -m pytest tests/test_jianghu.py -q -k drop`
Expected: 前者 FAIL（无 `grantGear`）；后者 FAIL（`contentProblems` 报未实现的掉落声明未被校验，或 `coverage` 缺掉落统计）。

- [ ] **Step 3: 在 `wuxia-content.js` 配好掉落与事件奖励**

给 6 个敌人各配 1–2 条 `general` 掉落（品阶随敌人强度上移），并给其中 2–3 个强敌各配一条 `sect` 掉落。给至少 2 个事件的 `outcome.gain` 加 `gear` 字段。

- [ ] **Step 4: 在 `jianghu.js` 实现 `resolveDrop` 与 `grantGear`，并接入两处**

`finishDuel` 胜利分支在既有奖励之后逐条掷 `Math.random() < chance`，命中则 `grantGear(resolveDrop(drop))`。`applyOutcome` 在 `gain.gear` 存在时调用 `grantGear`。两者都要把结果写进 `log`。

- [ ] **Step 5: 在 `tests/jianghu-harness.mjs` 加掉落引用闭合校验与覆盖统计**

- [ ] **Step 6: 跑测试确认通过**

Run: `node tests/jianghu-verify.mjs` 与 `python -m pytest tests/test_jianghu.py -q`
Expected: 两者 PASS。

- [ ] **Step 7: 提交**

```bash
git add 淘金矿工小屋/wuxia-content.js 淘金矿工小屋/jianghu.js tests/jianghu-harness.mjs tests/jianghu-verify.mjs tests/test_jianghu.py
git commit -m "feat: drop gear from duels and hand it out from events"
```

---

### Task 6: 界面三张卡片

**Files:**
- Modify: `淘金矿工小屋/jianghu.js`（新增 `gearHtml`/`bagHtml`/`shopHtml`，接入 `render()`）
- Test: `tests/jianghu-verify.mjs`

**Interfaces:**
- Consumes: Task 2–5 的全部产物
- Produces: `gearHtml()`、`bagHtml()`、`shopHtml()`，三者返回 HTML 字符串；`render()` 的返回顺序为
  `cardHtml() + sectHtml() + actionsHtml() + gearHtml() + bagHtml() + shopHtml() + (duel ? duelHtml() : eventHtml()) + skillsHtml() + logHtml()`

- [ ] **Step 1: 写失败的测试**

在 `tests/jianghu-verify.mjs` 追加：

- 空背包时 `render()` 含「装备」「行囊」「货栈」三个区块
- 四个槽位名都出现；未穿装备的槽位显示占位文案
- 已穿装备时显示装备名与强化等级
- 已拥有装备出现在行囊，且不在货栈（货栈只列未拥有的）
- 别派门派款不出现在货栈；本门门派款在货栈且标价 350
- 银两不足时购入按钮为 `disabled`
- 强化已达上限时按钮为 `disabled`
- 有已穿装备时，卡片上显示的加成合计等于 `gearBonus()` 之和
- 渲染结果不含 `undefined` 与 `NaN`

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/jianghu-verify.mjs`
Expected: FAIL —— 渲染结果不含「货栈」。

- [ ] **Step 3: 在 `jianghu.js` 实现三张卡片并接入 `render()`**

沿用既有 `cardHtml()`/`skillsHtml()` 的 HTML 风格（`class="card"`、`mh-title`、`btn`、`table`）。按钮用 `onclick="Jianghu.buyGear('...')"` 形式，与既有 `Jianghu.learn(...)` 一致。

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/jianghu-verify.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add 淘金矿工小屋/jianghu.js tests/jianghu-verify.mjs
git commit -m "feat: render the equipped set, the bag and the gear shop"
```

---

### Task 7: 把过渡期脚本收进唯一测试入口

**Files:**
- Modify: `tests/test_jianghu.py`
- Test: 自身

**Interfaces:**
- Consumes: `tests/jianghu-verify.mjs`、`tests/jianghu-gaps.mjs`（既有）
- Produces: 一个 pytest 用例，shell 调用上述两脚本并断言退出码为 0

- [ ] **Step 1: 落盘用例**

在 `tests/test_jianghu.py` 追加（沿用该文件既有的 `subprocess` + `ROOT` 用法）：

```python
@pytest.mark.parametrize("suite", ["jianghu-verify.mjs", "jianghu-gaps.mjs"])
def test_node_suite_passes(suite):
    proc = subprocess.run(["node", str(ROOT / "tests" / suite)],
                          capture_output=True, text=True, encoding="utf-8")
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
```

**说明**：这是接线任务，不改产品行为，因此没有真实的红phase——两个脚本此前
已各自通过。验收依据是下面两步：新参数化用例出现、且与既有断言一同全绿。

- [ ] **Step 2: 跑测试确认用例出现并通过**

Run: `python -m pytest tests/test_jianghu.py -q -k node_suite`
Expected: PASS，且收集到 **2** 个参数化用例

- [ ] **Step 3: 跑全套确认无回归**

Run: `python -m pytest tests/test_jianghu.py -q`
Expected: PASS —— 既有 13 项 + Task 1/5 的新增项 + 本任务 2 项

- [ ] **Step 4: 提交**

```bash
git add tests/test_jianghu.py
git commit -m "test: run the node gear suites from the single pytest entry point"
```

---

## 自查记录

**spec 覆盖**：§3.1 槽位 → Task 2/3；§3.2 装备条目 → Task 1；§3.3 状态 → Task 2；§4.1 品阶定价 → Task 1；§4.2 强化 → Task 4；§4.3 套装 → Task 3；§4.4 通用款定位 → Task 1（通用款 12 件覆盖四槽三档）；§4.5 叠加顺序 → Task 3；§4.6 数值纪律 → Task 3；§5.1/5.2/5.3 获取 → Task 5；§5.4 内容量 → Task 1；§6.1 动作 → Task 4；§6.2 界面 → Task 6；§7.1 ensureFields → Task 2；§7.2 sanitize → Task 2；§9 测试策略 → Task 1/5/7。

**相对 spec 的修正**：§5.1 的掉落形态由 `{gear, chance}` 改为 `{kind, gear|slot, chance}`，§5.3 相应改为"门派款按槽位声明、运行时解析本门"。理由见 Task 5 的设计说明。spec 已同步回改。

**类型一致性**：`gearItem`/`mainStat`/`gearBonus`/`setBonus`/`upgradeCost`/`gearTierCap`/`resolveDrop`/`grantGear` 的签名在 Task 2–5 的 Interfaces 中定义一次、后续任务只引用不重定义。
