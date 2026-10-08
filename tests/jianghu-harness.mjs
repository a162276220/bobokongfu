/* 江湖引擎的无头试跑：把 wuxia-content.js 与 jianghu.js 装进一个 vm 沙箱，
   用最小宿主 API（getState/saveState/showToast/todayStr）冒充工作台，然后
   穷举每一条奇遇分支与每一场切磋，报告任何越界、卡死或取不到的数据。
   运行： node tests/jianghu-harness.mjs
   输出： {engineProblems, contentProblems, coverage, engineChecks}
   断言在 tests/test_jianghu.py 里，这里只负责跑与记。 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', '淘金矿工小屋');

const engineProblems = [];
const contentProblems = [];
const coverage = { events: 0, choices: 0, outcomes: 0, duels: 0, rounds: 0, skills: 0 };
const seenOutcomeText = new Set();
const dropStats = { general: 0, sect: 0 };
const sectSlotCover = new Set();
let eventGearGrants = 0;

function bad(list, message) { list.push(message); }

/* ---------- 宿主 ---------- */
let DAY = '2026-09-30';
let state;
function blankState() {
  return {
    pets: [],
    jianghu: {
      sect: null, exp: 0, hours: 0, hoursTotal: 0, taels: 0,
      stats: { neili: 5, gengu: 5, shenfa: 5, wuxing: 5 },
      skills: {}, log: [], recent: [], pending: null, duel: null,
      today: { date: DAY, adventures: 0 }, wins: 0, losses: 0,
    },
  };
}
const toasts = [];

const ctx = vm.createContext({});
ctx.window = ctx;                       // 模块拿到 window === 全局，裸调用才找得到宿主函数
ctx.getState = () => state;
ctx.saveState = () => { state = JSON.parse(JSON.stringify(state)); };  // 走一遍序列化，存档格式必须可持久化
ctx.showToast = (message, kind) => toasts.push([kind || 'info', String(message)]);
ctx.todayStr = () => DAY;
ctx.navTo = () => {};
ctx.currentPage = 'jianghu';
// 可控随机：驱动脚本按需要塞入下一批取值，队列空了走确定性 LCG。
let randQueue = [];
let seed = 20260930;
vm.runInContext(`Math.random = function () { return __nextRandom(); };`, ctx);
ctx.__nextRandom = () => (randQueue.length
  ? randQueue.shift()
  : (seed = (seed * 1103515245 + 12345) % 0x7fffffff) / 0x7fffffff);

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(APP, file), 'utf8'), ctx, { filename: file });
}
load('wuxia-content.js');
load('jianghu.js');

const W = ctx.WUXIA;
const J = ctx.Jianghu;
const j = () => state.jianghu;

/* ---------- 数据自检 ---------- */
const STAT_KEYS = Object.keys(W.STATS);
const SKILL_BY_ID = new Map(W.SKILLS.map(s => [s.id, s]));
const FOE_BY_ID = new Map(W.FOES.map(f => [f.id, f]));
const SECT_BY_ID = new Map(W.SECTS.map(s => [s.id, s]));
const GEAR_BY_ID = new Map((W.GEAR || []).map(g => [g.id, g]));

W.REALMS.forEach((r, i) => {
  if (!r.id || !r.name || !r.aura) bad(contentProblems, `realm ${i} 缺字段`);
  if (i === 0 ? r.need !== 0 : r.need <= W.REALMS[i - 1].need) {
    bad(contentProblems, `realm ${r.id} 的 need 没有递增：${r.need}`);
  }
});
if (W.REALMS[0].need !== 0) bad(contentProblems, '第一个境界必须从 0 修为开始');

function bonusCheck(where, bonus) {
  Object.keys(bonus).forEach(k => {
    if (!STAT_KEYS.includes(k)) bad(contentProblems, `${where} 加了不存在的属性 ${k}`);
    if (!(bonus[k] > 0)) bad(contentProblems, `${where} 的 ${k} 加成不是正数`);
  });
}

