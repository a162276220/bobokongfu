// 江湖游戏验证：把工作台真实主脚本 + wuxia-content.js + jianghu.js 加载进同一个
// vm 上下文（等价于浏览器里三个 <script> 共享全局作用域），然后
//   A. 集成：jianghu.js 能不能访问到主脚本的 getState/saveState/todayStr/showToast/navTo
//   B. 内容：wuxia-content.js 的数据是否满足 jianghu.js 的每一项假设
//   C. 逻辑：完整走一遍 打卡->闭关->拜师->学武->闯荡->切磋，检查不变量
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = 'D:\\桌宠\\淘金矿工小屋\\淘金矿工小屋·自律工作台.html';
const WB = 'D:\\桌宠\\淘金矿工小屋';

let failures = 0;
const lines = [];
function check(name, cond, extra) {
  if (cond) lines.push('PASS ' + name);
  else { failures++; lines.push('FAIL ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
}

/* ---------- 极简 DOM 桩 ---------- */
function makeEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), className: '', id: '', innerHTML: '', textContent: '',
    style: {}, dataset: {}, children: [], value: '', checked: false, disabled: false,
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); },
                 remove(...c) { c.forEach((x) => this._s.delete(x)); },
                 contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    insertAdjacentHTML() {}, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
  };
  return el;
}
const elCache = new Map();
function getEl(id) { if (!elCache.has(id)) elCache.set(id, makeEl()); return elCache.get(id); }

const store = new Map();
const documentStub = {
  readyState: 'loading',
  getElementById: getEl,
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  addEventListener() {}, removeEventListener() {},
  body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
};

