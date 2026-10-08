// Logic-level verification of deskpet-players.js without a browser.
// The module touches document/window only at call time; we stub the DOM and
// drive it inside a vm context whose global is a shared object we can read.
import fs from 'node:fs';
import vm from 'node:vm';

// ---- DOM stubs ---------------------------------------------------------
let nextId = 1;
function makeEl(tag) {
  return {
    tag,
    id: nextId++,
    _children: [],
    style: {},
    dataset: {},
    isConnected: true,
    clientWidth: 76,
    clientHeight: 76,
    innerHTML: '',
    src: '',
    complete: true,
    naturalWidth: 192,
    naturalHeight: 208,
    naturalSheetWidth: 1536,   // 8 cols * 192
    naturalSheetHeight: 1872,  // 9 rows * 208
    _attrs: {},
    appendChild(child) { this._children.push(child); return child; },
    removeChild(child) { this._children = this._children.filter((c) => c !== child); return child; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelectorAll(sel) {
      // tiny selector support for [data-petid]
      const m = /^\[data-petid\]$/.exec(sel);
      if (!m) throw new Error('stub cannot handle selector ' + sel);
      return this._stages || [];
    },
  };
}
const createdImgs = [];
const documentStub = {
  createElement: (tag) => {
    const el = makeEl(tag);
    if (tag === 'img') { createdImgs.push(el); el.onload = null; }
    return el;
  },
  body: { appendChild() {} },
};

// ---- fake clock -------------------------------------------------------
const timerHandles = { value: 0 };
const pendingTimers = new Map();
const fakeSetTimeout = (fn, ms) => {
  const h = ++timerHandles.value;
  pendingTimers.set(h, { fn, ms });
  return h;
};
const fakeClearTimeout = (h) => { pendingTimers.delete(h); };

// ---- load the module into a vm sandbox -------------------------------
const src = fs.readFileSync('D:\\桌宠\\淘金矿工小屋\\deskpet-players.js', 'utf8');
const sandbox = { console, document: documentStub };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.setTimeout = fakeSetTimeout;
sandbox.clearTimeout = fakeClearTimeout;
sandbox.Image = function () { const el = makeEl('img'); createdImgs.push(el); return el; };
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox);
} catch (e) {
  console.log('MODULE-THREW:', e.message);
  console.log(e.stack.split('\n').slice(0, 8).join('\n'));
}
const PetManager = sandbox.PetManager;

if (!PetManager) {
  console.log('FAIL module did not export PetManager');
  console.log('sandbox keys:', Object.keys(sandbox));
  console.log('src length:', src.length, 'starts with:', JSON.stringify(src.slice(0, 60)));
  process.exit(1);
}

// ---- test harness -----------------------------------------------------
let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS', name); }
  else { failures++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
function drainTimers(rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    const snapshot = Array.from(pendingTimers.entries());
    if (!snapshot.length) break;
    for (const [h, t] of snapshot) { pendingTimers.delete(h); t.fn(); }
  }
}
const pet = { petId: 'huhu-carrot', hunger: 80, mood: 80, health: 100 };
// mount() walks the root element for [data-petid] stages.
function makeRoot(children) {
  const root = makeEl('div');
  root._stages = children;
  return root;
}

// ---- 1. createPlayer + mount ------------------------------------------
const stage = makeEl('div');
stage.setAttribute('data-petid', 'huhu-carrot');
const root = makeRoot([stage]);
const playersBefore = Object.keys(PetManager.players).length;
PetManager.mount(root, { pets: [pet], anyCheckedToday: true });
check('mount creates exactly one player', Object.keys(PetManager.players).length === playersBefore + 1, Object.keys(PetManager.players));
const player = PetManager.players['huhu-carrot'];
check('mounted player resolves to idle', player.currentTrack === 'idle', player.currentTrack);
check('mount created an img node', !!player.img);

// ---- 2. once-track returns to base ------------------------------------
PetManager.playTransient(pet, 'done', true);
check('transient switches track to done', player.currentTrack === 'done', player.currentTrack);
drainTimers();
check('once-track done returns to base idle', player.currentTrack === 'idle', player.currentTrack);
// idle is a loop track: a fresh timer is expected while the pet sits.
check('once-track ends with at most the idle loop timer', !player.chainTimer && !player.bumpTimer, { timer: player.timer, chain: player.chainTimer, bump: player.bumpTimer });

// 循环轨道不能自己停下。回归来源：PET_SPECS 重生后丢了 loop:true，frames2d 的
// `!track.loop` 判定把所有循环轨道当成一次性，宠物转完一圈就永久冻结。
player.play('idle');
let aliveRounds = 0;
for (let i = 0; i < 300; i++) {
  const snapshot = Array.from(pendingTimers.entries());
  if (!snapshot.length) break;
  for (const [h, t] of snapshot) { pendingTimers.delete(h); t.fn(); }
  aliveRounds++;
}
check('循环轨道跑满 300 轮后仍在播放（不被当成一次性）',
  player.currentTrack === 'idle' && !!player.timer,
  { track: player.currentTrack, timer: !!player.timer, rounds: aliveRounds });