W.SECTS.forEach(s => {
  bonusCheck(`门派 ${s.id}`, s.bonus);
  if (!SKILL_BY_ID.has(s.start)) bad(contentProblems, `门派 ${s.id} 的入门功夫 ${s.start} 不存在`);
  else if (SKILL_BY_ID.get(s.start).sect !== s.id) {
    bad(contentProblems, `门派 ${s.id} 入门功夫 ${s.start} 不属于它`);
  }
  Object.keys(s.weight || {}).forEach(tag => {
    if (!W.EVENTS.some(e => e.tags.includes(tag))) {
      bad(contentProblems, `门派 ${s.id} 偏好的标签 ${tag} 没有事件带`);
    }
  });
});

W.SKILLS.forEach(s => {
  if (!['internal', 'strike', 'movement'].includes(s.kind)) {
    bad(contentProblems, `武学 ${s.id} 的 kind=${s.kind}`);
  }
  if (s.sect && !SECT_BY_ID.has(s.sect)) bad(contentProblems, `武学 ${s.id} 的门派 ${s.sect} 不存在`);
  if (!(s.need >= 0 && s.need < W.REALMS.length)) {
    bad(contentProblems, `武学 ${s.id} 的境界门槛 need=${s.need} 越界`);
  }
  if (!(s.cost.hours > 0)) bad(contentProblems, `武学 ${s.id} 的时辰花费必须为正`);
  if (!(s.cost.taels >= 0)) bad(contentProblems, `武学 ${s.id} 的银两花费不能为负`);
  if (!(s.max >= 1)) bad(contentProblems, `武学 ${s.id} 的层数上限必须 >= 1`);
  if (!(s.power > 0)) bad(contentProblems, `武学 ${s.id} 缺威力`);
});

W.FOES.forEach(f => {
  if (!(f.minRealm >= 0 && f.minRealm < W.REALMS.length)) {
    bad(contentProblems, `对手 ${f.id} 的 minRealm=${f.minRealm} 越界`);
  }
  ['hp', 'atk', 'def', 'taels', 'exp'].forEach(k => {
    if (!(f[k] > 0)) bad(contentProblems, `对手 ${f.id} 的 ${k} 必须为正`);
  });
});

const GAIN_KEYS = ['exp', 'taels', 'hours', 'stat'];
const usedFoes = new Set();
const allTags = new Set();

