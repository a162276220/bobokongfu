/* 组装 dist —— 把工作台与桌宠运行时资源打成可发布的静态包。
   只搬运行时真正会用到的资源：PET_SPECS 里声明的图集与散图帧。
   每只宠物目录下的 preview（contact-sheet/gif/atlas，合计约 123MB）是开发产物，一律不进包。
   运行： node goldminer-hut/tools/build-dist.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const APP = path.join(REPO, '淘金矿工小屋');
const PET = path.join(REPO, 'pet');
const SITE = path.join(REPO, 'goldminer-hut');
const DIST = path.join(SITE, 'dist');

function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/* PET_SPECS 内联在 deskpet-players.js 里，用最小宿主把它取出来 */
function loadSpecs() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  ctx.location = { protocol: 'file:' };
  vm.runInContext(fs.readFileSync(path.join(APP, 'deskpet-players.js'), 'utf8'), ctx, {
    filename: 'deskpet-players.js',
  });
  return ctx.PetManager.specs;
}

function neededPetFiles(specs) {
  const files = new Set();
  Object.values(specs).forEach((spec) => {
    if (spec.kind === 'frames2d') {
      // 播放器取的是 <dir>/<track>/<frame>，轨道名即子目录名
      Object.entries(spec.frames2d.tracks).forEach(([track, def]) => {
        def.frames.forEach((f) => files.add(`${spec.frames2d.dir}/${track}/${f}`));
      });
      return;
    }
    files.add(spec.sheet.file);
  });
  return [...files].sort();
}

const specs = loadSpecs();
const wanted = neededPetFiles(specs);
console.log(`PET_SPECS: ${Object.keys(specs).length} 只，需要 ${wanted.length} 个资源文件`);

freshDir(DIST);

let bytes = 0;
let copied = 0;
const missing = [];
for (const rel of wanted) {
  const src = path.join(PET, rel);
  if (!fs.existsSync(src)) {
    missing.push(rel);
    continue;
  }
  const dst = path.join(DIST, 'pet', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  bytes += fs.statSync(src).size;
  copied += 1;
}

for (const name of ['deskpet-players.js', 'wuxia-content.js', 'jianghu.js', '淘金矿工小屋·自律工作台.html']) {
  const dst = path.join(DIST, name === '淘金矿工小屋·自律工作台.html' ? 'index.html' : name);
  fs.copyFileSync(path.join(APP, name), dst);
  bytes += fs.statSync(dst).size;
  copied += 1;
}

/* 前端同步层是构建期补丁，不是源文件的一部分：源文件还有另一个写者（phase 系列）会整份重写它，
   直接改会被抹掉（已发生两次）。所以补丁打在 dist 上，源文件保持原样。
   漏打必须失败退出 —— 否则会发一个「看着正常、其实没有云同步」的站点。 */
{
  const { applyPatches } = await import('./patch-sync.mjs');
  const idx = path.join(DIST, 'index.html');
  const before = fs.readFileSync(idx, 'utf8');
  const { text, report, failed } = applyPatches(before, { cloudOrigin: process.env.CLOUD_ORIGIN });
  if (failed) {
    console.error('同步层补丁没打全：\n  ' + report.filter((r) => /^(MISS|AMBIG)/.test(r)).join('\n  '));
    process.exit(1);
  }
  fs.writeFileSync(idx, text, 'utf8');
  bytes += Buffer.byteLength(text) - Buffer.byteLength(before);
  console.log('同步层补丁：全部生效（' + before.length + ' → ' + text.length + ' 字符）');
}

const total = fs.readdirSync(DIST, { recursive: true }).filter((f) =>
  fs.statSync(path.join(DIST, f)).isFile()).length;
console.log(`dist: ${copied} 个源文件写出，共 ${total} 个文件，${(bytes / 1048576).toFixed(1)} MiB`);
if (missing.length) {
  console.error(`缺失 ${missing.length} 个资源：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}