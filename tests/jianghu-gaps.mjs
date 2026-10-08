// 江湖存档自愈验证：把「内容表改名/删条目后旧存档仍指向旧 id」这类场景
// 变成断言。修复前这里 4 项崩 + 1 项软锁；修复后必须全绿。
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
function attempt(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function makeEl(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), className: '', id: '', innerHTML: '', textContent: '',
    style: {}, dataset: {}, children: [], value: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    insertAdjacentHTML() {}, getBoundingClientRect() { return { top: 0, left: 0 }; },
  };
}
const store = new Map();
const sandbox = {
  console,
  document: {
    readyState: 'loading', getElementById: () => makeEl(), querySelector: () => makeEl(),
    querySelectorAll: () => [], createElement: (t) => makeEl(t),
    addEventListener() {}, body: makeEl(), documentElement: makeEl(),
  },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, alert() {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const htmlSrc = fs.readFileSync(HTML, 'utf8');
const appMatch = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(htmlSrc);
const appSrc = appMatch[1];
vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
vm.runInContext(fs.readFileSync(WB + '\\wuxia-content.js', 'utf8'), sandbox, { filename: 'wuxia-content.js' });
vm.runInContext(fs.readFileSync(WB + '\\jianghu.js', 'utf8'), sandbox, { filename: 'jianghu.js' });

const WUXIA = sandbox.WUXIA, Jianghu = sandbox.Jianghu;
const J = () => sandbox.getState().jianghu;

function healthy() {
  const s = sandbox.getState();
  const ev = WUXIA.EVENTS[0];
  const foe = WUXIA.FOES[0];
  s.jianghu = {
    sect: 'shaolin', exp: 200, hours: 7, hoursTotal: 20, taels: 88,
    stats: { neili: 12, gengu: 12, shenfa: 12, wuxing: 12 },
    skills: { tuna: 2, luohan: 1 }, log: [], recent: [ev.id],
    pending: null, duel: null, today: { date: sandbox.todayStr(), adventures: 2 },
    gear: {
      owned: { weapon_general_t0: { lvl: 1 }, armor_shaolin_t1: { lvl: 0 } },
      equipped: { weapon: 'weapon_general_t0', armor: 'armor_shaolin_t1', boots: null, charm: null },
    },
    wins: 1, losses: 0,
  };
  return { ev, foe };
}

/* ---------- 1. 健康存档不能被自愈误伤（最重要的回归） ---------- */
{
  const { ev } = healthy();
  const before = JSON.stringify(J());
  const r = attempt(() => Jianghu.sanitize());
  check('sanitize() 对健康存档不抛异常', r.ok, r.ok ? undefined : r.error);
  check('sanitize() 对健康存档返回 false（无改动）', r.ok && r.value === false, r.value);
  check('健康存档字段一字未动', JSON.stringify(J()) === before, { before: before.slice(0, 80), after: JSON.stringify(J()).slice(0, 80) });
  check('健康存档的 pending 为空时 render 正常', attempt(() => Jianghu.render()).ok);
}

/* ---------- 2. pending 指向已删除事件 ---------- */
{
  healthy();
  J().pending = { id: 'event_that_no_longer_exists' };
  const r = attempt(() => Jianghu.choose(0));
  check('G2 待选事件已被删除时 choose() 不抛异常', r.ok, r.ok ? undefined : r.error);
  check('G2 choose() 后 pending 被清空', J().pending === null, J().pending);
}
{
  healthy();
  J().pending = { id: 'event_that_no_longer_exists' };
  const r = attempt(() => Jianghu.render());
  check('G1 待选事件已被删除时 render() 不抛异常（不再白屏）', r.ok, r.ok ? undefined : r.error);
  check('G1 render() 返回了正常长度的页面', r.ok && r.value.length > 400, r.ok ? r.value.length : null);
  check('G1 render() 后 pending 被清空', J().pending === null, J().pending);
  check('G1 清空后往 log 里留了一条记录', J().log.length === 1 && /散佚/.test(J().log[0].t), J().log);
}

/* ---------- 3. duel.foe 指向已删除敌人 ---------- */
{
  healthy();
  J().duel = { foe: 'foe_that_no_longer_exists', foeHp: 10, hp: 10, round: 1, guard: false, lines: [] };
  const r = attempt(() => Jianghu.render());
  check('G3 对手已被删除时 render() 不抛异常（不再白屏）', r.ok, r.ok ? undefined : r.error);
  check('G3 render() 后 duel 被清空', J().duel === null, J().duel);
}
{
  healthy();
  J().duel = { foe: 'foe_that_no_longer_exists', foeHp: 10, hp: 10, round: 1, guard: false, lines: [] };
  const r = attempt(() => Jianghu.spar('strike'));
  check('G4 对手已被删除时 spar() 不抛异常', r.ok, r.ok ? undefined : r.error);
  check('G4 spar() 后对局安全收场', J().duel === null && J().pending === null, { duel: J().duel, pending: J().pending });
}

/* ---------- 4. sect 指向已删除门派（软锁） ---------- */
{
  healthy();
  J().sect = 'sect_that_no_longer_exists';
  const r = attempt(() => Jianghu.render());
  check('G5 门派已被删除时 render() 不抛异常', r.ok, r.ok ? undefined : r.error);
  check('G5 render() 后门派被清成散人', J().sect === null, J().sect);
}
{
  healthy();
  J().sect = 'sect_that_no_longer_exists';
  const r = attempt(() => Jianghu.joinSect('shaolin'));
  check('G5 门派已被删除时仍能重新拜师（软锁解除）', r.ok && J().sect === 'shaolin', { ok: r.ok, sect: J().sect, err: r.error });
  check('G5 重新拜师后拿到入门武功', J().skills.luohan >= 1, J().skills);
}
{
  // 正常情况下的「不能改投」必须仍然生效
  healthy();
  const r = attempt(() => Jianghu.joinSect('wudang'));
  check('G5 门派仍在册时依然不能改投（原规则未被削弱）', r.ok && J().sect === 'shaolin', { sect: J().sect });
}

/* ---------- 5. 孤儿武学键 ---------- */
{
  healthy();
  J().skills['skill_that_no_longer_exists'] = 3;
  const r = attempt(() => Jianghu.render());
  check('孤儿武学键不会让 render 崩溃', r.ok, r.ok ? undefined : r.error);
  check('孤儿武学键被清理', J().skills['skill_that_no_longer_exists'] === undefined, Object.keys(J().skills));
  check('同一存档里合法武学被保留', J().skills.tuna === 2 && J().skills.luohan === 1, J().skills);
}

/* ---------- 6. 其他边界 ---------- */
{
  healthy();
  const ev = WUXIA.EVENTS[0];
  J().pending = { id: ev.id };
  const r = attempt(() => Jianghu.choose(999));
  check('choose(越界下标) 不抛异常', r.ok, r.ok ? undefined : r.error);
}
{
  healthy();
  const r = attempt(() => Jianghu.render());
  check('健康存档 render 不抛异常且含关键区块', r.ok && ['闭关一个时辰', '近事'].every((k) => r.value.includes(k)));
}
{
  // 自愈要可重复调用（幂等）
  healthy();
  J().pending = { id: 'gone' };
  J().duel = { foe: 'gone', foeHp: 1, hp: 1, round: 1, guard: false, lines: [] };
  J().sect = 'gone';
  Jianghu.sanitize();
  const after1 = JSON.stringify(J());
  Jianghu.sanitize();
  check('sanitize() 幂等：第二次调用不再改动', JSON.stringify(J()) === after1);
  check('三处失效引用一次清完', J().pending === null && J().duel === null && J().sect === null);
}

/* ---------- 7. 装备：失效 id、坏结构与越界强化 ---------- */
const SLOTS = ['weapon', 'armor', 'boots', 'charm'];
function gearSave(owned, equipped) {
  healthy();
  J().gear = { owned: owned, equipped: equipped };
}
{
  // 行囊里混进两件已经删掉的装备：render 不能崩，键要清掉，合法件保留
  gearSave({ weapon_that_no_longer_exists: { lvl: 1 }, armor_that_no_longer_exists: { lvl: 1 },
             weapon_general_t0: { lvl: 1 } },
           { weapon: null, armor: null, boots: null, charm: null });
  const r = attempt(() => Jianghu.render());
  check('G7 行囊里有已删装备时 render() 不抛异常', r.ok, r.ok ? undefined : r.error);
  check('G7 已删装备被清掉、合法件保留、强化值不动',
    Object.keys(J().gear.owned).join() === 'weapon_general_t0' && J().gear.owned.weapon_general_t0.lvl === 1,
    J().gear.owned);
  check('G7 同类清理只写一条江湖记事', J().log.length === 1, J().log.map((l) => l.t));
}
{
  // 身上穿的：一件已被删，一件从没进过行囊
  gearSave({ weapon_general_t0: { lvl: 1 } },
           { weapon: 'weapon_that_no_longer_exists', armor: 'armor_general_t2', boots: null, charm: null });
  const r = attempt(() => Jianghu.sanitize());
  check('G7 已穿装备被删后身上置空', r.ok && J().gear.equipped.weapon === null, J().gear.equipped);
  check('G7 不在行囊里的装备从身上取下', r.ok && J().gear.equipped.armor === null, J().gear.equipped);
}
{
  // 非法槽位键是删键，不是置空
  gearSave({ weapon_general_t0: { lvl: 0 } },
           { weapon: null, armor: null, boots: null, charm: null, ring: 'weapon_general_t0' });
  Jianghu.sanitize();
  check('G7 非法槽位键被删除、四个正槽还在',
    !('ring' in J().gear.equipped) && SLOTS.every((s) => s in J().gear.equipped),
    Object.keys(J().gear.equipped));
}
{
  // 强化上限按品阶：凡 2 级、精 4 级、珍 6 级
  gearSave({ weapon_general_t0: { lvl: 9 }, armor_shaolin_t1: { lvl: 9 }, boots_general_t2: { lvl: 9 },
             charm_general_t1: { lvl: 3 } },
           { weapon: null, armor: null, boots: null, charm: null });
  Jianghu.sanitize();
  check('G7 凡品强化截到 2 级', J().gear.owned.weapon_general_t0.lvl === 2, J().gear.owned.weapon_general_t0);
  check('G7 精品强化截到 4 级', J().gear.owned.armor_shaolin_t1.lvl === 4, J().gear.owned.armor_shaolin_t1);
  check('G7 珍品强化截到 6 级', J().gear.owned.boots_general_t2.lvl === 6, J().gear.owned.boots_general_t2);
  check('G7 上限之内的强化原样保留', J().gear.owned.charm_general_t1.lvl === 3, J().gear.owned.charm_general_t1);
}
{
  // ensureFields 只补一层：gear 内层坏了得 sanitize 自己兜
  healthy();
  J().gear = { owned: [], equipped: 'weapon' };
  const r = attempt(() => Jianghu.render());
  check('G7 行囊是数组、装备是字符串时不抛异常', r.ok, r.ok ? undefined : r.error);
  check('G7 坏掉的 gear 内层被重建成合法结构',
    r.ok && !Array.isArray(J().gear.owned) && !!J().gear.owned && typeof J().gear.owned === 'object'
      && SLOTS.every((s) => J().gear.equipped[s] === null) && Object.keys(J().gear.equipped).length === 4,
    J().gear);
}
{
  healthy();
  J().gear.owned['weapon_general_t0'] = 5;
  J().gear.owned['armor_general_t1'] = null;
  J().gear.owned['boots_general_t2'] = 'x';
  const h1 = Jianghu.sanitize();
  const h2 = Jianghu.sanitize();
  check('non-object owned entries rebuilt to {lvl:0}',
    J().gear.owned['weapon_general_t0'].lvl === 0 &&
    J().gear.owned['armor_general_t1'].lvl === 0 &&
    J().gear.owned['boots_general_t2'].lvl === 0);
  check('self-heal idempotent: first true, second false', h1 === true && h2 === false);
}
{
  // 整个 gear 键都没有的旧存档（真实入口是 ensureFields，这里守住兜底路径）
  healthy();
  delete J().gear;
  const r = attempt(() => Jianghu.sanitize());
  check('G7 存档没有 gear 键时 sanitize 不抛异常', r.ok, r.ok ? undefined : r.error);
  check('G7 缺 gear 键时补出四槽空结构',
    r.ok && !!J().gear && !!J().gear.owned && SLOTS.every((s) => J().gear.equipped[s] === null),
    r.ok ? J().gear : null);
}
{
  // 自愈要可重复调用（幂等）
  gearSave({ weapon_gone: { lvl: 9 } },
           { weapon: 'weapon_gone', armor: 'armor_general_t2', boots: null, charm: null, ring: 'x' });
  const first = Jianghu.sanitize();
  const snapshot = JSON.stringify(J().gear);
  const second = Jianghu.sanitize();
  check('G7 装备自愈第一次报告有改动', first === true, first);
  check('G7 装备自愈幂等：第二次不再改动',
    second === false && JSON.stringify(J().gear) === snapshot, { second: second });
}
{
  // 健康的装备存档（已穿两件、强化在限内）一字不动
  gearSave({ weapon_general_t0: { lvl: 1 }, armor_shaolin_t1: { lvl: 4 } },
           { weapon: 'weapon_general_t0', armor: 'armor_shaolin_t1', boots: null, charm: null });
  const before = JSON.stringify(J().gear);
  const r = attempt(() => Jianghu.sanitize());
  check('G7 健康装备存档一字不动',
    r.ok && r.value === false && JSON.stringify(J().gear) === before,
    r.ok ? { value: r.value, after: JSON.stringify(J().gear) } : r.error);
}

{
  // 行囊里的 owned 条目若不是对象（数字 / null / 字符串）也要自愈成 { lvl: 0 }
  gearSave({ weapon_general_t0: 5, armor_shaolin_t1: null },
           { weapon: null, armor: null, boots: null, charm: null });
  const first = Jianghu.sanitize();
  check('G7 数字与 null 的 owned 条目被自愈成 { lvl: 0 }',
    J().gear.owned.weapon_general_t0.lvl === 0 && J().gear.owned.armor_shaolin_t1.lvl === 0,
    J().gear.owned);
  check('G7 自愈后的 owned 条目强化值是数字',
    typeof J().gear.owned.weapon_general_t0.lvl === 'number' && typeof J().gear.owned.armor_shaolin_t1.lvl === 'number',
    J().gear.owned);
  const snapshot = JSON.stringify(J().gear);
  const second = Jianghu.sanitize();
  check('G7 非对象 owned 条目自愈第一次报告有改动', first === true, first);
  check('G7 非对象 owned 条目自愈幂等：第二次不再改动',
    second === false && JSON.stringify(J().gear) === snapshot, { second: second });
}

/* ---------- 8. 静态：migrateState 重复行已清 ---------- */
{
  const dup = (appSrc.match(/newState\.jianghu = oldState\.jianghu \|\| newState\.jianghu;/g) || []).length;
  check('G6 migrateState 里 jianghu 赋值只剩一行', dup === 1, { count: dup });
}

/* ---------- 9. 静态：jianghu.js 的关键守卫都已就位 ---------- */
{
  const jh = fs.readFileSync(WB + '\\jianghu.js', 'utf8');
  check('jianghu.js 定义了 sanitize()', /function sanitize\(\)/.test(jh));
  check('render() 里调用了 sanitize()', /hasContent\(\)[\s\S]{0,400}?sanitize\(\);/.test(jh));
  check('choose() 有缺失事件守卫', /if \(!event\) \{ j\.pending = null;/.test(jh));
  check('spar() 有缺失对手守卫', /if \(!foe\) \{[\s\S]{0,120}?j\.duel = null; j\.pending = null;/.test(jh));
  check('duelHtml() 有缺失对手守卫', /if \(!foe\) return '';/.test(jh));
  check('eventHtml() 有缺失事件守卫', /if \(!e\) return '';/.test(jh));
  check('joinSect() 只拦在册门派', /var cur = j\.sect \? WUXIA\.SECTS\.filter/.test(jh));
  check('sanitize 已导出', /sanitize: sanitize/.test(jh));
}

console.log(lines.join('\n'));
console.log('VERDICT ' + (failures === 0 ? 'ALL-PASS' : 'HAS-FAILURES (' + failures + ')'));
process.exitCode = failures === 0 ? 0 : 1;