W.EVENTS.forEach(e => {
  coverage.events += 1;
  if (!(e.minRealm >= 0 && e.minRealm < W.REALMS.length)) {
    bad(contentProblems, `事件 ${e.id} 的 minRealm=${e.minRealm} 越界`);
  }
  if (!e.tags.length) bad(contentProblems, `事件 ${e.id} 没有标签，门派偏好永远用不上`);
  e.tags.forEach(t => allTags.add(t));
  if (e.weight <= 0) bad(contentProblems, `事件 ${e.id} 的 weight 必须为正`);
  if (!e.text) bad(contentProblems, `事件 ${e.id} 没有正文`);
  if (e.choices.length < 2) bad(contentProblems, `事件 ${e.id} 至少要有两个选择`);
  e.choices.forEach((c, ci) => {
    coverage.choices += 1;
    const where = `事件 ${e.id} 第 ${ci + 1} 个选择`;
    if (!c.label) bad(contentProblems, `${where} 没有文案`);
    if (!c.outcomes || !c.outcomes.length) bad(contentProblems, `${where} 没有结算分支`);
    if (c.cost && c.cost.hours < 0) bad(contentProblems, `${where} 的时辰花费为负`);
    if (c.requires) {
      const keys = Object.keys(c.requires);
      if (!keys.length || !keys.some(k => ['stat', 'skill'].includes(k))) {
        bad(contentProblems, `${where} 的 requires 是空的，界面会永远放行`);
      }
      keys.forEach(k => {
        if (!['stat', 'skill'].includes(k)) bad(contentProblems, `${where} 的 requires.${k} 引擎不判`);
      });
      if (c.requires.stat) {
        Object.keys(c.requires.stat).forEach(k => {
          if (!STAT_KEYS.includes(k)) bad(contentProblems, `${where} 要求了不存在的属性 ${k}`);
          if (!(c.requires.stat[k] > 0)) bad(contentProblems, `${where} 的属性门槛必须为正`);
        });
      }
      if (c.requires.skill && !SKILL_BY_ID.has(c.requires.skill)) {
        bad(contentProblems, `${where} 要求的武学 ${c.requires.skill} 不存在`);
      }
    }
    c.outcomes.forEach((o, oi) => {
      const tail = `${where} 的第 ${oi + 1} 个分支`;
      if (!o.text) bad(contentProblems, `${tail} 没有文案`);
      Object.keys(o).forEach(k => {
        if (!GAIN_KEYS.includes(k) && !['at', 'text', 'foe', 'lose', 'gain'].includes(k)) {
          bad(contentProblems, `${tail} 有引擎不会结算的字段 ${k}`);
        }
      });
      if (o.gain) Object.keys(o.gain).forEach(k => {
        if (k === 'gear') {
          if (typeof o.gain.gear !== 'string' || !GEAR_BY_ID.has(o.gain.gear)) {
            bad(contentProblems, `${tail} 的 gain.gear=${o.gain.gear} 不存在`);
          } else eventGearGrants += 1;
          return;
        }
        if (!GAIN_KEYS.includes(k)) bad(contentProblems, `${tail} 的 gain.${k} 引擎不认识`);
        if (k === 'stat') {
          Object.keys(o.gain.stat).forEach(s => {
            if (!STAT_KEYS.includes(s)) bad(contentProblems, `${tail} 加了不存在的属性 ${s}`);
            if (!(o.gain.stat[s] > 0)) bad(contentProblems, `${tail} 的属性加成必须为正`);
          });
        } else if (!(o.gain[k] > 0)) bad(contentProblems, `${tail} 的 gain.${k} 必须为正`);
      });
      if (o.lose) Object.keys(o.lose).forEach(k => {
        if (k !== 'taels') bad(contentProblems, `${tail} 的 lose.${k} 引擎不会扣`);
        if (!(o.lose[k] > 0)) bad(contentProblems, `${tail} 的 lose.${k} 应写成正数`);
      });
      if (o.foe) {
        usedFoes.add(o.foe);
        if (!FOE_BY_ID.has(o.foe)) bad(contentProblems, `${tail} 打起了不存在的对手 ${o.foe}`);
        else if (FOE_BY_ID.get(o.foe).minRealm > e.minRealm) {
          bad(contentProblems, `${tail} 的对手 ${o.foe} 境界门槛高于事件本身`);
        }
      }
      if (o.at !== undefined && oi === c.outcomes.length - 1) {
        bad(contentProblems, `${tail} 是兜底分支却写了 at`);
      }
      if (o.at !== undefined && (o.at <= 0 || o.at >= 1)) {
        bad(contentProblems, `${tail} 的 at=${o.at} 不在 (0,1)`);
      }
    });
  });
});

W.FOES.forEach(f => {
  if (!usedFoes.has(f.id)) bad(contentProblems, `对手 ${f.id} 没有任何事件会碰上，是死数据`);
});
Object.keys(W.PET_BONUSES.byId).forEach(id => {
  bonusCheck(`伙伴 ${id}`, W.PET_BONUSES.byId[id].bonus);
});
bonusCheck('默认伙伴', W.PET_BONUSES.default.bonus);
Object.keys(W.TASK_HOURS).forEach(k => {
  if (!(W.TASK_HOURS[k] > 0)) bad(contentProblems, `任务 ${k} 给的时辰必须为正`);
});

