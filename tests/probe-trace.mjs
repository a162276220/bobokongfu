// 追踪探针：deskpet 的 once 轨道播完后 currentTrack 到底变成什么。
import fs from 'node:fs';
import vm from 'node:vm';

let nextId = 1;
function makeEl(tag = 'div') {
  return {
    tag, id: nextId++, _children: [], style: {}, dataset: {}, isConnected: true,
    clientWidth: 76, clientHeight: 76, innerHTML: '', src: '', complete: true,
    naturalWidth: 192, naturalHeight: 208, _attrs: {},
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { return c; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelectorAll(sel) { return this._stages || []; },
  };
}
const pending = new Map();
let h = 0;
const sandbox = {
  console,
  document: { createElement: (t) => makeEl(t), body: { appendChild() {} } },
  Image: function () { return makeEl('img'); },
  setTimeout: (fn, ms) => { const id = ++h; pending.set(id, { fn, ms }); return id; },
  clearTimeout: (id) => { pending.delete(id); },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('D:\\桌宠\\淘金矿工小屋\\deskpet-players.js', 'utf8'), sandbox);
const PM = sandbox.PetManager;

const pet = { petId: 'huhu-carrot', hunger: 80, mood: 80, health: 100 };
const stage = makeEl('div');
stage.setAttribute('data-petid', 'huhu-carrot');
const root = makeEl('div');
root._stages = [stage];

PM.mount(root, { pets: [pet], anyCheckedToday: true });
const p = PM.players['huhu-carrot'];
console.log('after mount        currentTrack =', p.currentTrack, '| timers =', pending.size);
console.log('  spec kind =', p.spec.kind, '| map.idle =', JSON.stringify(p.map && p.map.idle),
  '| tracks keys =', p.tracks ? Object.keys(p.tracks).join(',') : '(none)');
console.log('  tracks.done =', JSON.stringify(p.tracks && p.tracks.done));

PM.playTransient(pet, 'done', true);
console.log('after play(done)   currentTrack =', p.currentTrack, '| timers =', pending.size,
  '| bumpTimer =', !!p.bumpTimer);

for (let round = 1; round <= 12; round++) {
  const snap = Array.from(pending.entries());
  if (!snap.length) { console.log('round', round, ': no timers left'); break; }
  for (const [id, t] of snap) { pending.delete(id); t.fn(); }
  console.log('round', String(round).padStart(2), '      currentTrack =', String(p.currentTrack),
    '| timers =', pending.size, '| timer field =', !!p.timer);
}

/* ---------- 对照实验：只在内存里给循环轨道补上 loop:true ---------- */
console.log('');
console.log('=== 对照：内存中补 loop:true（不改文件） ===');
const spec = PM.specs['huhu-carrot'];
Object.keys(spec.frames2d.tracks).forEach((k) => {
  const t = spec.frames2d.tracks[k];
  if (t.loop !== false) t.loop = true;     // 与 SheetPlayer 的默认语义对齐
});
PM.destroy('huhu-carrot');
const stage2 = makeEl('div');
stage2.setAttribute('data-petid', 'huhu-carrot');
const root2 = makeEl('div');
root2._stages = [stage2];
PM.mount(root2, { pets: [pet], anyCheckedToday: true });
const p2 = PM.players['huhu-carrot'];
let stops = 0;
for (let round = 1; round <= 80; round++) {
  const snap = Array.from(pending.entries());
  if (!snap.length) { console.log('round', round, ': 定时器耗尽（动画停了）'); stops++; break; }
  for (const [id, t] of snap) { pending.delete(id); t.fn(); }
  if (p2.currentTrack !== 'idle') stops++;
}
console.log('补 loop:true 后跑 80 轮：currentTrack =', String(p2.currentTrack),
  '| 剩余定时器 =', pending.size, '| 异常轮数 =', stops);
