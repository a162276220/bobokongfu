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

/* ---------- 7. 静态：migrateState 重复行已清 ---------- */
{
  const dup = (appSrc.match(/newState\.jianghu = oldState\.jianghu \|\| newState\.jianghu;/g) || []).length;
  check('G6 migrateState 里 jianghu 赋值只剩一行', dup === 1, { count: dup });
}

/* ---------- 8. 静态：jianghu.js 的关键守卫都已就位 ---------- */
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