/* ---------- 装备表自检 ---------- */
const GEAR_SLOTS = ['weapon', 'armor', 'boots', 'charm'];
const GEAR_TIER_SUM = { 0: 2, 1: 4, 2: 6 };
if (!Array.isArray(W.GEAR) || !W.GEAR.length) {
  bad(contentProblems, 'GEAR 表缺失');
} else {
  const gearIds = new Set();
  const gearSlots = new Set();
  let general = 0, sect = 0;
  W.GEAR.forEach((g, i) => {
    const where = `装备 ${g && g.id ? g.id : `#${i + 1}`}`;
    if (!g.id) bad(contentProblems, `${where} 没有 id`);
    else if (gearIds.has(g.id) || SKILL_BY_ID.has(g.id) || FOE_BY_ID.has(g.id) || SECT_BY_ID.has(g.id)) {
      bad(contentProblems, `${where} 的 id 与别处重名`);
    }
    gearIds.add(g.id);
    if (!g.name) bad(contentProblems, `${where} 没有名字`);
    if (!GEAR_SLOTS.includes(g.slot)) bad(contentProblems, `${where} 的槽位 ${g.slot} 不存在`);
    else gearSlots.add(g.slot);
    if (![0, 1, 2].includes(g.tier)) bad(contentProblems, `${where} 的品阶 ${g.tier} 越界`);
    if (!Number.isInteger(g.price) || g.price <= 0) bad(contentProblems, `${where} 的售价必须为正整数`);
    if (g.sect !== null && !SECT_BY_ID.has(g.sect)) bad(contentProblems, `${where} 的门派 ${g.sect} 不存在`);
    if (!g.bonus || typeof g.bonus !== 'object' || Array.isArray(g.bonus) || !Object.keys(g.bonus).length) {
      bad(contentProblems, `${where} 没有任何加成`);
    } else {
      let sum = 0;
      Object.keys(g.bonus).forEach(k => {
        if (!STAT_KEYS.includes(k)) bad(contentProblems, `${where} 加了不存在的属性 ${k}`);
        if (!Number.isInteger(g.bonus[k]) || g.bonus[k] <= 0) {
          bad(contentProblems, `${where} 的 ${k} 加成必须是正整数（0 和负数都不算）`);
        }
        sum += g.bonus[k];
      });
      if (sum !== GEAR_TIER_SUM[g.tier]) {
        bad(contentProblems, `${where} 的加成合计 ${sum}，${g.tier} 品应当是 ${GEAR_TIER_SUM[g.tier]}`);
      }
    }
    if (g.sect === null) general += 1;
    else {
      sect += 1;
      if (g.tier !== 1 || g.price !== 350) {
        bad(contentProblems, `${where} 是门派款，必须 tier=1、价 350，实际 tier=${g.tier}、价=${g.price}`);
      }
    }
  });
  coverage.gear = { total: W.GEAR.length, general, sect, slots: [...gearSlots].sort() };
}

/* ---------- 掉落与事件奖励自检（Task 5） ---------- */
// 掉落声明：general 的 gear 必须存在；sect 的 slot 必须在四槽内；chance 必须落在 (0,1]。
// 另要求每个敌人至少有一条掉落，门派掉落槽位要覆盖全部四槽（整套装对任何门派都可达）。
W.FOES.forEach(f => {
  if (!Array.isArray(f.drops) || !f.drops.length) {
    bad(contentProblems, `对手 ${f.id} 没有掉落表，打赢它永远不掉装备`);
    return;
  }
  f.drops.forEach((d, i) => {
    const where = `对手 ${f.id} 的掉落[${i}]`;
    if (d.kind === 'general') {
      if (!GEAR_BY_ID.has(d.gear)) bad(contentProblems, `${where} 的通用装备 ${d.gear} 不存在`);
      dropStats.general += 1;
    } else if (d.kind === 'sect') {
      if (!GEAR_SLOTS.includes(d.slot)) bad(contentProblems, `${where} 的门派槽位 ${d.slot} 不存在`);
      sectSlotCover.add(d.slot);
      dropStats.sect += 1;
    } else {
      bad(contentProblems, `${where} 的掉落类型 ${d.kind} 引擎不认识`);
    }
    if (!(d.chance > 0) || !(d.chance <= 1)) {
      bad(contentProblems, `${where} 的 chance=${d.chance} 不在 (0,1]`);
    }
  });
});
GEAR_SLOTS.forEach(s => {
  if (!sectSlotCover.has(s)) {
    bad(contentProblems, `门派掉落没有覆盖槽位 ${s}，没办法攒齐一套`);
  }
});

