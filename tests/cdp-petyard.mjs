// CDP driver via Playwright's chrome-headless-shell (the only chromium build on
// this box whose startup does not need Crashpad, which the sandbox denies).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHELL = 'C:\\Users\\HUAWEI\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const PAGE_URL = 'file:///D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html';
const PORT = 9333;
const OUT = path.join(os.tmpdir(), 'cdpet-shots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootShell() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpet-'));
  const logfile = path.join(profile, 'chrome.log');
  const args = [
    '--no-sandbox', '--no-first-run',
    '--log-file=' + logfile, `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`, '--window-size=1280,900', 'about:blank',
  ];
  const child = spawn(SHELL, args, { stdio: 'ignore' });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const tail = fs.existsSync(logfile) ? fs.readFileSync(logfile, 'utf8').slice(-1500) : '(no log)';
      throw new Error(`shell exited code=${child.exitCode}\n${tail}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const v = await res.json();
        return { child, wsUrl: v.webSocketDebuggerUrl, profile };
      }
    } catch { /* not up yet */ }
    await sleep(400);
  }
  throw new Error('shell did not open CDP endpoint');
}

const seedScript = `(() => {
  const pets = [
    { id: 'pet_a', shopId: 'p_bobo', petId: 'huhu-carrot', name: '胡胡', type: '胡胡', icon: 'deskpet:huhu-carrot', hunger: 80, mood: 80, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() },
    { id: 'pet_b', shopId: 'p_dundun', petId: 'dundun-office', name: '墩墩', type: '墩墩', icon: 'deskpet:dundun-office', hunger: 75, mood: 75, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() },
    { id: 'pet_c', shopId: 'p_raccoon', petId: 'raccoon-typing', name: '打工卜', type: '打工卜', icon: 'deskpet:raccoon-typing', hunger: 70, mood: 70, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() },
    { id: 'pet_d', shopId: 'p_huhu_office', petId: 'huhu-carrot-office', name: '办公胡胡', type: '胡胡·办公', icon: 'deskpet:huhu-carrot-office', hunger: 85, mood: 85, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() }
  ];
  const ts = new Date().toISOString();
  const state = {
    version: '1.0', coins: 9999,
    stats: { totalEarned: 9999, totalSpent: 0, totalClaims: 0, monthlyEarned: 0, monthlySpent: 0 },
    tasks: { diet: { records: [], claimDates: [] }, exercise: { records: [], claimDates: [] }, accounting: { records: [], claimDates: [] }, vocabulary: { words: [], todayWords: [], todayWordsDate: null, claimDates: [] }, amazon: { notes: [], todayVideoIdx: 0, todayVideoDate: null, claimDates: [] }, xiaohongshu: { projects: [], claimDates: [] } },
    pets, inventory: [], cabin: { placed: new Array(24).fill(null), theme: 'default' },
    achievements: [], reports: { daily: [], weekly: [], monthly: [] },
    checkinHistory: [{ date: ts.slice(0, 10), timestamp: ts, taskKey: 'diet', taskName: '饮食记录', coins: 5 }],
    settings: { dailyReset: true, notifications: true, petRemind: true },
    lastActiveDate: ts.slice(0, 10), createdAt: ts,
  };
  localStorage.setItem('goldminer_workbench_data', JSON.stringify(state));
})()`;

async function main() {
  const info = await bootShell();
  const ws = new WebSocket(info.wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });

  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });

  const cmd = (method, params = {}) => send(method, params, sessionId);
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: seedScript });
  await cmd('Page.navigate', { url: PAGE_URL });
  await sleep(3500);

  const evalJs = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || 'eval error' };
    return r.result.result.value;
  };

  const boot = await evalJs(`({
    hasPM: !!window.PetManager,
    playerCount: window.PetManager ? Object.keys(PetManager.players).length : -1,
    navOk: typeof navTo === 'function',
    bootErrors: window.__bootErrors || null
  })`);

  await evalJs(`navTo('pet-yard')`);
  await sleep(2500);

  const yard = await evalJs(`(() => {
    const stages = Array.from(document.querySelectorAll('.pet-stage[data-petid]'));
    const players = window.PetManager ? Object.keys(PetManager.players).length : -1;
    const petInfo = stages.map(s => {
      const img = s.querySelector('img');
      const bg = s.querySelector('div[style*="background-image"]');
      return {
        petId: s.getAttribute('data-petid'),
        w: s.clientWidth, h: s.clientHeight,
        imgNaturalW: img ? img.naturalWidth : null,
        imgLoaded: img ? img.complete : null,
        imgSrc: img ? img.getAttribute('src') : null,
        bgSize: bg ? bg.style.backgroundSize : null,
        bgPos: bg ? bg.style.backgroundPosition : null,
      };
    });
    return { stages: stages.length, players, petInfo, cards: document.querySelectorAll('.pet-card').length };
  })()`);

  const shot1 = path.join(OUT, 'pet-yard.png');
  const shot = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot1, Buffer.from(shot.result.data, 'base64'));

  // transient: feed -> done, must fall back to base after finishing
  await evalJs(`(() => { const pet = getState().pets[0]; PetManager.playTransient(pet, 'done', true); return true; })()`);
  await sleep(700);
  const transient = await evalJs(`(() => {
    const p = PetManager.players['huhu-carrot'];
    return { track: p ? p.currentTrack : null, timers: p ? { t: !!p.timer, chain: !!p.chainTimer, bump: !!p.bumpTimer } : null };
  })()`);
  await sleep(2200);
  const afterTransient = await evalJs(`(() => {
    const p = PetManager.players['huhu-carrot'];
    return { track: p ? p.currentTrack : null, players: Object.keys(PetManager.players).length };
  })()`);

  // page-switch leak check
  await evalJs(`navTo('mine')`);
  await sleep(1200);
  const awayCount = await evalJs(`Object.keys(PetManager.players).length`);
  await evalJs(`navTo('pet-yard')`);
  await sleep(1500);
  const backCount = await evalJs(`Object.keys(PetManager.players).length`);

  // check-in chain on claimTaskCoins path
  await evalJs(`navTo('tasks')`);
  await sleep(1000);
  const shot2 = path.join(OUT, 'tasks.png');
  const shotB = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot2, Buffer.from(shotB.result.data, 'base64'));

  // shop thumbnails
  await evalJs(`navTo('shop')`);
  await sleep(1200);
  const shop = await evalJs(`(() => {
    const thumbs = Array.from(document.querySelectorAll('.si-image')).map(el => {
      const img = el.querySelector('img'); const bg = el.querySelector('div[style*="background-image"]');
      return { img: img ? img.naturalWidth : null, bg: bg ? bg.style.backgroundSize : null };
    });
    return { thumbs };
  })()`);
  const shot3 = path.join(OUT, 'shop.png');
  const shotC = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot3, Buffer.from(shotC.result.data, 'base64'));

  // old-save migration: p_bobo without petId/icon-as-deskpet
  const migrate = await evalJs(`(() => {
    const pets = getState().pets.slice();
    const oldLike = { id: 'pet_old', shopId: 'p_bobo', name: '老卜卜', type: '胡胡', icon: 'images/bobo.png', hunger: 60, mood: 60, health: 90, level: 1, exp: 0 };
    const got = normalizePet(oldLike);
    return { got, unchanged: pets.length };
  })()`);

  await send('Browser.close');
  ws.close();
  try { info.child.kill(); } catch {}

  const report = { boot, yard, transient, afterTransient, awayCount, backCount, shop, migrate, shots: [shot1, shot2, shot3], outDir: OUT };
  const reportPath = 'D:\\桌宠\\tests\\report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('REPORT_PATH ' + reportPath);
  console.log('OUT_DIR ' + OUT);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
