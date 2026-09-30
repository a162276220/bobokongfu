// Static contract verification — no browser needed, only file reads.
// Asserts the asset contract that deskpet-players.js + the HTML depend on.
import fs from 'node:fs';
import path from 'node:path';

const PET_BASE = 'D:\\桌宠\\pet';
const WB = 'D:\\桌宠\\淘金矿工小屋';

// PNG header decoding (IHDR) — enough to validate dimensions.
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 33) return { error: 'too short', bytes: buf.length };
  if (buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return { error: 'not png', magic: buf.toString('hex', 0, 8) };
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h, bytes: buf.length };
}

function webpSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 30) return { error: 'too short', bytes: buf.length };
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return { error: 'not webp' };
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    // canvas width/height are 1-based 24-bit
    const w = ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1);
    const h = ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1);
    return { w, h, kind: 'extended', bytes: buf.length };
  }
  if (fourcc === 'VP8L') {
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    const w = 1 + (((b1 & 0x3F) << 8) | b0);
    const h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
    return { w, h, kind: 'lossless', bytes: buf.length };
  }
  if (fourcc === 'VP8 ') {
    const w = buf.readUInt16LE(26) & 0x3FFF;
    const h = buf.readUInt16LE(28) & 0x3FFF;
    return { w, h, kind: 'simple', bytes: buf.length };
  }
  return { error: 'unknown webp variant: ' + fourcc };
}

const CELL_W = 192, CELL_H = 208;
const results = [];
const fail = (pet, msg) => results.push({ pet, ok: false, msg });
const pass = (pet, extra) => results.push({ pet, ok: true, ...extra });

// ---- 1. frames2d pet: huhu-carrot ----
{
  const dir = path.join(PET_BASE, 'huhu-carrot', 'frames');
  const expected = { idle: 16, waiting: 6, thinking: 6, tool: 8, review: 6, done: 4, failed: 4 };
  let ok = true;
  const detail = {};
  for (const [track, count] of Object.entries(expected)) {
    const files = [];
    for (let i = 0; i < count; i++) files.push(`f${String(i).padStart(2, '0')}.png`);
    const sizes = files.map((f) => {
      const p = path.join(dir, track, f);
      if (!fs.existsSync(p)) return { missing: p };
      return pngSize(p);
    });
    detail[track] = sizes;
    for (const s of sizes) {
      if (s.error || s.w !== CELL_W || s.h !== CELL_H) { ok = false; }
    }
  }
  if (ok) pass('huhu-carrot', { kind: 'frames2d', tracks: detail });
  else fail('huhu-carrot', { kind: 'frames2d', tracks: detail });
}

// ---- 2. sheet pets: dundun-office / huhu-carrot-office / raccoon-typing ----
{
  for (const pet of ['dundun-office', 'huhu-carrot-office', 'raccoon-typing']) {
    const pj = JSON.parse(fs.readFileSync(path.join(PET_BASE, pet, 'pet.json'), 'utf8'));
    const sheetFile = pj.spritesheetPath;
    if (!sheetFile) { fail(pet, 'no spritesheetPath in pet.json'); continue; }
    const sheetPath = path.join(PET_BASE, pet, sheetFile);
    if (!fs.existsSync(sheetPath)) { fail(pet, `sheet missing: ${sheetPath}`); continue; }
    const size = sheetFile.toLowerCase().endsWith('.webp') ? webpSize(sheetPath) : pngSize(sheetPath);
    if (size.error) { fail(pet, `sheet undecodable: ${JSON.stringify(size)}`); continue; }
    const cellW = pj.cell?.width ?? CELL_W;
    const cellH = pj.cell?.height ?? CELL_H;
    const cols = pj.columns ?? Math.floor(size.w / cellW);
    const rows = Math.floor(size.h / cellH);
    // rowNames order in pet.json (raccoon has the explicit list; dundun/huhu-office
    // list tracks in row order).
    const rowNames = pj.rowNames || Object.keys(pj.tracks || {});
    const framesPerRow = pj.frames || null;
    const coveredRows = framesPerRow ? framesPerRow.length : rows;
    pass(pet, { sheet: sheetFile, w: size.w, h: size.h, cols, rows, coveredRows, rowNames, framesPerRow, bytes: size.bytes });
  }
}