/* ---------- 引擎：不变量 ---------- */
function invariant(what) {
  const s = j();
  const numbers = [s.exp, s.hours, s.hoursTotal, s.taels, s.wins, s.losses];
  Object.values(s.stats).forEach(v => numbers.push(v));
  Object.values(s.skills).forEach(v => numbers.push(v));
  numbers.forEach(v => {
    if (!Number.isFinite(v)) bad(engineProblems, `${what} 产生了非数字：${v}`);
  });
  if (s.hours < 0) bad(engineProblems, `${what} 之后时辰变成负数 ${s.hours}`);
  if (s.taels < 0) bad(engineProblems, `${what} 之后银两变成负数 ${s.taels}`);
  if (s.exp < 0) bad(engineProblems, `${what} 之后修为变成负数 ${s.exp}`);
  if (s.log.length > 12) bad(engineProblems, `${what} 之后日志没有截断`);
  Object.keys(s.skills).forEach(id => {
    const max = SKILL_BY_ID.get(id).max;
    if (s.skills[id] > max) bad(engineProblems, `${what} 让 ${id} 超过上限 ${max}`);
    if (s.skills[id] < 0) bad(engineProblems, `${what} 让 ${id} 层数为负`);
  });
  if (s.duel) {
    if (!FOE_BY_ID.has(s.duel.foe)) bad(engineProblems, `${what} 的对局对手 ${s.duel.foe} 不存在`);
    if (!Number.isFinite(s.duel.hp) || !Number.isFinite(s.duel.foeHp)) {
      bad(engineProblems, `${what} 的对局血量不是数字`);
    }
    if (s.duel.round < 1) bad(engineProblems, `${what} 的对局回合数退化了`);
    if (s.duel.lines.length > 8) bad(engineProblems, `${what} 的对局记录没有截断`);
  }
}

function grant(everything) {
  const s = j();
  s.hours = everything ? 100000 : 0;
  s.taels = everything ? 100000 : 0;
  s.exp = everything ? 5000 : 0;
}
function masterAll() {
  const s = j();
  STAT_KEYS.forEach(k => { s.stats[k] = 60; });
  W.SKILLS.forEach(sk => { s.skills[sk.id] = sk.max; });
}

// 1) 打卡给时辰
Object.keys(W.TASK_HOURS).forEach(key => {
  state = blankState();
  const got = J.earnHours(key, '测试');
  if (got !== W.TASK_HOURS[key]) {
    bad(engineProblems, `打卡 ${key} 应给 ${W.TASK_HOURS[key]} 时辰，实际 ${got}`);
  }
  if (j().hours !== got || j().hoursTotal !== got) {
    bad(engineProblems, `打卡 ${key} 没有把时辰记进存档`);
  }
  state = blankState();
  if (J.earnHours('不存在的矿道', '测试') !== 1) {
    bad(engineProblems, '陌生矿道应当保底给 1 个时辰');
  }
});

// 2) 没有时辰时任何动作都不许推进
state = blankState();
grant(false);
const guardBefore = JSON.stringify(j());
J.cultivate();
J.adventure();
if (JSON.stringify(j()) !== guardBefore) {
  bad(engineProblems, '时辰为 0 时，闭关/闯荡动了存档');
}
invariant('零时辰守卫');

// 3) 闭关：修为单调，时辰单调减少，境界只升不降
state = blankState();
grant(true);
let lastExp = j().exp, lastRealm = 0;
for (let i = 0; i < 400; i++) {
  const before = j().hours;
  J.cultivate();
  if (j().exp < lastExp) bad(engineProblems, `第 ${i} 次闭关修为退步了`);
  if (W.REALMS.indexOf(J.realm()) < lastRealm) {
    bad(engineProblems, `第 ${i} 次闭关境界跌了`);
  }
  lastExp = j().exp;
  lastRealm = W.REALMS.indexOf(J.realm());
  if (j().hours !== before - 1) bad(engineProblems, `第 ${i} 次闭关没有正好扣掉一个时辰`);
  invariant(`闭关 ${i}`);
}
if (lastRealm !== W.REALMS.length - 1) {
  bad(engineProblems, `闭关 400 次还没到最高境界（停在 ${W.REALMS[lastRealm].name}），成长曲线太硬`);
}

