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

console.log(lines.join('\n'));
console.log('VERDICT ' + (failures === 0 ? 'ALL-PASS' : 'HAS-FAILURES (' + failures + ')'));
process.exitCode = failures === 0 ? 0 : 1;