const sandbox = {
  console,
  document: documentStub,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
  setTimeout: (fn) => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  alert: () => {}, confirm: () => true, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
  requestAnimationFrame: () => 0,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

/* ---------- 抽取主脚本块 ---------- */
const html = fs.readFileSync(HTML, 'utf8');
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const blocks = [];
let m;
while ((m = scriptRe.exec(html)) !== null) blocks.push(m[1]);
check('HTML 里有内联脚本块', blocks.length >= 1, { count: blocks.length });
const appSrc = blocks[0];

/* ---------- A. 跑主脚本，看全局是否可达 ---------- */
let appErr = null;
try { vm.runInContext(appSrc, sandbox, { filename: 'workbench-app.js' }); }
catch (e) { appErr = e; }
check('主脚本能执行', !appErr, appErr && appErr.message);

const neededGlobals = ['getState', 'saveState', 'todayStr', 'showToast', 'navTo', 'loadState'];
const missing = neededGlobals.filter((n) => typeof sandbox[n] !== 'function');
check('jianghu.js 依赖的主脚本全局都可访问', missing.length === 0, { missing });

/* ---------- 加载游戏两个模块 ---------- */
let wuxiaErr = null, jhErr = null;
try { vm.runInContext(fs.readFileSync(WB + '\\wuxia-content.js', 'utf8'), sandbox, { filename: 'wuxia-content.js' }); }
catch (e) { wuxiaErr = e; }
check('wuxia-content.js 能执行', !wuxiaErr, wuxiaErr && wuxiaErr.message);
check('WUXIA 已挂到全局', !!sandbox.WUXIA);

try { vm.runInContext(fs.readFileSync(WB + '\\jianghu.js', 'utf8'), sandbox, { filename: 'jianghu.js' }); }
catch (e) { jhErr = e; }
check('jianghu.js 能执行', !jhErr, jhErr && jhErr.message);
check('Jianghu 已挂到全局', !!sandbox.Jianghu);

const WUXIA = sandbox.WUXIA, Jianghu = sandbox.Jianghu;
if (!WUXIA || !Jianghu) {
  console.log(lines.join('\n'));
  console.log('VERDICT 无法继续：内容或模块未加载');
  process.exit(1);
}

/* ---------- B. 内容完整性 ---------- */
const STAT_KEYS = ['neili', 'gengu', 'shenfa', 'wuxing'];
const skillIds = new Set(WUXIA.SKILLS.map((s) => s.id));
const sectIds = new Set(WUXIA.SECTS.map((s) => s.id));
const foeIds = new Set(WUXIA.FOES.map((f) => f.id));
const eventIds = new Set();

check('REALMS.need 递增', WUXIA.REALMS.every((r, i) => i === 0 || r.need > WUXIA.REALMS[i - 1].need));
check('SKILLS.id 唯一', skillIds.size === WUXIA.SKILLS.length);
check('FOES.id 唯一', foeIds.size === WUXIA.FOES.length);
check('每个门派 start 武功存在', WUXIA.SECTS.every((s) => skillIds.has(s.start)), WUXIA.SECTS.map((s) => s.start).filter((x) => !skillIds.has(x)));
check('每个门派 bonus 属性合法', WUXIA.SECTS.every((s) => Object.keys(s.bonus).every((k) => STAT_KEYS.includes(k))));
check('每个门派 weight 标签都有事件用到', (() => {
  const used = new Set();
  WUXIA.EVENTS.forEach((e) => (e.tags || []).forEach((t) => used.add(t)));
  const bad = [];
  WUXIA.SECTS.forEach((s) => Object.keys(s.weight || {}).forEach((t) => { if (!used.has(t)) bad.push(s.id + ':' + t); }));
  return bad.length === 0;
})(), (() => { const used = new Set(); WUXIA.EVENTS.forEach((e) => (e.tags || []).forEach((t) => used.add(t)));
  const bad = []; WUXIA.SECTS.forEach((s) => Object.keys(s.weight || {}).forEach((t) => { if (!used.has(t)) bad.push(s.id + ':' + t); })); return bad; })());

const skillsOk = WUXIA.SKILLS.every((s) => s.id && s.name && ['internal', 'strike', 'movement'].includes(s.kind)
  && (s.sect === null || sectIds.has(s.sect)) && Number.isFinite(s.need) && s.need < WUXIA.REALMS.length
  && Number.isFinite(s.cost.hours) && Number.isFinite(s.cost.taels) && Number.isFinite(s.max) && Number.isFinite(s.power));
check('SKILLS 字段齐全且合法', skillsOk, WUXIA.SKILLS.filter((s) => !(s.id && s.name && ['internal', 'strike', 'movement'].includes(s.kind)
  && (s.sect === null || sectIds.has(s.sect)) && Number.isFinite(s.need) && s.need < WUXIA.REALMS.length
  && Number.isFinite(s.cost.hours) && Number.isFinite(s.cost.taels) && Number.isFinite(s.max) && Number.isFinite(s.power))).map((s) => s.id));

const foesOk = WUXIA.FOES.every((f) => f.id && f.name && Number.isFinite(f.minRealm) && f.minRealm < WUXIA.REALMS.length
  && Number.isFinite(f.hp) && Number.isFinite(f.atk) && Number.isFinite(f.def)
  && Number.isFinite(f.taels) && Number.isFinite(f.exp) && f.hp > 0);
check('FOES 字段齐全且合法', foesOk, WUXIA.FOES.filter((f) => !(f.id && f.name && Number.isFinite(f.minRealm) && f.hp > 0)).map((f) => f.id));

// 事件：代码里 e.tags.forEach / e.choices[index].outcomes 都无保护
const evProblems = [];
WUXIA.EVENTS.forEach((e, i) => {
  const tag = e.id || ('#' + i);
  if (!e.id) evProblems.push(tag + ' 缺 id');
  else if (eventIds.has(e.id)) evProblems.push(tag + ' id 重复');
  else eventIds.add(e.id);
  if (!e.title) evProblems.push(tag + ' 缺 title');
  if (!e.text) evProblems.push(tag + ' 缺 text');
  if (!Array.isArray(e.tags)) evProblems.push(tag + ' 缺 tags 数组（pickEvent 会 e.tags.forEach 崩）');
  if (!Number.isFinite(e.minRealm)) evProblems.push(tag + ' 缺 minRealm');
  else if (e.minRealm >= WUXIA.REALMS.length) evProblems.push(tag + ' minRealm 越界');
  if (!Array.isArray(e.choices) || e.choices.length === 0) { evProblems.push(tag + ' 没有 choices'); return; }
  e.choices.forEach((c, ci) => {
    if (!c.label) evProblems.push(tag + ' choices[' + ci + '] 缺 label');
    if (c.requires) {
      if (c.requires.stat) Object.keys(c.requires.stat).forEach((k) => { if (!STAT_KEYS.includes(k)) evProblems.push(tag + ' requires.stat 非法键 ' + k); });
      if (c.requires.skill && !skillIds.has(c.requires.skill)) evProblems.push(tag + ' requires.skill 不存在 ' + c.requires.skill);
    }
    if (c.cost && !Number.isFinite(c.cost.hours)) evProblems.push(tag + ' cost.hours 非数字');
    if (!Array.isArray(c.outcomes) || c.outcomes.length === 0) { evProblems.push(tag + ' choices[' + ci + '] 没有 outcomes'); return; }
    c.outcomes.forEach((o, oi) => {
      const where = tag + ' choices[' + ci + '].outcomes[' + oi + ']';
      if (!o.text) evProblems.push(where + ' 缺 text');
      if (o.gain) {
        if (o.gain.stat) Object.keys(o.gain.stat).forEach((k) => {
          if (!STAT_KEYS.includes(k)) evProblems.push(where + ' gain.stat 非法键 ' + k);
          else if (!Number.isFinite(o.gain.stat[k])) evProblems.push(where + ' gain.stat.' + k + ' 非数字');
        });
        ['exp', 'taels', 'hours'].forEach((k) => { if (o.gain[k] !== undefined && !Number.isFinite(o.gain[k])) evProblems.push(where + ' gain.' + k + ' 非数字'); });
      }
      if (o.lose && o.lose.taels !== undefined && !Number.isFinite(o.lose.taels)) evProblems.push(where + ' lose.taels 非数字');
      if (o.foe && !foeIds.has(o.foe)) evProblems.push(where + ' foe 不存在 ' + o.foe);
      if (o.at !== undefined && !(o.at > 0 && o.at <= 1)) evProblems.push(where + ' at 不在 (0,1]');
    });
  });
});
check('EVENTS 全部字段合法（共 ' + WUXIA.EVENTS.length + ' 条）', evProblems.length === 0, evProblems.slice(0, 12));

check('至少有一条 minRealm=0 的事件（否则新号 pickEvent 崩）',
  WUXIA.EVENTS.some((e) => e.minRealm === 0));

check('每个 minRealm 都有事件覆盖', (() => {
  const bad = [];
  for (let r = 0; r < WUXIA.REALMS.length; r++) {
    if (!WUXIA.EVENTS.some((e) => e.minRealm <= r)) bad.push(r);
  }
  return bad.length === 0;
})(), (() => { const bad = []; for (let r = 0; r < WUXIA.REALMS.length; r++) if (!WUXIA.EVENTS.some((e) => e.minRealm <= r)) bad.push(r); return bad; })());

check('事件里引用的 foe 都存在', (() => {
  const refs = new Set();
  WUXIA.EVENTS.forEach((e) => e.choices.forEach((c) => c.outcomes.forEach((o) => { if (o.foe) refs.add(o.foe); })));
  return [...refs].every((f) => foeIds.has(f));
})());

check('每个 foe 至少被一个事件引用（否则永不出场）', (() => {
  const refs = new Set();
  WUXIA.EVENTS.forEach((e) => e.choices.forEach((c) => c.outcomes.forEach((o) => { if (o.foe) refs.add(o.foe); })));
  return WUXIA.FOES.every((f) => refs.has(f.id));
})(), WUXIA.FOES.filter((f) => { const refs = new Set(); WUXIA.EVENTS.forEach((e) => e.choices.forEach((c) => c.outcomes.forEach((o) => { if (o.foe) refs.add(o.foe); }))); return !refs.has(f.id); }).map((f) => f.id));

check('TASK_HOURS 覆盖工作台全部台账', (() => {
  const need = ['diet', 'exercise', 'accounting', 'vocabulary', 'amazon', 'xiaohongshu'];
  return need.every((k) => Number.isFinite(WUXIA.TASK_HOURS[k]));
})(), WUXIA.TASK_HOURS);

check('PET_BONUSES 有 default 且属性合法', !!WUXIA.PET_BONUSES.default
  && Object.keys(WUXIA.PET_BONUSES.default.bonus).every((k) => STAT_KEYS.includes(k)));
check('PET_BONUSES.byId 属性都合法', Object.values(WUXIA.PET_BONUSES.byId)
  .every((b) => Object.keys(b.bonus).every((k) => STAT_KEYS.includes(k))));

/* ---------- C. 玩法逻辑 ---------- */
function J() { return sandbox.getState().jianghu; }
function resetGame() {
  const s = sandbox.getState();
  s.jianghu = { sect: null, exp: 0, hours: 0, hoursTotal: 0, taels: 0,
    stats: { neili: 5, gengu: 5, shenfa: 5, wuxing: 5 }, skills: {}, log: [], recent: [],
    pending: null, duel: null, today: { date: sandbox.todayStr(), adventures: 0 }, wins: 0, losses: 0 };
  s.pets = [];
}
function sane(label) {
  const j = J();
  const bad = [];
  if (j.hours < 0) bad.push('hours<0');
  if (j.taels < 0) bad.push('taels<0');
  if (!Number.isFinite(j.exp)) bad.push('exp NaN');
  STAT_KEYS.forEach((k) => { if (!Number.isFinite(j.stats[k])) bad.push('stats.' + k + ' NaN'); });
  if (j.duel) { if (!Number.isFinite(j.duel.hp) || !Number.isFinite(j.duel.foeHp)) bad.push('duel hp NaN'); }
  check('不变量[' + label + '] 时辰/银两/修为/属性无负数或 NaN', bad.length === 0, bad);
}

resetGame();
check('初始境界为不入流', Jianghu.realm().name === '不入流', Jianghu.realm().name);
check('初始战力是有限数', Number.isFinite(Jianghu.power()), Jianghu.power());

// 打卡换时辰
const h0 = J().hours;
const got = Jianghu.earnHours('exercise', '运动台账');
check('打卡获得时辰', got === WUXIA.TASK_HOURS.exercise && J().hours === h0 + got, { got, hours: J().hours });
check('未知台账也至少给 1 时辰', Jianghu.earnHours('nonexistent', 'x') === 1);

// 闭关直到突破
let guard = 0;
const realmBefore = Jianghu.realm().name;
while (Jianghu.realm().name === realmBefore && guard++ < 500) {
  J().hours += 5;
  Jianghu.cultivate();
}
check('闭关能推动境界提升', Jianghu.realm().name !== realmBefore, { before: realmBefore, after: Jianghu.realm().name, rounds: guard });
sane('闭关后');

// 时辰为 0 时闭关应被拒绝而不是扣成负数
J().hours = 0;
const expBeforeZero = J().exp;
Jianghu.cultivate();
check('无时辰时闭关不生效', J().hours === 0 && J().exp === expBeforeZero);

// 拜师
Jianghu.joinSect('shaolin');
check('拜师成功', J().sect === 'shaolin', J().sect);
const startSkill = WUXIA.SECTS.find((s) => s.id === 'shaolin').start;
check('拜师即得入门武功', J().skills[startSkill] === 1, J().skills);
Jianghu.joinSect('wudang');
check('已入门后不能改换门派', J().sect === 'shaolin', J().sect);

// 学武：时辰/银两/境界/门派 四道门
J().hours = 0; J().taels = 0;
const beforeLearn = J().skills[startSkill];
Jianghu.learn(startSkill);
check('时辰银两不足时学武不生效', J().skills[startSkill] === beforeLearn);
const other = WUXIA.SKILLS.find((s) => s.sect === 'wudang' && s.need === 0);
J().hours = 999; J().taels = 999;
Jianghu.learn(other.id);
check('不能学别派入门武功', J().skills[other.id] === undefined, { skill: other.id, level: J().skills[other.id] });
J().hours = 999; J().taels = 999;
Jianghu.learn('tuna');
check('能学通用武功', J().skills.tuna === 1, J().skills.tuna);
J().hours = 999; J().taels = 999;
Jianghu.learn('tuna');
check('能精进已学武功', J().skills.tuna === 2, J().skills.tuna);

// 满级封顶
J().skills.tuna = WUXIA.SKILLS.find((s) => s.id === 'tuna').max;
const taelAtMax = J().taels;
Jianghu.learn('tuna');
check('满级后不再消耗银两', J().taels === taelAtMax, { taels: J().taels });
sane('学武后');

// 闯荡 + 每日上限
resetGame();
J().hours = 100;
J().taels = 1000;
J().stats = { neili: 50, gengu: 50, shenfa: 50, wuxing: 50 };
Jianghu.adventure();
check('闯荡消耗一时辰并产生待选项', J().hours === 99 && !!J().pending, { hours: J().hours, pending: J().pending });

// 选一个能过的选项，走完结算
const pend = J().pending;
const ev = WUXIA.EVENTS.find((e) => e.id === pend.id);
check('待选事件能在内容表里找到', !!ev, pend.id);
let chosen = -1;
for (let i = 0; i < ev.choices.length; i++) {
  const c = ev.choices[i];
  const meets = !c.requires && !(c.cost && c.cost.hours);
  if (meets) { chosen = i; break; }
}
if (chosen < 0) chosen = 0;
Jianghu.choose(chosen);
check('选择后 pending 处理完毕或转入切磋', J().pending === null || !!J().duel, { pending: J().pending, duel: !!J().duel });
check('选择后时辰不为负', J().hours >= 0, J().hours);
sane('闯荡后');

// 切磋：显式构造对局，验证 spar/foeTurn/finishDuel 全链路
// （上面 choose 选中的结局未必带 foe，所以不能拿它当切磋用例）
const foe0 = WUXIA.FOES[0];

// 强角色应当打赢并拿到修为与银两
resetGame();
J().hours = 100; J().taels = 0;
J().stats = { neili: 80, gengu: 80, shenfa: 80, wuxing: 80 };
J().duel = { foe: foe0.id, foeHp: foe0.hp, hp: 9999, round: 1, guard: false, lines: [] };
let rounds = 0;
while (J().duel && rounds++ < 500) Jianghu.spar('strike');
check('切磋能正常收尾（' + rounds + ' 回合）', !J().duel, { rounds });
check('胜局计入 wins 且发奖励', J().wins === 1 && J().losses === 0 && J().exp >= foe0.exp && J().taels >= foe0.taels,
  { wins: J().wins, losses: J().losses, exp: J().exp, taels: J().taels });
check('对局结束后 pending 一并清空', J().pending === null, J().pending);
sane('胜局后');

// 弱角色应当打输，赔药钱但银两不为负
resetGame();
J().hours = 100; J().taels = 5;
J().stats = { neili: 1, gengu: 1, shenfa: 1, wuxing: 1 };
J().duel = { foe: foe0.id, foeHp: foe0.hp, hp: 30, round: 1, guard: false, lines: [] };
let rounds2 = 0;
while (J().duel && rounds2++ < 500) Jianghu.spar('strike');
check('败局能正常收尾（' + rounds2 + ' 回合）', !J().duel, { rounds: rounds2 });
check('败局计入 losses 且扣药钱不为负', J().losses === 1 && J().wins === 0 && J().taels >= 0 && J().taels <= 5,
  { wins: J().wins, losses: J().losses, taels: J().taels });
sane('败局后');

// 轻身脱身：身法够高必定脱身，且不算胜负、不给奖励
resetGame();
J().hours = 100; J().taels = 0;
J().stats = { neili: 5, gengu: 5, shenfa: 60, wuxing: 5 };
J().duel = { foe: foe0.id, foeHp: foe0.hp, hp: 100, round: 1, guard: false, lines: [] };
Jianghu.spar('slip');
check('身法足够时能脱身并结束对局', !J().duel, J().duel);
check('脱身不计胜负也不发奖励', J().wins === 0 && J().losses === 0 && J().taels === 0 && J().exp === 0,
  { wins: J().wins, losses: J().losses, taels: J().taels, exp: J().exp });

// 守势应当降低受到的伤害（起始气血取 maxHp，避免被上限截断干扰对照）
function runOneTurn(action) {
  resetGame();
  J().stats = { neili: 5, gengu: 5, shenfa: 0, wuxing: 5 };
  const maxHp = 60 + 5 * 6 + 0 * 30;          // gengu*6 + realmIndex*30
  J().duel = { foe: foe0.id, foeHp: 99999, hp: maxHp, round: 1, guard: false, lines: [] };
  Jianghu.spar(action);
  return maxHp - (J().duel ? J().duel.hp : maxHp);
}
const dmgGuard = runOneTurn('guard');
const dmgOpen = runOneTurn('strike');
check('守势比不守少掉气血（受伤 ' + dmgGuard + ' vs ' + dmgOpen + '）', dmgGuard < dmgOpen, { dmgGuard, dmgOpen });
check('守势受伤约为不守的四成', dmgOpen > 0 && Math.abs(dmgGuard - Math.round(dmgOpen * 0.4)) <= 1, { dmgGuard, dmgOpen });
sane('守势后');

// 每日闯荡上限
resetGame();
J().hours = 100; J().taels = 1000;
let adv = 0;
for (let i = 0; i < 20; i++) {
  const before = J().today.adventures;
  Jianghu.adventure();
  if (J().today.adventures === before) break;
  adv++;
  Jianghu.decline();
}
check('每日闯荡次数有上限（' + adv + ' 次后停止）', adv === 6, { adv });

// 逃出战斗也要能收尾
resetGame();
J().hours = 100; J().taels = 1000; J().stats = { neili: 5, gengu: 5, shenfa: 5, wuxing: 5 };
Jianghu.spar('strike');
check('无对局时 spar 是安全空操作', !J().duel);
sane('空 spar 后');

/* ---------- D. 路由集成：真跑 navTo('jianghu') ---------- */
let routeErr = null, rendered = '';
try {
  sandbox.navTo('jianghu');
  rendered = elCache.get('mainContent') ? String(elCache.get('mainContent').innerHTML) : '';
} catch (e) { routeErr = e; }
check('navTo(\'jianghu\') 不抛异常', !routeErr, routeErr && (routeErr.message + ' @ ' + (routeErr.stack || '').split('\n')[1]));
const pageDiv = (() => { try { return String(sandbox.document.querySelector('.page-content') && sandbox.document.querySelector('.page-content').innerHTML); } catch { return ''; } })();
check('当前页被切到 jianghu', sandbox.currentPage === 'jianghu', sandbox.currentPage);

let renderErr = null, html2 = '';
try { html2 = Jianghu.render(); } catch (e) { renderErr = e; }
check('Jianghu.render() 不抛异常', !renderErr, renderErr && renderErr.message);
check('渲染结果里有江湖关键区块', ['闭关一个时辰', '今日江湖事', '武学', '近事'].every((k) => html2.includes(k)),
  ['闭关一个时辰', '今日江湖事', '武学', '近事'].filter((k) => !html2.includes(k)));
check('未入门时显示拜山入口', html2.includes('拜山') && html2.includes('无名散人'));
check('渲染结果无 undefined 泄漏', !html2.includes('undefined') && !html2.includes('NaN'),
  (html2.match(/.{0,40}(undefined|NaN).{0,40}/) || [''])[0]);

// 渲染在有门派/有伙伴/有对局时也要成立
resetGame();
J().sect = 'tangmen';
J().skills.hansha = 3;
J().hours = 5; J().taels = 50;
sandbox.getState().pets = [{ id: 'p1', petId: 'raccoon-typing', name: '打工卜' }];
Jianghu.joinSect('tangmen');
let html3 = '', err3 = null;
try { html3 = Jianghu.render(); } catch (e) { err3 = e; }
check('有门派/伙伴时渲染不抛异常', !err3, err3 && err3.message);
check('伙伴加成都显示出来了', html3.includes('打工卜'), html3.slice(0, 200));
check('有门派时不显示拜山', !html3.includes('拜山'));

// 进行中的对局要能恢复渲染
resetGame();
J().hours = 50; J().taels = 500;
J().duel = { foe: WUXIA.FOES[0].id, foeHp: 10, hp: 5, round: 2, guard: false, lines: ['第2回合：测试'] };
let html4 = '', err4 = null;
try { html4 = Jianghu.render(); } catch (e) { err4 = e; }
check('有进行中对局时渲染不抛异常', !err4, err4 && err4.message);
check('对局界面出现四个动作', ['进招', '守势', '运功调息', '轻身脱身'].every((k) => html4.includes(k)));

/* ---------- E. 装备加成与套装（Task 3：gearBonus / setBonus / mainStat 接入 stats） ---------- */
// 装备四层顺序：自身 → 门派 → 宠物伙伴 → gearBonus → setBonus，各层纯加法。
const GSLOTS = { weapon: null, armor: null, boots: null, charm: null };
function gEquip(overrides) { return Object.assign({}, GSLOTS, overrides || {}); }
// 上面 stats 用的 sandbox.getState() 就是 state()；这里统一从 J() 里直接造装备存档。
function sbWithShaolin(n) {
  const ids = ['weapon_shaolin_t1', 'armor_shaolin_t1', 'boots_shaolin_t1', 'charm_shaolin_t1'];
  const owned = {}, equipped = {};
  ids.slice(0, n).forEach((id) => {
    const item = WUXIA.GEAR.filter((g) => g.id === id)[0];
    owned[id] = { lvl: 0 };
    equipped[item.slot] = id;
  });
  J().gear = { owned, equipped };
  try { return Jianghu.setBonus(); } catch (e) { return { __err: e.message }; }
}

// E1 单槽装备 → gearBonus() 等于该件 bonus
resetGame();
J().gear = { owned: { weapon_general_t0: { lvl: 0 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
let gb1 = null, gbErr1 = null;
try { gb1 = Jianghu.gearBonus(); } catch (e) { gbErr1 = e; }
check('单槽装备 gearBonus 等于该件 bonus', !gbErr1 && gb1 && gb1.neili === 1 && gb1.gengu === 1 && gb1.shenfa === 0 && gb1.wuxing === 0,
  { gb1, err: gbErr1 && gbErr1.message });

// ---- 四槽全穿 → 各属性为四件之和（凡品四件：ne 1+g 1 / g 2 / 身 2 / 悟 2）
resetGame();
J().gear = {
  owned: { weapon_general_t0: { lvl: 0 }, armor_general_t0: { lvl: 0 }, boots_general_t0: { lvl: 0 }, charm_general_t0: { lvl: 0 } },
  equipped: gEquip({ weapon: 'weapon_general_t0', armor: 'armor_general_t0', boots: 'boots_general_t0', charm: 'charm_general_t0' }),
};
let gb4 = null, gbErr4 = null;
try { gb4 = Jianghu.gearBonus(); } catch (e) { gbErr4 = e; }
check('四槽全穿 gearBonus 各属性为四件之和', !gbErr4 && gb4 && gb4.neili === 1 && gb4.gengu === 3 && gb4.shenfa === 2 && gb4.wuxing === 2,
  { gb4, err: gbErr4 && gbErr4.message });

// 强化 2 级 → 只有主属性 +2，其余键不变（凡品刀主属性=内力，其余不动）
resetGame();
J().gear = { owned: { weapon_general_t0: { lvl: 2 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
let gbUp = null, gbErrUp = null;
try { gbUp = Jianghu.gearBonus(); } catch (e) { gbErrUp = e; }
check('强化 2 级后只有主属性 +2，其余键不变', !gbErrUp && gbUp && gbUp.neili === 3 && gbUp.gengu === 1 && gbUp.shenfa === 0 && gbUp.wuxing === 0,
  { gbUp, err: gbErrUp && gbErrUp.message });

// 主属性并列取先出现者（neili > gengu > shenfa > wuxing）
let ms = null, msErr = null;
try { ms = Jianghu.mainStat({ neili: 3, gengu: 3 }); } catch (e) { msErr = e; }
check('mainStat 并列时取 neili', !msErr && ms === 'neili', { ms, err: msErr && msErr.message });

// 未入门派（sect=null）穿门派款 → setBonus() 为空对象
resetGame();
J().gear = { owned: { weapon_shaolin_t1: { lvl: 0 }, armor_shaolin_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_shaolin_t1', armor: 'armor_shaolin_t1' }) };
let sbNone = null, sbErrNone = null;
try { sbNone = Jianghu.setBonus(); } catch (e) { sbErrNone = e; }
check('未入门派穿门派款 setBonus 为空对象', !sbErrNone && JSON.stringify(sbNone) === '{}', { sbNone, err: sbErrNone && sbErrNone.message });

// 入门派后本门 1/2/3/4 件 → {} / +1 / 仍 +1（Review Focus 5）/ +2
resetGame();
J().sect = 'shaolin';
const sb1 = sbWithShaolin(1), sb2 = sbWithShaolin(2), sb3 = sbWithShaolin(3), sb4 = sbWithShaolin(4);
check('本门 1/2/3/4 件 → {}/+1/+1/+2',
  JSON.stringify(sb1) === '{}' && JSON.stringify(sb2) === '{"gengu":1}'
    && JSON.stringify(sb3) === '{"gengu":1}' && JSON.stringify(sb4) === '{"gengu":2}',
  { sb1, sb2, sb3, sb4 });

// 穿别派门派款 4 件 → setBonus() 仍为空对象
resetGame();
J().sect = 'shaolin';
J().gear = { owned: { weapon_wudang_t1: { lvl: 0 }, armor_wudang_t1: { lvl: 0 }, boots_wudang_t1: { lvl: 0 }, charm_wudang_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_wudang_t1', armor: 'armor_wudang_t1', boots: 'boots_wudang_t1', charm: 'charm_wudang_t1' }) };
let sbOther = null, sbErrOther = null;
try { sbOther = Jianghu.setBonus(); } catch (e) { sbErrOther = e; }
check('穿别派门派款 4 件 setBonus 仍为空对象', !sbErrOther && JSON.stringify(sbOther) === '{}', { sbOther, err: sbErrOther && sbErrOther.message });

// stats() 顺序断言：四维合计恰为 13（自身 0 + 门派武当 +4 + 宠物 1 + 装备两件别派 +8 + 套装不触发 0）
resetGame();
J().stats = { neili: 0, gengu: 0, shenfa: 0, wuxing: 0 };
J().sect = 'wudang';
sandbox.getState().pets = [{ id: 'p1', petId: 'no-such-pet', name: '切' }]; // 未注册 petId → 用 default {gengu:+1}
J().gear = { owned: { weapon_shaolin_t1: { lvl: 0 }, armor_general_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_shaolin_t1', armor: 'armor_general_t1' }) };
let st13 = null, st13Err = null;
try { st13 = Jianghu.stats(); } catch (e) { st13Err = e; }
const sum13 = st13 ? st13.neili + st13.gengu + st13.shenfa + st13.wuxing : NaN;
check('stats() 层序：自身+门派+宠物+装备+套装 合计恰为 13',
  !st13Err && st13 && st13.neili === 5 && st13.gengu === 8 && st13.shenfa === 0 && st13.wuxing === 0 && sum13 === 13,
  { st13, sum13, err: st13Err && st13Err.message });

// 套装生效且读 stats()：端到端验证 setBonus 真的叠加进了 stats()
// （E 节既有用例要么套装不触发、要么直接调 setBonus()，均不覆盖此路径）
// 存档：sect=少林 + 装备 2 件少林件，lvl 均为 0
//   weapon_shaolin_t1 bonus {neili:1, gengu:3}；armor_shaolin_t1 bonus {gengu:4}
//   叠加：自身 5/5/5/5 + 门派 shaolin {gengu:+4} + 装备 {neili:+1, gengu:+7} + 套装 2 件 {gengu:+1}
//   => neili 6 / gengu 17 / shenfa 5 / wuxing 5
resetGame();
J().sect = 'shaolin';
J().gear = { owned: { weapon_shaolin_t1: { lvl: 0 }, armor_shaolin_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_shaolin_t1', armor: 'armor_shaolin_t1' }) };
let stSet = null, stSetErr = null;
try { stSet = Jianghu.stats(); } catch (e) { stSetErr = e; }
check('套装生效 stats() 端到端：自身+门派+两件装+套装(+1) 精确一致',
  !stSetErr && stSet && stSet.neili === 6 && stSet.gengu === 17 && stSet.shenfa === 5 && stSet.wuxing === 5,
  { stSet, err: stSetErr && stSetErr.message });

// 数值纪律：四槽珍品满强化 gearBonus() 四维合计恰为 48
resetGame();
const t2Ids = ['weapon_general_t2', 'armor_general_t2', 'boots_general_t2', 'charm_general_t2'];
const ownedT2 = {}, equippedT2 = {};
t2Ids.forEach((id) => { const item = WUXIA.GEAR.filter((g) => g.id === id)[0]; ownedT2[id] = { lvl: 6 }; equippedT2[item.slot] = id; });
J().gear = { owned: ownedT2, equipped: equippedT2 };
let gb48 = null, gbErr48 = null;
try { gb48 = Jianghu.gearBonus(); } catch (e) { gbErr48 = e; }
const sum48 = gb48 ? gb48.neili + gb48.gengu + gb48.shenfa + gb48.wuxing : NaN;
check('四槽珍品满强化四维合计恰为 48', !gbErr48 && gb48 && sum48 === 48
  && gb48.neili === 9 && gb48.gengu === 15 && gb48.shenfa === 12 && gb48.wuxing === 12, { gb48, sum48, err: gbErr48 && gbErr48.message });

/* ---------- F. 装备四动作（Task 4：买 / 穿 / 卸 / 强化） ---------- */
// F1 买：成功扣价且入囊 / 银两不足 / 已拥有 / 别派门派款 / 未入门派款
const gw0 = WUXIA.GEAR.filter((g) => g.id === 'weapon_general_t0')[0];

resetGame();
J().taels = 500;
J().gear = { owned: {}, equipped: gEquip() };
Jianghu.buyGear('weapon_general_t0');
check('buyGear 成功：扣 price 且 owned[id].lvl === 0',
  J().taels === 500 - gw0.price && !!J().gear.owned.weapon_general_t0 && J().gear.owned.weapon_general_t0.lvl === 0,
  { taels: J().taels, owned: J().gear.owned });
sane('buyGear 成功后');
const tOwned = J().taels;
Jianghu.buyGear('weapon_general_t0');
check('buyGear 已拥有 → 被拒且 taels 不变', J().taels === tOwned && Object.keys(J().gear.owned).length === 1, { taels: J().taels });

resetGame();
J().taels = 5; // 低于 weapon_general_t0 的 90 两
J().gear = { owned: {}, equipped: gEquip() };
Jianghu.buyGear('weapon_general_t0');
check('buyGear 银两不足 → 被拒且 taels 不变', J().taels === 5 && !J().gear.owned.weapon_general_t0, { taels: J().taels });
sane('buyGear 银两不足拒后');

resetGame();
J().sect = 'shaolin';
J().taels = 999;
J().gear = { owned: {}, equipped: gEquip() };
Jianghu.buyGear('weapon_wudang_t1');
check('buyGear 别派门派款 → 被拒', J().taels === 999 && !J().gear.owned.weapon_wudang_t1, { taels: J().taels });

resetGame();
J().sect = null;
J().taels = 999;
J().gear = { owned: {}, equipped: gEquip() };
Jianghu.buyGear('weapon_shaolin_t1');
check('buyGear 未入门派时门派款 → 被拒', J().taels === 999 && !J().gear.owned.weapon_shaolin_t1, { taels: J().taels });

// F2 穿：未拥有被拒 / 穿上 / 同槽换不删仓 / 重复穿同一件幂等
resetGame();
J().gear = { owned: { weapon_general_t1: { lvl: 0 } }, equipped: gEquip() };
Jianghu.equipGear('weapon_general_t0');       // 行囊里没有
check('equipGear 未拥有 → 被拒', J().gear.equipped.weapon === null, J().gear.equipped);
Jianghu.equipGear('weapon_general_t1');
check('equipGear 成功：equipped[item.slot] === id', J().gear.equipped.weapon === 'weapon_general_t1', J().gear.equipped);

// 幂等：同门派两件装备已穿齐，重复穿同一件不改变 setBonus 件数
resetGame();
J().sect = 'shaolin';
J().gear = { owned: { weapon_shaolin_t1: { lvl: 0 }, armor_shaolin_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_shaolin_t1', armor: 'armor_shaolin_t1' }) };
const setBefore = JSON.stringify(Jianghu.setBonus());
Jianghu.equipGear('weapon_shaolin_t1');
check('equipGear 重复同一件 → 幂等（equipped 与 setBonus 件数不变）',
  J().gear.equipped.weapon === 'weapon_shaolin_t1' && JSON.stringify(Jianghu.setBonus()) === setBefore,
  { equipped: J().gear.equipped, set: Jianghu.setBonus(), setBefore });
sane('equipGear 幂等后');

resetGame();
J().gear = { owned: { weapon_general_t0: { lvl: 0 }, weapon_general_t1: { lvl: 0 } }, equipped: gEquip() };
Jianghu.equipGear('weapon_general_t0');
Jianghu.equipGear('weapon_general_t1');
check('equipGear 穿第二件同槽 → 槽位换新且旧件仍在 owned 里',
  J().gear.equipped.weapon === 'weapon_general_t1' && !!J().gear.owned.weapon_general_t0 && !!J().gear.owned.weapon_general_t1,
  { equipped: J().gear.equipped, owned: J().gear.owned });
sane('equipGear 后');

// F3 卸：合法槽位置空 / 非法槽位被拒且状态不变
resetGame();
J().gear = { owned: { weapon_general_t0: { lvl: 0 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
Jianghu.unequipGear('weapon');
check('unequipGear 合法槽位 → 置空且物品仍在 owned', J().gear.equipped.weapon === null && !!J().gear.owned.weapon_general_t0, J().gear.equipped);
const snapPre = JSON.stringify(J().gear);
Jianghu.unequipGear('leftHand');
check('unequipGear 非法槽位 → 被拒且状态不变', JSON.stringify(J().gear) === snapPre, { gear: J().gear, snapPre });
sane('unequipGear 后');

// F4 强化：未拥有 / 已达上限 / 银两不足 / 成功扣费 / 恰好扣费到 0
resetGame();
J().taels = 999;
J().gear = { owned: {}, equipped: gEquip() };
Jianghu.upgradeGear('weapon_general_t1');
check('upgradeGear 未拥有 → 被拒', J().taels === 999 && !J().gear.owned.weapon_general_t1, { taels: J().taels });

resetGame();
J().taels = 999;
J().gear = { owned: { weapon_general_t0: { lvl: 2 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
Jianghu.upgradeGear('weapon_general_t0');
check('upgradeGear 已达 gearTierCap → 被拒且 taels 不变',
  J().taels === 999 && J().gear.owned.weapon_general_t0.lvl === 2, { taels: J().taels, lvl: J().gear.owned.weapon_general_t0.lvl });

const ugItem = gw0;   // weapon_general_t0
const cost0 = Math.round(ugItem.price * 0.25 * (0 + 1));
resetGame();
J().taels = 1;
J().gear = { owned: { weapon_general_t0: { lvl: 0 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
Jianghu.upgradeGear('weapon_general_t0');
check('upgradeGear 银两不足 → 被拒', J().taels === 1 && J().gear.owned.weapon_general_t0.lvl === 0, { taels: J().taels, lvl: J().gear.owned.weapon_general_t0.lvl });

resetGame();
J().taels = 999;
J().gear = { owned: { weapon_general_t0: { lvl: 1 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
const cost1 = Math.round(gw0.price * 0.25 * (1 + 1));
Jianghu.upgradeGear('weapon_general_t0');
check('upgradeGear 成功：lvl+1 且 taels 减少 upgradeCost(item,lvl)',
  J().gear.owned.weapon_general_t0.lvl === 2 && J().taels === 999 - cost1,
  { lvl: J().gear.owned.weapon_general_t0.lvl, taels: J().taels });
sane('upgradeGear 成功后');

resetGame();
const exact0 = Math.round(gw0.price * 0.25 * 1);   // 与 upgradeCost(item, 0) 一致
J().taels = exact0;
J().gear = { owned: { weapon_general_t0: { lvl: 0 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
Jianghu.upgradeGear('weapon_general_t0');
check('upgradeGear 银两恰好等于消耗 → 成功且 taels === 0',
  J().gear.owned.weapon_general_t0.lvl === 1 && J().taels === 0, { lvl: J().gear.owned.weapon_general_t0.lvl, taels: J().taels });
sane('upgradeGear 恰好扣费后');

// F5 强化费用公式
check('upgradeCost(item, 0) === Math.round(price * 0.25)',
  Jianghu.upgradeCost(WUXIA.GEAR.filter((g) => g.id === 'weapon_general_t0')[0], 0) === cost0, cost0);

/* ---------- G. 掉落与事件奖励（Task 5：获得途径与重复折算） ---------- */
// 可控随机：临时把 Math.random 置成常量或序列，用来掷掉落与奇遇分支。
function withRoll(value, fn) {
  const real = Math.random;
  Math.random = function () { return value; };
  try { return fn(); }
  finally { Math.random = real; }
}
function withRandSeq(values, fn) {   // Math.random() 依次取 values，取完返 0
  const real = Math.random, q = values.slice();
  Math.random = function () { return q.length ? q.shift() : 0; };
  try { return fn(); }
  finally { Math.random = real; }
}
function gearOwned() { return (J().gear && J().gear.owned) || {}; }
function gearById(id) { return WUXIA.GEAR.filter(function (g) { return g.id === id; })[0] || null; }

// G0 直接 API：grantGear 的三种行为（owned / duplicate / unknown）
resetGame();
J().gear = { owned: {}, equipped: gEquip() };
let g0err = null, g0r1 = null, g0r2 = null, g0r3 = null;
try {
  g0r1 = Jianghu.grantGear('weapon_general_t0');
  g0r2 = Jianghu.grantGear('weapon_general_t0');
  g0r3 = Jianghu.grantGear('不存在的兵器');
} catch (e) { g0err = e; }
const g0Item = WUXIA.GEAR.filter(function (g) { return g.id === 'weapon_general_t0'; })[0];
check('grantGear 新装备返回 owned 且入囊为 0 级',
  !g0err && g0r1 === 'owned' && J().gear.owned.weapon_general_t0
    && J().gear.owned.weapon_general_t0.lvl === 0,
  { err: g0err && g0err.message, r1: g0r1, owned: J().gear.owned });
check('grantGear 重复返回 duplicate 且折算 30% 银两',
  !g0err && g0r2 === 'duplicate' && J().taels === Math.round(g0Item.price * 0.3),
  { err: g0err && g0err.message, r2: g0r2, taels: J().taels, want: Math.round(g0Item.price * 0.3) });
check('grantGear 未知 id 返回 unknown 且不崩',
  !g0err && g0r3 === 'unknown' && J().taels === Math.round(g0Item.price * 0.3),
  { err: g0err && g0err.message, r3: g0r3, taels: J().taels });
sane('grantGear 直接调用后');

// G1 内容形状：测试收口（每条字段拼装的细节交互由 pytest 的 harness 校验）
const chance1Foe = WUXIA.FOES.find(function (f) {
  return (f.drops || []).some(function (d) { return d.kind === 'general' && d.chance === 1; });
});
check('内容里有 chance=1 的通用掉落', !!chance1Foe, chance1Foe && chance1Foe.id);
const sectWeaponFoe = WUXIA.FOES.find(function (f) {
  return (f.drops || []).some(function (d) { return d.kind === 'sect' && d.slot === 'weapon'; });
});
check('内容里有门派武器掉落', !!sectWeaponFoe, sectWeaponFoe && sectWeaponFoe.id);
const gearEvtCount = WUXIA.EVENTS.filter(function (e) {
  return e.choices.some(function (c) { return c.outcomes.some(function (o) { return o.gain && o.gain.gear; }); });
}).length;
check('内容里至少两个事件发装备', gearEvtCount >= 2, gearEvtCount);

// G2 胜利掉落：chance=1 的 general 条目打赢必进囊
if (chance1Foe) {
  const d1 = chance1Foe.drops.filter(function (d) { return d.kind === 'general' && d.chance === 1; })[0];
  resetGame();
  J().hours = 100; J().stats = { neili: 80, gengu: 80, shenfa: 80, wuxing: 80 };
  J().gear = { owned: {}, equipped: gEquip() };
  J().duel = { foe: chance1Foe.id, foeHp: 1, hp: 9999, round: 1, guard: false, lines: [] };
  withRoll(0.9, function () { Jianghu.spar('strike'); });
  check('胜利掉落 chance=1 必然进囊', !!gearOwned()[d1.gear] && gearOwned()[d1.gear].lvl === 0,
    { gear: d1.gear, owned: gearOwned() });
  sane('胜利掉落战后');
}

// G3 重复掉落：owned 不增、折算 30%、挂进日志
if (chance1Foe) {
  const dUp = chance1Foe.drops.filter(function (d) { return d.kind === 'general' && d.chance === 1; })[0];
  const upPrice = gearById(dUp.gear).price;
  resetGame();
  J().hours = 100; J().stats = { neili: 80, gengu: 80, shenfa: 80, wuxing: 80 };
  J().taels = 0;
  J().gear = { owned: {}, equipped: gEquip() };
  J().duel = { foe: chance1Foe.id, foeHp: 1, hp: 9999, round: 1, guard: false, lines: [] };
  withRoll(0.9, function () { Jianghu.spar('strike'); });          // 第一次：进囊
  const tAfterFirst = J().taels;
  J().duel = { foe: chance1Foe.id, foeHp: 1, hp: 9999, round: 1, guard: false, lines: [] };
  withRoll(0.9, function () { Jianghu.spar('strike'); });      // 第二次：同一件
  check('重复掉落 owned 不新增条目', Object.keys(gearOwned()).length === 1 && !!gearOwned()[dUp.gear],
    { owned: gearOwned() });
  check('重复掉落折算成 30% 银两（连同胜局银两一起算）',
    J().taels - tAfterFirst === chance1Foe.taels + Math.round(upPrice * 0.3),
    { after: J().taels, afterFirst: tAfterFirst, foeT: chance1Foe.taels, price: upPrice });
  check('重复折算写进日志',
    J().log.some(function (l) { return l.t.indexOf('折算') >= 0; }), J().log && J().log[0]);
  sane('重复掉落折算后');
}

// G3b 边界：chance=0 的条目必然不掉、也不崩
{
  // 内容约束不允许写 chance=0，这里临时塞一个制造边界，测规则的鲁棒性
  const ghostFoe = { id: 'ghost-no-drop', name: '测不出落', blurb: 'x', minRealm: 0,
    hp: 1, atk: 0, def: 0, taels: 1, exp: 1,
    drops: [{ kind: 'general', gear: 'armor_general_t0', chance: 0 }] };
  WUXIA.FOES.push(ghostFoe);
  try {
    resetGame();
    J().hours = 100; J().stats = { neili: 40, gengu: 40, shenfa: 40, wuxing: 40 };
    J().gear = { owned: {}, equipped: gEquip() };
    J().duel = { foe: ghostFoe.id, foeHp: 1, hp: 9999, round: 1, guard: false, lines: [] };
    withRoll(0.9, function () { Jianghu.spar('strike'); });
    check('chance=0 的条目必然不掉且不崩', !gearOwned().armor_general_t0, gearOwned());
  } finally { WUXIA.FOES.pop(); }
}

// G4 门派掉落按玩家门派解析（resolveDrop 与打赢入库两步走）
resetGame(); J().sect = 'shaolin';
const sectSha = Jianghu.resolveDrop({ kind: 'sect', slot: 'weapon' });
resetGame(); J().sect = 'tangmen';
const sectTan = Jianghu.resolveDrop({ kind: 'sect', slot: 'weapon' });
check('resolveDrop(sect/weapon) 少林弟子 → 少林兵器', sectSha && sectSha.id === 'weapon_shaolin_t1', sectSha);
check('resolveDrop(sect/weapon) 唐门弟子 → 唐门兵器', sectSha && sectTan && sectTan.id === 'weapon_tangmen_t1', sectTan);
if (sectWeaponFoe) {
  resetGame();
  J().sect = 'shaolin';
  J().hours = 100; J().stats = { neili: 40, gengu: 40, shenfa: 40, wuxing: 40 };
  J().gear = { owned: {}, equipped: gEquip() };
  J().duel = { foe: sectWeaponFoe.id, foeHp: 1, hp: 9999, round: 1, guard: false, lines: [] };
  withRoll(0.01, function () { Jianghu.spar('strike'); });
  check('打赢门派武器掉落 → 入库为少林本门兵器', !!gearOwned().weapon_shaolin_t1, gearOwned());
  sane('门派掉落入库后');
}

// G5 事件奖励：outcome.gain.gear 入库；重复同样折算
function firstGearOutcome(skipTael) {
  for (const e of WUXIA.EVENTS) {
    for (let ci = 0; ci < e.choices.length; ci++) {
      const c = e.choices[ci];
      if (c.requires && c.requires.skill) continue;
      const outs = c.outcomes;
      for (let oi = 0; oi < outs.length; oi++) {
        const o = outs[oi];
        if (o.gain && o.gain.gear && (!skipTael || !o.gain.taels)) return { e, ci, oi, o, outs };
      }
    }
  }
  return null;
}
function forkAt(outs, oi) {   // 返回逼出第 oi 个分支的随机序列
  const vals = [];
  for (let i = 0; i < oi; i++) vals.push(0.99);       // 靠前的分支全部落空
  if (oi < outs.length - 1) vals.push(0.01);          // 目标分支本身有 at
  return vals;
}
const gearAward = firstGearOutcome(false);
if (gearAward) {
  const gIt = gearById(gearAward.o.gain.gear);
  resetGame();
  J().hours = 60; J().taels = 0;
  J().stats = { neili: 60, gengu: 60, shenfa: 60, wuxing: 60 };
  J().gear = { owned: {}, equipped: gEquip() };
  J().pending = { id: gearAward.e.id };
  withRandSeq(forkAt(gearAward.outs, gearAward.oi), function () { Jianghu.choose(gearAward.ci); });
  check('事件 outcome.gain.gear → 该件入库（0 级）',
    !!J().gear.owned[gearAward.o.gain.gear] && J().gear.owned[gearAward.o.gain.gear].lvl === 0,
    { gear: gearAward.o.gain.gear, owned: J().gear.owned });
  sane('事件奖励装备后');
}

const gearDup = firstGearOutcome(true);   // 选一件不动 taels 的，折算金额才干净
if (gearDup) {
  const dupItem = gearById(gearDup.o.gain.gear);
  resetGame();
  J().hours = 60; J().taels = 0;
  J().stats = { neili: 60, gengu: 60, shenfa: 60, wuxing: 60 };
  J().gear = { owned: {}, equipped: gEquip() };
  J().pending = { id: gearDup.e.id };
  withRandSeq(forkAt(gearDup.outs, gearDup.oi), function () { Jianghu.choose(gearDup.ci); });   // 第一次：进囊
  const tHave = J().taels;
  J().pending = { id: gearDup.e.id };
  withRandSeq(forkAt(gearDup.outs, gearDup.oi), function () { Jianghu.choose(gearDup.ci); });   // 第二次：重复
  check('事件重复派装备 → 折算 30% 银两',
    J().taels === tHave + Math.round(dupItem.price * 0.3)
      && Object.keys(J().gear.owned).length === 1,
    { before: tHave, after: J().taels, price: dupItem.price, owned: J().gear.owned });
  check('事件折算也写进日志',
    J().log.some(function (l) { return l.t.indexOf('折算') >= 0; }), J().log && J().log[0]);
  sane('事件重复折算后');
}
/* ---------- H. 界面三张卡片（Task 6：装备 / 行囊 / 货栈 接入 render） ---------- */
function hRender() { try { return Jianghu.render(); } catch (e) { return 'ERR:' + (e && e.message); } }
function shopOnly(html) { const i = html.indexOf('货栈'); return i < 0 ? '' : html.slice(i); }

// H1 空背包：三张卡片区块都出现
resetGame();
const hEmpty = hRender();
check('H1 空背包渲染含「装备」「行囊」「货栈」三区块',
  ['装备', '行囊', '货栈'].every((k) => hEmpty.includes(k)),
  ['装备', '行囊', '货栈'].filter((k) => !hEmpty.includes(k)));

// H2 四个槽位名出现；空槽位显示占位文案
resetGame();
J().gear = { owned: {}, equipped: gEquip() };
const hSlots = hRender();
check('H2 四个槽位名都出现（武器/护甲/靴子/佩饰）',
  ['武器', '护甲', '靴子', '佩饰'].every((k) => hSlots.includes(k)),
  ['武器', '护甲', '靴子', '佩饰'].filter((k) => !hSlots.includes(k)));
check('H2 未穿槽位显示占位文案', hSlots.includes('未穿戴'),
  hSlots.slice(Math.max(0, hSlots.indexOf('装备')), hSlots.indexOf('装备') + 260));

// H3 已穿装备显示名称与强化等级
resetGame();
J().gear = { owned: { weapon_general_t1: { lvl: 2 } }, equipped: gEquip({ weapon: 'weapon_general_t1' }) };
const hWorn = hRender();
check('H3 已穿装备显示装备名与强化等级',
  hWorn.includes('百炼雁翎刀') && hWorn.includes('+2'), hWorn.slice(0, 500));

// H4 已拥有：出现在行囊、不在货栈
resetGame();
J().gear = { owned: { weapon_general_t0: { lvl: 0 } }, equipped: gEquip() };
const hOwn = hRender();
const shop4 = shopOnly(hOwn);
check('H4 已拥有装备出现在行囊', hOwn.includes('白铁短刀'), hOwn.slice(0, 400));
check('H4 已拥有装备不在货栈', !shop4.includes('白铁短刀'), shop4.slice(0, 200));

// H5 门派款可见性：本门款货栈标价 350 / 别派款不见 / 未入门派不见
resetGame();
J().sect = 'shaolin';
J().taels = 999;
J().gear = { owned: {}, equipped: gEquip() };
const hSha = hRender();
const shopSha = shopOnly(hSha);
check('H5 本门少林款在货栈且标价 350', shopSha.includes('齐眉铁棍') && shopSha.includes('350'), shopSha.slice(0, 260));
check('H5 别派武当款不在货栈', !shopSha.includes('七星长剑'), shopSha.slice(0, 260));

resetGame();
J().gear = { owned: {}, equipped: gEquip() };
const hNoSect = hRender();
check('H5 未入门时门派款不在货栈', !shopOnly(hNoSect).includes('齐眉铁棍'), shopOnly(hNoSect).slice(0, 120));

// H6 银两不足：购入按钮 disabled；充足时可购（对照）
resetGame();
J().taels = 1;
J().gear = { owned: {}, equipped: gEquip() };
const hPoor = hRender();
const poorBtn = hPoor.match(/<button[^>]*onclick="Jianghu\.buyGear\('weapon_general_t0'\)"[^>]*>/);
check('H6 银两不足时购入按钮为 disabled', !!poorBtn && poorBtn[0].indexOf('disabled') >= 0, poorBtn && poorBtn[0]);

resetGame();
J().taels = 999;
J().gear = { owned: {}, equipped: gEquip() };
const hRich = hRender();
const richBtn = hRich.match(/<button[^>]*onclick="Jianghu\.buyGear\('weapon_general_t0'\)"[^>]*>/);
check('H6 银两充足时购入按钮可用（对照）', !!richBtn && richBtn[0].indexOf('disabled') < 0, richBtn && richBtn[0]);

// H7 强化达上限：淬炼按钮 disabled；未到上限且银两充足时可淬炼（对照）
resetGame();
J().taels = 999;
J().gear = { owned: { weapon_general_t0: { lvl: 2 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
const hMax = hRender();
const capBtn = hMax.match(/<button[^>]*onclick="Jianghu\.upgradeGear\('weapon_general_t0'\)"[^>]*>/);
check('H7 强化达上限时淬炼按钮 disabled', !!capBtn && capBtn[0].indexOf('disabled') >= 0, capBtn && capBtn[0]);

resetGame();
J().taels = 999;
J().gear = { owned: { weapon_general_t0: { lvl: 1 } }, equipped: gEquip({ weapon: 'weapon_general_t0' }) };
const hMid = hRender();
const midBtn = hMid.match(/<button[^>]*onclick="Jianghu\.upgradeGear\('weapon_general_t0'\)"[^>]*>/);
check('H7 未到上限且银两充足淬炼按钮可用（对照）', !!midBtn && midBtn[0].indexOf('disabled') < 0, midBtn && midBtn[0]);

// H8 已穿装备时，卡片上的加成合计 = gearBonus() 四维之和
resetGame();
J().stats = { neili: 0, gengu: 0, shenfa: 0, wuxing: 0 };
J().gear = { owned: { weapon_general_t0: { lvl: 0 }, armor_general_t0: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_general_t0', armor: 'armor_general_t0' }) };
const hBonus = hRender();
const gb8 = Jianghu.gearBonus();
const gb8Sum = (gb8 && gb8.neili + gb8.gengu + gb8.shenfa + gb8.wuxing) || NaN;
check('H8 卡片装备加成合计 = gearBonus() 之和（' + gb8Sum + '）',
  hBonus.includes('装备加成 <b>+' + gb8Sum + '</b>'), { sum: gb8Sum, gb8 });

// H9 三卡齐全的全套渲染不含 undefined / NaN
resetGame();
J().sect = 'shaolin';
J().taels = 999;
J().stats = { neili: 10, gengu: 10, shenfa: 10, wuxing: 10 };
J().gear = { owned: { weapon_shaolin_t1: { lvl: 2 }, armor_shaolin_t1: { lvl: 1 }, boots_shaolin_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_shaolin_t1', armor: 'armor_shaolin_t1', boots: 'boots_shaolin_t1' }) };
const hFinal = hRender();
check('H9 三卡俱全的全套渲染无 undefined/NaN',
  !hFinal.includes('undefined') && !hFinal.includes('NaN'),
  (hFinal.match(/.{0,40}(undefined|NaN).{0,40}/) || [''])[0]);
// I. 装备卡观感：槽位图标 / 品阶胶囊 / 加成条 / 已穿戴徽章（样式钩子）
resetGame();
J().sect = 'shaolin';
J().taels = 9999;
J().stats = { neili: 0, gengu: 0, shenfa: 0, wuxing: 0 };
J().gear = { owned: { weapon_shaolin_t1: { lvl: 4 }, armor_shaolin_t1: { lvl: 0 },
                      boots_shaolin_t1: { lvl: 0 }, charm_shaolin_t1: { lvl: 0 } },
             equipped: gEquip({ weapon: 'weapon_shaolin_t1', armor: 'armor_shaolin_t1',
                                boots: 'boots_shaolin_t1', charm: 'charm_shaolin_t1' }) };
const hStyle = hRender();
const wantIcons = ['⚔️', '🛡️', '🥾', '📿'];
check('I1 装备卡四槽带槽位图标（⚔️🛡️🥾📿）',
  wantIcons.every((e) => hStyle.includes(e)), wantIcons.filter((e) => !hStyle.includes(e)));
check('I2 装备加成条带 gear-summary 钩子', hStyle.includes('gear-summary'));
check('I3 行囊里已穿戴带 gear-worn 徽章钩子', hStyle.includes('gear-worn'));
check('I4 行囊/货栈品阶胶囊带 tier-0/1/2 类',
  hStyle.includes('tier-0') && hStyle.includes('tier-1') && hStyle.includes('tier-2'));
const appCss = fs.readFileSync(HTML, 'utf8');
check('I5 HTML 样式已定义 gear-* 观感类（slot/tier/summary/worn）',
  ['.gear-slot-icon', '.gear-tier', '.gear-summary', '.gear-worn'].every((c) => appCss.includes(c)),
  ['.gear-slot-icon', '.gear-tier', '.gear-summary', '.gear-worn'].filter((c) => !appCss.includes(c)));
console.log(lines.join('\n'));
console.log('VERDICT ' + (failures === 0 ? 'ALL-PASS' : 'HAS-FAILURES (' + failures + ')'));
process.exitCode = failures === 0 ? 0 : 1;