// 4) 学武：门派出身、境界门槛、穷、封顶各判一次
state = blankState();
grant(true);
W.SKILLS.forEach(sk => {
  if (sk.sect && j().sect !== sk.sect) {
    const before = JSON.stringify(j());
    J.learn(sk.id);
    if (JSON.stringify(j()) !== before) bad(engineProblems, `${sk.id} 未入门派却学会了`);
  }
});
state = blankState();
j().sect = 'shaolin';
grant(true);
const gateSkill = W.SKILLS.find(s => s.need > 0);
if (gateSkill) {
  j().exp = 0;
  const before = JSON.stringify(j());
  J.learn(gateSkill.id);
  if (JSON.stringify(j()) !== before) bad(engineProblems, `${gateSkill.id} 境界不够却学会了`);
}
state = blankState();
j().sect = 'shaolin';
grant(true);
W.SKILLS.forEach(sk => {
  if (sk.sect && sk.sect !== 'shaolin') return;
  coverage.skills += 1;
  J.learn(sk.id);
  if (j().skills[sk.id] !== 1) bad(engineProblems, `${sk.id} 第一次没学会`);
  // 逐层加价，扣的必须正好是报价
  const cost = { hours: sk.cost.hours * 2, taels: sk.cost.taels * 2 };
  const h = j().hours, t = j().taels;
  J.learn(sk.id);
  if (j().skills[sk.id] !== 2) bad(engineProblems, `${sk.id} 精进失败`);
  if (j().hours !== h - cost.hours || j().taels !== t - cost.taels) {
    bad(engineProblems, `${sk.id} 第二层的扣费与报价不符`);
  }
  for (let i = 0; i < sk.max + 3; i++) J.learn(sk.id);
  if (j().skills[sk.id] !== sk.max) bad(engineProblems, `${sk.id} 没有停在 ${sk.max} 层`);
  invariant(`学武 ${sk.id}`);
});
state = blankState();
j().sect = 'shaolin';
grant(false);
const freeSkill = W.SKILLS.find(s => !s.sect);
const brokeBefore = JSON.stringify(j());
J.learn(freeSkill.id);
if (JSON.stringify(j()) !== brokeBefore) bad(engineProblems, '银两/时辰不足却学会了功夫');

// 5) 门派：入门给起手功夫，且不许改换
W.SECTS.forEach(sc => {
  state = blankState();
  grant(true);
  J.joinSect(sc.id);
  if (j().sect !== sc.id) bad(engineProblems, `拜入 ${sc.id} 失败`);
  if (j().skills[sc.start] !== 1) bad(engineProblems, `拜入 ${sc.id} 没发起门功夫 ${sc.start}`);
  const other = W.SECTS.find(x => x.id !== sc.id);
  J.joinSect(other.id);
  if (j().sect !== sc.id) bad(engineProblems, `${sc.id} 弟子改投了 ${other.id}`);
  if (j().skills[other.start]) bad(engineProblems, `改门时白得了 ${other.start}`);
  invariant(`门派 ${sc.id}`);
});

// 6) 闯荡有日上限，跨日重置
state = blankState();
grant(true);
masterAll();
let opened = 0;
for (let i = 0; i < 12; i++) {
  J.adventure();
  if (j().pending) opened += 1;
}
if (opened < 1) bad(engineProblems, '一次闯荡都没开出来');
if (j().today.adventures > 6) bad(engineProblems, `日上限被突破：${j().today.adventures}`);
DAY = '2026-10-01';
J.adventure();
if (!j().pending) bad(engineProblems, '跨日没有重置闯荡次数');
if (j().today.date !== DAY) bad(engineProblems, '跨日没有更新日期');
DAY = '2026-09-30';

// 7) 穷举每一条奇遇分支：强制命中每个 outcome，跑通结算与切磋
function forceOutcome(atValues, target) {
  // 命中第 target 个分支：比它靠前的都要落空，它自己要命中
  randQueue = [];
  for (let i = 0; i < target; i++) randQueue.push(0.999999);
  if (target < atValues.length) randQueue.push(atValues[target] * 0.5);
}
W.EVENTS.forEach(e => {
  e.choices.forEach((c, ci) => {
    const atValues = c.outcomes.slice(0, -1).map(o => (o.at == null ? 0.5 : o.at));
    c.outcomes.forEach((o, oi) => {
      coverage.outcomes += 1;
      state = blankState();
      grant(true);
      masterAll();
      j().pending = { id: e.id };
      forceOutcome(atValues, oi);
      try { J.choose(ci); } catch (err) { bad(engineProblems, `${e.id}#${ci + 1} 结算抛错 ${err.message}`); }
      const line = j().log[0] ? j().log[0].t : '';
      if (!line.includes(o.text)) {
        bad(engineProblems, `${e.id} 第 ${ci + 1} 选择的第 ${oi + 1} 分支走不到（日志是「${line.slice(0, 28)}」）`);
      }
      seenOutcomeText.add(o.text);
      invariant(`事件 ${e.id}#${ci + 1}#${oi + 1}`);
      if (j().duel) {
        coverage.duels += 1;
        let rounds = 0;
        const moves = ['strike', 'guard', 'breath', 'slip'];
        while (j().duel && rounds < 200) {
          J.spar(moves[rounds % moves.length]);
          rounds += 1;
          invariant(`切磋 ${e.id} 第 ${rounds} 回合`);
        }
        coverage.rounds += rounds;
        if (j().duel) bad(engineProblems, `${e.id} 的切磋 200 回合还没打完`);
        if (j().pending) bad(engineProblems, `${e.id} 的切磋结束后事件没有收口`);
      }
      // 拒绝条件：属性/武学不满足时，引擎必须拦住而不是照结算
      if (c.requires && c.outcomes.length) {
        const hasStatGate = c.requires.stat && Object.keys(c.requires.stat).length;
        const hasSkillGate = !!c.requires.skill;
        if (hasStatGate || hasSkillGate) {
          state = blankState();
          grant(true);
          j().pending = { id: e.id };
          if (hasStatGate) STAT_KEYS.forEach(k => { j().stats[k] = 0; });
          if (hasSkillGate) j().skills = {};
          const quiet = JSON.stringify(j());
          J.choose(ci);
          if (JSON.stringify(j()) !== quiet) {
            bad(engineProblems, `${e.id}#${ci + 1} 无视了 requires，条件不满足也能点`);
          }
        }
      }
      randQueue = [];
    });
  });
});