// ---- 3. loop transient returns via bumpTimer ---------------------------
PetManager.playTransient(pet, 'review', true);
check('loop transient plays review', player.currentTrack === 'review', player.currentTrack);
check('loop transient scheduled a bumpTimer', !!player.bumpTimer);
drainTimers();
check('loop transient fell back to idle', player.currentTrack === 'idle', player.currentTrack);
check('bumpTimer cleared after fallback', !player.bumpTimer);

// ---- 4. state -> track resolution --------------------------------------
const lowPet = { petId: 'huhu-carrot', hunger: 10, mood: 10, health: 40 };
check('low stats resolve to failed', PetManager.resolveTrack(lowPet, true) === 'failed', PetManager.resolveTrack(lowPet, true));
check('not checked in resolves to waiting', PetManager.resolveTrack(pet, false) === 'waiting', PetManager.resolveTrack(pet, false));
check('healthy + checked in resolves to idle', PetManager.resolveTrack(pet, true) === 'idle', PetManager.resolveTrack(pet, true));

// ---- 5. playChain: thinking -> tool -> done ---------------------------
PetManager.playChain(pet, true);
check('chain starts on thinking', player.currentTrack === 'thinking', player.currentTrack);
check('chain has one chainTimer', !!player.chainTimer);
drainTimers();
check('chain progressed beyond thinking', ['tool', 'done', 'idle'].includes(player.currentTrack), player.currentTrack);
drainTimers();
check('chain ended on done or fell back to idle', ['done', 'idle'].includes(player.currentTrack), player.currentTrack);
check('chainTimer cleared at end', !player.chainTimer);

// re-trigger repeatedly; chain/bump timers must not accumulate beyond one.
for (let i = 0; i < 5; i++) { PetManager.playChain(pet, true); drainTimers(8); }
const liveAfterChain = pendingTimers.size;
check('repeated playChain keeps at most one live timer', liveAfterChain <= 1, 'live=' + liveAfterChain);

// ---- 6. sheet pet: scale layout and background-position math ----------
const sheetPet = { petId: 'dundun-office', hunger: 70, mood: 70, health: 100 };
const stage2 = makeEl('div');
stage2.setAttribute('data-petid', 'dundun-office');
stage2.clientWidth = stage2.clientHeight = 76;
const root2 = makeRoot([stage2]);
PetManager.mount(root2, { pets: [sheetPet], anyCheckedToday: true });
const sp = PetManager.players['dundun-office'];
check('sheet player created', !!sp);
// The stub img defaults to a single cell; the real sheet is 1536x1872.
sp.img.naturalWidth = 1536;
sp.img.naturalHeight = 1872;
sp._measure();
sp.play(sp.currentTrack || 'idle');
check('sheet player measured cols=8 rows=9', sp.cols === 8 && sp.rows === 9, { cols: sp.cols, rows: sp.rows });
check('sheet layout computed a scale', typeof sp.scale === 'number' && sp.scale > 0, sp.scale);
const expectedW = 1536 * sp.scale;
const actualW = Number.parseFloat(sp.bg.style.backgroundSize);
check('sheet bg-size width matches computed scale', Math.abs(actualW - expectedW) < 1, { expected: expectedW, actual: sp.bg.style.backgroundSize });

sp.play('waiting', 'idle');
drainTimers(10);
const pos = sp.bg.style.backgroundPosition;
check('sheet bg-position is set and offset', /^-?[\d.]+px -?[\d.]+px$/.test(pos), pos);
check('sheet y offset equals rowIndex * cellH * scale', (function () {
  const m = pos.match(/(-?\d+)px (-?\d+)px/);
  if (!m) return false;
  const y = Math.abs(Number(m[2]));
  const rowIdx = sp.sheet.rowNames.indexOf(sp.map.waiting);
  const expected = Math.abs(rowIdx * 208 * sp.scale);
  return Math.abs(y - expected) <= 1;
})(), { pos, scale: sp.scale });

// ---- 7. page-switch guard: detached stage stops the timer -------------
const detached = makeEl('div');
detached.setAttribute('data-petid', 'huhu-carrot');
detached.isConnected = false;
const root3 = makeRoot([detached]);
PetManager.mount(root3, { pets: [pet], anyCheckedToday: true });
drainTimers(10);
check('detached stage stops its timer', !player.timer, 'timer=' + player.timer);

// ---- 8. thumb() ---------------------------------------------------------
const t1 = PetManager.thumb('huhu-carrot', 56);
check('frames2d thumb is an <img> with idle f00', t1.includes('/idle/f00.png') && t1.startsWith('<img'), t1.slice(0, 90));
const t2 = PetManager.thumb('dundun-office', 56);
check('sheet thumb is a background div sized to one cell', t2.includes('background-image') && !t2.includes('<img'), t2.slice(0, 60));

console.log(failures === 0 ? 'VERDICT ALL-PASS' : 'VERDICT HAS-FAILURES (' + failures + ')');
process.exitCode = failures === 0 ? 0 : 1;