// ---- 3. code-level map alignment (PET_SPECS.map targets must be real rows) ----
{
  // The workbench calls semantic tracks; PET_SPECS.map translates them to the
  // sheet's real rows. Assert every map target exists in the pet's rowNames.
  const CODE_MAP = {
    'dundun-office': { idle: 'idle', waiting: 'waiting', thinking: 'running', tool: 'running', review: 'review', done: 'waving', failed: 'failed', cheer: 'jumping' },
    'huhu-carrot-office': { idle: 'idle', waiting: 'waiting', thinking: 'running', tool: 'running', review: 'review', done: 'waving', failed: 'failed', cheer: 'jumping' },
    'raccoon-typing': { idle: 'idle', waiting: 'waiting', thinking: 'running', tool: 'running', review: 'review', done: 'waving', failed: 'failed', cheer: 'jumping' },
  };
  const res = {};
  let ok = true;
  for (const [pet, codeMap] of Object.entries(CODE_MAP)) {
    const pj = JSON.parse(fs.readFileSync(path.join(PET_BASE, pet, 'pet.json'), 'utf8'));
    const rowNames = pj.rowNames || Object.keys(pj.tracks || {});
    const bad = Object.entries(codeMap).filter(([, row]) => !rowNames.includes(row)).map(([s]) => s);
    if (bad.length) ok = false;
    res[pet] = { rowNames, bad };
  }
  // frames2d pet: semantic tracks are literal directory names, verify on disk.
  {
    const dir = path.join(PET_BASE, 'huhu-carrot', 'frames');
    const rows = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());
    const need = ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'];
    const bad = need.filter((s) => !rows.includes(s));
    if (bad.length) ok = false;
    res['huhu-carrot'] = { rows, bad };
  }
  results.push({ pet: 'map-alignment', ok, res });
}

// ---- 4. HTML wiring assertions (string-level, no DOM) ----
{
  const html = fs.readFileSync(path.join(WB, '淘金矿工小屋·自律工作台.html'), 'utf8');
  const js = fs.readFileSync(path.join(WB, 'deskpet-players.js'), 'utf8');
  const checks = {
    'script included': html.includes('deskpet-players.js'),
    'mount call in init_pet-yard': html.includes("PetManager.mount(document.getElementById('mainContent')"),
    'shop thumb uses PetManager.thumb': html.includes('PetManager.thumb(item.petId, 56)'),
    'confirmAdoptPet writes petId': /state\.pets\.push\(\{[\s\S]{0,200}?petId: petItem\.petId/.test(html),
    'normalizePet defined': html.includes('function normalizePet('),
    'bobo migration icon': html.includes("icon === 'images/bobo.png'"),
    'claimTaskCoins chain': /PetManager\.playChain/.test(html),
    'interactPet transient': /PetManager\.playTransient/.test(html),
    '4 deskpets in shop': ['huhu-carrot', 'dundun-office', 'raccoon-typing', 'huhu-carrot-office']
      .every((id) => html.includes(`petId: '${id}'`)),
    'PET_BASE relative': js.includes("PET_BASE = '../pet/'"),
    'isConnected guard present': /isConnected\)\s*\{\s*self\.stopTimer/.test(js),
    'playTransient returns to base': /bumpTimer/.test(js),
    'scale in sheet bg-position': /self\.scale/.test(js),
  };
  results.push({ pet: 'wiring', ok: Object.values(checks).every(Boolean), checks });
}

console.log(JSON.stringify(results, null, 2));
const allOk = results.every((r) => r.ok);
console.log('VERDICT', allOk ? 'ALL-PASS' : 'HAS-FAILURES');
process.exitCode = allOk ? 0 : 1;