// 8) 收手回屋
state = blankState();
grant(true);
j().pending = { id: W.EVENTS[0].id };
J.decline();
if (j().pending) bad(engineProblems, '收手回屋没有关掉事件');

// 9) 界面渲染：每个阶段都能拼出 HTML，且不带 undefined
state = blankState();
const renders = [];
renders.push(['白手起家', J.render()]);
j().sect = 'wudang';
renders.push(['入门后', J.render()]);
state = blankState();
grant(true);
masterAll();
j().duel = { foe: W.FOES[0].id, foeHp: W.FOES[0].hp, hp: 100, round: 3, guard: false, lines: ['测试'] };
renders.push(['切磋中', J.render()]);
state = blankState();
j().pending = { id: W.EVENTS[0].id };
renders.push(['奇遇中', J.render()]);
state = blankState();
j().pending = { id: W.EVENTS.find(e => e.choices.some(c => c.requires))?.id || W.EVENTS[0].id };
renders.push(['条件不足', J.render()]);
renders.forEach(([name, html]) => {
  if (!html || html.length < 50) bad(engineProblems, `${name} 的渲染结果是空的`);
  if (/undefined|NaN|\[object Object\]/.test(html)) {
    bad(engineProblems, `${name} 的界面里漏出了 ${html.match(/undefined|NaN|\[object Object\]/)[0]}`);
  }
  if (/<script|onerror=/.test(html)) bad(engineProblems, `${name} 的界面带了可执行片段`);
});

// 10) 宠物伙伴：同一被动只算一次，不同被动要累加，陌生宠物走 default
function total(stats) { return STAT_KEYS.reduce((sum, k) => sum + stats[k], 0); }
const START_TOTAL = total(blankState().jianghu.stats);
state = blankState();
state.pets = [
  { name: '甲', petId: 'huhu-carrot-3leaf' },
  { name: '乙', petId: 'huhu-carrot-3leaf' },   // 同一只被动，不该叠加
  { name: '丙', petId: 'dundun-office' },
  { name: '丁', petId: null },                  // 没挂图集的不算伙伴
];
const leaf = W.PET_BONUSES.byId['huhu-carrot-3leaf'].bonus;
const dun = W.PET_BONUSES.byId['dundun-office'].bonus;
const wantSum = Object.values(leaf).reduce((a, b) => a + b, 0)
  + Object.values(dun).reduce((a, b) => a + b, 0);
const gotSum = total(J.stats()) - START_TOTAL;
if (gotSum !== wantSum) {
  bad(engineProblems, `伙伴加成应为 ${wantSum}，实际 ${gotSum}（重复标签没去掉？）`);
}
state = blankState();
state.pets = [{ name: '甲', petId: '图鉴里没这只' }];
const fallbackSum = Object.values(W.PET_BONUSES.default.bonus).reduce((a, b) => a + b, 0);
if (total(J.stats()) - START_TOTAL !== fallbackSum) {
  bad(engineProblems, '陌生宠物没有按 default 给伙伴加成');
}
// 11) 切磋要有来有回：宗师该稳赢，新手该输，四个动作都真的做事
const duelRuns = { master: 0, masterWins: 0, beginner: 0, beginnerLosses: 0, maxRounds: 0 };
function reachDuel(e, ci, oi, asMaster) {
  state = blankState();
  j().hours = 100000;
  if (asMaster) { j().exp = 5000; masterAll(); }
  j().pending = { id: e.id };
  const atValues = e.choices[ci].outcomes.slice(0, -1).map(o => (o.at == null ? 0.5 : o.at));
  forceOutcome(atValues, oi);
  J.choose(ci);
  randQueue = [];
  return !!j().duel;
}
W.EVENTS.forEach(e => {
  e.choices.forEach((c, ci) => {
    c.outcomes.forEach((o, oi) => {
      if (!o.foe) return;
      for (const mode of [true, false]) {
        if (!reachDuel(e, ci, oi, mode)) continue;   // 被 requires 拦住就算不了
        let r = 0;
        const w0 = j().wins, l0 = j().losses;
        while (j().duel && r < 200) { J.spar('strike'); r += 1; }
        if (j().duel) bad(engineProblems, `${e.id} 的切磋在纯进招下 200 回合打不完`);
        duelRuns.maxRounds = Math.max(duelRuns.maxRounds, r);
        const won = j().wins > w0, lost = j().losses > l0;
        if (!won && !lost) bad(engineProblems, `${e.id} 的切磋既没赢也没输（脱身不该是默认结果）`);
        if (mode) { duelRuns.master += 1; if (won) duelRuns.masterWins += 1; }
        else { duelRuns.beginner += 1; if (lost) duelRuns.beginnerLosses += 1; }
      }
    });
  });
});
if (duelRuns.master && duelRuns.masterWins !== duelRuns.master) {
  bad(engineProblems, `宗师 ${duelRuns.master} 战只赢 ${duelRuns.masterWins} 战，成长没有兑现`);
}
if (duelRuns.beginner && duelRuns.beginnerLosses === 0) {
  bad(engineProblems, '新手全胜：切磋没有风险，境界与武学就不值钱了');
}
if (duelRuns.maxRounds < 3) {
  bad(engineProblems, `最长的一场切磋只有 ${duelRuns.maxRounds} 回合，回合制形同虚设`);
}
// 守势 / 调息 / 脱身：每个动作都要留下它自己的那句记录
let sample = null;
for (const e of W.EVENTS) {
  for (let ci = 0; ci < e.choices.length && !sample; ci += 1) {
    e.choices[ci].outcomes.forEach((o, oi) => {
      if (!sample && o.foe) sample = { e, ci, oi };
    });
  }
  if (sample) break;
}
if (!sample) bad(engineProblems, '整份内容里找不出一场切磋，动作分支无法覆盖');
const moves = { guard: '只守不攻', breath: '运功', slip: '脱身' };
Object.keys(moves).forEach(move => {
  if (!sample) return;
  if (!reachDuel(sample.e, sample.ci, sample.oi, true)) {
    bad(engineProblems, '示范切磋被 requires 拦住了，换个起手事件');
    return;
  }
  // 开局满血时调息会被上限吃掉，先让它带伤才看得出回不回血
  if (move === 'breath') j().duel.hp = 1;
  const hp = j().duel.hp;
  J.spar(move);
  const lines = (j().duel ? j().duel.lines : j().log.map(l => l.t)).join(' ');
  if (!lines.includes(moves[move])) {
    bad(engineProblems, `${move} 没有写出「${moves[move]}」那类记录，实际是：${lines.slice(0, 60)}`);
  }
  if (move === 'breath' && j().duel && j().duel.hp <= hp) {
    bad(engineProblems, '运功调息没有让气血回升');
  }
});

coverage.drops = {
  general: dropStats.general,
  sect: dropStats.sect,
  sectSlots: [...sectSlotCover].sort(),
  eventGear: eventGearGrants,
};

console.log(JSON.stringify({
  engineProblems,
  contentProblems,
  coverage,
  engineChecks: {
    pets: Object.keys(W.PET_BONUSES.byId).length,
    realms: W.REALMS.length,
    toasts: toasts.length,
    outcomeTexts: seenOutcomeText.size,
    duels: duelRuns,
  },
}, null, 2));
