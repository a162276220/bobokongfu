"""One page that puts every pet's states side by side, in a matrix.

The shipped ``pet/<id>/`` directory is the artifact, so this page reads those --
not the recipes -- through the same reader ``qa_check`` uses (``load_grid``): a
pet that draws its own atlas, a pet whose atlas is supplied and a frames2d pet
all arrive as rows of 192x208 RGBA frames. Same state in the same table row, one
column per pet, so the one question the page exists for -- which pet's version of
a state barely moves? -- can be answered by looking across a row.

Nothing is redrawn. Each state is embedded as a single horizontal strip of the
very frames that ship, losslessly (lossless WebP, chosen over PNG because it is
28% smaller here; the round trip is asserted for exactness), and the player steps
through the strip with a transform, so the page carries one image per state
instead of one per frame.

Two numbers sit under each cell, both computed from those same pixels:

- 变化像素  share of cell pixels that change at all across the state, each channel
            premultiplied by alpha and compared against ``CHANGE_THRESHOLD``.
- 起伏      how far the silhouette's lowest drawn row travels, in pixels.

They are the quantitative half of "哪只不好看": a state whose 变化像素 is near
zero is a still image, whatever the animation claims to do.

That number also drives the two things the page does about it: a cell under
``WEAK_SHARE`` is zoomed and boxed in the matrix so it is the first thing the eye
lands on, and it appears in a "这只该加动作" list where every entry is a button
that jumps to the cell it names.
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from transforms import CANVAS_H, CANVAS_W

import qa_check

from . import emit
from . import spec as S

# Premultiplied channel delta that counts as "this pixel moved". Low enough to
# catch a two-pixel breath, high enough to ignore antialiasing shimmer.
CHANGE_THRESHOLD = 16
# A state where less than a quarter of the cell's pixels change at all is a state
# that barely animates: those cells are zoomed and boxed in the matrix, and named
# in the "这只该加动作" list. An absolute line, not a per-pet one, so the same
# number means the same thing in every column.
WEAK_SHARE = 0.25
# A manifest that declares no timing for a state plays at the engine's own
# default cell length.
DEFAULT_CELL_MS = 200
# The engine's canonical nine, which is the order the matrix wants its rows in.
CANONICAL_ROWS = list(S.ROW_NAMES)
CSS = (
    '.matrix{border-collapse:separate;border-spacing:6px;margin-top:6px}\n'
    '.matrix th,.matrix td{background:#2c2f36;border-radius:6px;padding:6px 8px;'
    'vertical-align:middle;text-align:left}\n'
    '.matrix thead th{position:sticky;top:0;z-index:2}\n'
    '.matrix tbody th{position:sticky;left:0;z-index:1;min-width:104px}\n'
    '.matrix th[scope=row] b{font-size:14px}\n'
    '.matrix th[scope=row] span{display:block;color:#8d93a1;font-size:11px;margin-top:2px}\n'
    '.matrix .pet span{display:block;color:#8d93a1;font-size:11px;margin-top:2px}\n'
    '.mcell{width:%dpx}\n'
    '.mcell.empty{color:#5c6270;text-align:center;font-size:18px;width:%dpx}\n'
    '.mcell .stage{margin:0 auto}\n'
    '.mcell .stage img{width:auto;height:%dpx;max-width:none}\n'
    '.mcell .stage:before,.mcell .stage:after{content:"";position:absolute;background:#5b6ee0;'
    'opacity:0;pointer-events:none}\n'
    '.mcell .stage:before{left:0;right:0;top:199px;height:1px}\n'
    '.mcell .stage:after{top:0;bottom:0;left:96px;width:1px}\n'
    '.matrix.guides .stage:before,.matrix.guides .stage:after{opacity:.75}\n'
    '.badges{margin-top:5px;font-size:11px;color:#cfd3dc;line-height:1.5}\n'
    '.badges em{color:#8d93a1;font-style:normal}\n'
    '.pos{color:#8d93a1;font-size:11px;margin-top:2px}\n'
    '.still{display:inline-block;margin-top:3px;padding:1px 6px;border-radius:9px;'
    'background:#5b3a3a;color:#ffd9d9;font-size:11px}\n'
    '.rank{margin:8px 0 0;padding-left:20px;font-size:12px;line-height:1.9;color:#cfd3dc}\n'
    '.rank i{display:inline-block;height:8px;background:#5b6ee0;border-radius:4px;'
    'vertical-align:middle;margin-right:6px}\n'
    '.rank u{color:#8d93a1;text-decoration:none}\n'
    '.rank .worst{color:#ffd9d9}\n'
    '.ctl2{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px;'
    'font-size:12px;color:#cfd3dc}\n'
    '.ctl2 button{background:#3a3f4a;border:0;color:#eee;border-radius:4px;padding:3px 10px;'
    'cursor:pointer;font:inherit;font-size:12px}\n'
    '.ctl2 button:hover{background:#4a5160}\n'
    '.ctl2 label{display:flex;gap:6px;align-items:center}\n'
    '.mcell.weak{position:relative;z-index:4;transform:scale(1.14);transform-origin:center center;'
    'box-shadow:0 0 0 2px #e0a35b,0 0 16px rgba(224,163,91,.5)}\n'
    '.mcell.weak .badges{color:#ffe0b0}\n'
    '.mcell.flash{animation:mflash 1.1s ease-out 2}\n'
    '@keyframes mflash{0%%,100%%{outline:3px solid rgba(91,110,224,0)}'
    '50%%{outline:3px solid #5b6ee0}}\n'
    '.weak-tag{display:inline-block;margin-top:3px;padding:1px 6px;border-radius:9px;'
    'background:#5b4425;color:#ffe0b0;font-size:11px}\n'
    '.advice{margin:6px 0 0;padding:0;list-style:none;font-size:12px;color:#cfd3dc}\n'
    '.advice li{margin:0 0 10px;line-height:1.9}\n'
    '.advice b{color:#fff}\n'
    '.advice .sub{margin-left:6px}\n'
    '.advice button{background:#3a3f4a;border:0;color:#eee;border-radius:4px;padding:2px 8px;'
    'margin:0 6px 6px 0;cursor:pointer;font:inherit;font-size:12px}\n'
    '.advice button:hover{background:#5b6ee0}\n'
    '.advice .ok{color:#9ad3a0}'
)

PAGE_JS = """
(function () {
  const CELL_W = %d;
  const cells = Array.from(document.querySelectorAll('.mcell[data-state]'));
  const players = cells.map(function (cell) {
    const player = {
      cell: cell,
      strip: cell.querySelector('.strip'),
      n: Number(cell.dataset.frames),
      ms: cell.dataset.ms.split(',').map(Number),
      pos: cell.querySelector('.pos'),
      playing: true,
      index: 0,
      timer: null
    };
    function show(i) {
      player.index = i;
      player.strip.style.transform = 'translateX(' + (-i * CELL_W) + 'px)';
      if (player.pos) player.pos.textContent = '第 ' + (i + 1) + '/' + player.n + ' 帧 · ' +
        player.ms[i] + ' ms';
    }
    function tick() {
      clearTimeout(player.timer);
      if (!player.playing) return;
      player.timer = setTimeout(function () {
        show((player.index + 1) %% player.n);
        tick();
      }, player.ms[player.index]);
    }
    player.show = show;
    player.stop = function () {
      player.playing = false;
      clearTimeout(player.timer);
    };
    player.play = function () {
      if (player.playing) return;
      player.playing = true;
      tick();
    };
    show(0);
    tick();
    return player;
  });

  const playButton = document.getElementById('play');
  function setPlaying(on) {
    players.forEach(function (p) { on ? p.play() : p.stop(); });
    playButton.textContent = on ? '暂停' : '播放';
  }
  playButton.addEventListener('click', function () {
    setPlaying(players.some(function (p) { return !p.playing; }));
  });

  // The progress slider scrubs every cell to the same relative position, which
  // is the only way to compare a 4-frame state against an 8-frame one.
  const progress = document.getElementById('progress');
  progress.addEventListener('input', function () {
    if (players.some(function (p) { return p.playing; })) setPlaying(false);
    const share = Number(progress.value) / 100;
    players.forEach(function (p) {
      p.show(Math.round(share * (p.n - 1)));
    });
  });

  document.getElementById('guides').addEventListener('change', function (event) {
    document.querySelector('.matrix').classList.toggle('guides', event.target.checked);
  });

  // Every "该加动作" button jumps to the cell it is talking about and flashes it:
  // the list is a work list, not a second set of numbers, so it has to land you
  // on the pixels themselves.
  document.querySelectorAll('.advice button').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const cell = document.querySelector(
        '.mcell[data-pet="' + chip.dataset.pet + '"][data-state="' + chip.dataset.state + '"]');
      if (!cell) return;
      cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
      cell.classList.remove('flash');
      void cell.offsetWidth;
      cell.classList.add('flash');
      setTimeout(function () { cell.classList.remove('flash'); }, 2400);
    });
  });
})();
"""


class State:
    """One pet's one state: the frames it ships, its timing, and how much it moves."""

    def __init__(self, name, frames, ms, kind, share, lift):
        self.name = name
        self.frames = frames
        self.ms = ms
        self.kind = kind
        self.share = share
        self.lift = lift


class Pet:
    def __init__(self, pet_dir, doc, grid):
        self.dir = pet_dir
        self.id = doc.get('id') or pet_dir.name
        self.display_name = doc.get('displayName') or self.id
        self.kind = grid.kind
        # Held, not just read: load_grid hands back views into the atlas array, so
        # letting the grid go would leave every sprite2d frame pointing at freed
        # memory -- which reads as zeros, i.e. as "this state never moves".
        self.grid = grid
        self.states = {}
        tracks = _tracks(doc)
        for row in grid.rows:
            if not row.frames:
                continue
            ms = emit.row_durations(tracks.get(row.name), row.name, len(row.frames),
                                    DEFAULT_CELL_MS)
            share, lift = measure(row.frames)
            self.states[row.name] = State(row.name, row.frames, ms, row.kind, share, lift)

    @property
    def frames(self):
        return sum(len(state.frames) for state in self.states.values())


def _tracks(doc):
    block = doc.get('frames2d')
    if isinstance(block, dict) and isinstance(block.get('tracks'), dict):
        return block['tracks']
    return doc.get('tracks') if isinstance(doc.get('tracks'), dict) else {}


def premultiplied(array):
    """RGB with alpha folded in, which is the only honest way to compare RGBA
    pixels: a pixel that is invisible carries no colour, and webp does not even
    store it (it comes back as whatever fits the alpha plane best), so any
    comparison has to be premultiplied to mean anything.
    """
    array = np.asarray(array, dtype=np.float32)
    # Ellipsis, not two colons: these arrays are (..., height, width, channels),
    # so a fixed pair of colons would slice the width axis instead of the channels.
    return array[..., :3] * (array[..., 3:4] / 255.0)


def measure(frames):
    """(share of pixels that change, travel of the lowest drawn row) for a state.

    Channels are premultiplied by alpha before comparing, so a pixel fading in or
    out is one change rather than a colour change plus an alpha change.
    """
    stack = np.stack([np.asarray(frame, dtype=np.uint8) for frame in frames])
    delta = premultiplied(stack).max(axis=0) - premultiplied(stack).min(axis=0)
    share = float((delta.max(axis=2) > CHANGE_THRESHOLD).mean())
    bottoms = [box[1] for box in (qa_check._bbox(frame) for frame in frames) if box]
    lift = int(max(bottoms) - min(bottoms)) if bottoms else 0
    return share, lift


def read_pets(pet_dirs=None):
    """Every shipped pet that has a manifest, as matrix columns."""
    if pet_dirs is None:
        pet_dirs = sorted(path.parent for path in sorted(S.PET_DIR.glob('*/pet.json')))
    pets = []
    for pet_dir in pet_dirs:
        pet_dir = Path(pet_dir)
        manifest = pet_dir / 'pet.json'
        if not manifest.is_file():
            raise S.SpecError('no pet.json in ' + str(pet_dir))
        doc = json.loads(manifest.read_text(encoding='utf-8'))
        pets.append(Pet(pet_dir, doc, qa_check.load_grid(pet_dir)))
    return pets


def state_order(pets):
    """Row order: the canonical nine first, then whatever else the pets declare."""
    seen = []
    for pet in pets:
        for name in pet.states:
            if name not in seen:
                seen.append(name)
    extra = sorted(name for name in seen if name not in CANONICAL_ROWS)
    return [name for name in CANONICAL_ROWS if name in seen] + extra


def strip_array(frames):
    """One state as one horizontal strip of RGBA.

    RGB under a fully transparent pixel is zeroed: it carries no visible
    information, and lossless WebP will not give it back unchanged, so the
    comparison the tests make is on ``premultiplied`` pixels -- which is exactly
    the same thing as "every visible pixel identical".
    """
    array = np.zeros((CANVAS_H, CANVAS_W * len(frames), 4), dtype=np.uint8)
    for index, frame in enumerate(frames):
        array[:, index * CANVAS_W:(index + 1) * CANVAS_W] = np.asarray(frame, dtype=np.uint8)
    array[array[:, :, 3] == 0, :3] = 0
    return array


def _strip_uri(frames):
    """The strip as a data URI. Lossless WebP: a third smaller than the same
    strip as PNG, and verified in the tests to decode back to the same
    premultiplied pixels -- i.e. every pixel you can actually see is identical.

    ``method=4``, and no ``quality``: with ``lossless`` set, libwebp spends ten
    times as long for a couple of percent of size, which is not a trade this page
    wants.
    """
    buffer = BytesIO()
    Image.fromarray(strip_array(frames)).save(
        buffer, format='WEBP', lossless=True, method=4)
    return 'data:image/webp;base64,' + base64.b64encode(buffer.getvalue()).decode()


def _cell(pet, state, stillest, weak):
    if state is None:
        return '<td class="mcell empty">—</td>'
    tags = '<span class="weak-tag">动作太小</span>' if weak else ''
    if stillest:
        tags += '<span class="still">本行最静</span>'
    return (
        '<td class="mcell%s" data-pet="%s" data-state="%s" data-frames="%d" data-ms="%s">\n'
        '  <div class="stage"><img class="strip" alt="" src="%s"></div>\n'
        '  <div class="badges">%d 帧 · %.2f s · %s<br>'
        '<em>变化 %.1f%% · 起伏 %d px</em></div>\n'
        '  <div class="pos"></div>%s\n'
        '</td>'
        % (' weak' if weak else '', pet.id, state.name, len(state.frames),
           ','.join(str(v) for v in state.ms), _strip_uri(state.frames),
           len(state.frames), sum(state.ms) / 1000.0,
           emit.KIND_LABELS.get(state.kind, state.kind), state.share * 100.0,
           state.lift, tags))


def weak_states(pet):
    """This pet's states whose motion is under ``WEAK_SHARE``, weakest first."""
    return sorted((state for state in pet.states.values() if state.share < WEAK_SHARE),
                  key=lambda state: (state.share, state.name))


def _advice(pets):
    """"这只该加动作": one line per pet, its weak states as buttons that jump to
    the cell. Pets with the most weak states come first, so the list reads as a
    work list; a pet that clears the line says so instead of showing an empty row.
    """
    ranked = sorted(pets, key=lambda pet: (-len(weak_states(pet)), mean_share(pet), pet.id))
    items = []
    for pet in ranked:
        weak = weak_states(pet)
        if not weak:
            items.append(
                '<li class="ok"><b>%s</b><span class="sub">%s · 没有低于 %d%% 的状态</span></li>'
                % (pet.display_name, pet.id, round(WEAK_SHARE * 100)))
            continue
        chips = ''.join(
            '<button data-pet="%s" data-state="%s">%s %.1f%%</button>'
            % (pet.id, state.name, state.name, state.share * 100.0) for state in weak)
        items.append(
            '<li><b>%s</b><span class="sub">%s · 该给这 %d 个状态加动作，点一下跳到那一格</span>'
            '<div class="chips">%s</div></li>'
            % (pet.display_name, pet.id, len(weak), chips))
    return '\n'.join(items)


def canonical_states(pet):
    """The rows the ranking may count: the nine the engine defines, and only the
    ones this pet actually has, so a pet with four of them is compared on its
    four rather than punished for the five it never drew.
    """
    return [pet.states[name] for name in CANONICAL_ROWS if name in pet.states]


def mean_share(pet):
    canonical = canonical_states(pet)
    return sum(state.share for state in canonical) / len(canonical) if canonical else 0.0


def stillest_pets(pets, order):
    """How many state rows each pet is the stillest in -- the tally that answers
    "哪只最不好看" without reading a single number."""
    tally = {pet.id: 0 for pet in pets}
    for name in order:
        present = [(pet, pet.states[name]) for pet in pets if name in pet.states]
        if not present:
            continue
        low = min(state.share for _, state in present)
        for pet, state in present:
            if state.share <= low + 1e-12:
                tally[pet.id] += 1
    return tally


def _summary(pets, order):
    """The ranked list of mean motion: 只算九态里它有的那些，所以三只宠物可比。"""
    tally = stillest_pets(pets, order)
    scored = []
    for pet in pets:
        canonical = canonical_states(pet)
        if not canonical:
            continue
        scored.append((mean_share(pet), max(state.lift for state in canonical), pet,
                       len(canonical)))
    scored.sort(key=lambda row: -row[0])
    items = []
    for index, (share, lift, pet, count) in enumerate(scored):
        worst = ' worst' if index == len(scored) - 1 and len(scored) > 1 else ''
        items.append(
            '<li class="%s">%s <i style="width:%.0fpx"></i> <b>%.1f%%</b> '
            '<u>%d 态 · 最大起伏 %d px · 本行最静 %d 行 · %s</u></li>'
            % ('rank' + worst, pet.display_name, min(120.0, share * 700.0), share * 100.0,
               count, lift, tally[pet.id], pet.id))
    return '\n'.join(items)


def build_page(pets):
    """The whole matrix as one self-contained page."""
    order = state_order(pets)
    header = ''.join(
        '<th class="pet">%s<span>%s · %s · %d 态 / %d 帧</span></th>'
        % (pet.display_name, pet.id, pet.kind, len(pet.states), pet.frames)
        for pet in pets)
    body = []
    for name in order:
        present = [pet.states.get(name) for pet in pets]
        low = min(state.share for state in present if state is not None)
        row_cells = [_cell(pet, state,
                           state is not None and state.share <= low + 1e-12,
                           state is not None and state.share < WEAK_SHARE)
                     for pet, state in zip(pets, present)]
        where = '九态之一' if name in CANONICAL_ROWS else '这一行只有部分宠物有'
        body.append('<tr>\n  <th scope="row"><b>%s</b><span>%s</span></th>\n%s\n</tr>'
                    % (name, where, '\n'.join(row_cells)))
    total_frames = sum(pet.frames for pet in pets)
    weak_total = sum(len(weak_states(pet)) for pet in pets)
    return (
        '<!doctype html><html><head><meta charset="utf-8">\n<title>%d 只宠物 · 状态对照总览</title>'
        % len(pets) +
        '<style>\n' + emit.PAGE_CSS + '\n' + (CSS % (CANVAS_W + 16, CANVAS_W + 16, CANVAS_H)) +
        '\n</style></head><body>\n'
        '<h1>状态对照总览 — %d 只宠物 · %d 个状态 · %d 帧</h1>\n'
        '<p class="sub">同一状态同一行，一列一只宠物，各自按自己那一帧的时长播放。'
        '「同步进度」把所有格子拖到同一个相对位置，用来比一个 4 帧的状态和 8 帧的状态；'
        '「显示基线」是每格的画布基线 y=199 与水平中心 x=96。底下两个数是同一批像素算出来的：'
        '<b>变化像素</b> = 整行里任一通道（按透明度预乘）变化超过 %d 的像素占比，'
        '<b>起伏</b> = 轮廓最低一行在整行里上下移动的像素数；数字越小越接近一张静图。'
        '变化像素低于 %d%% 的格子会自动放大并框成橙色，也就是下面「该加动作」清单里的那些。</p>\n'
        '<div class="panel">\n  <h2>动作幅度排行 · 只算九态里它有的那些</h2>\n'
        '  <ol class="rank">\n%s\n  </ol>\n'
        '  <div class="ctl2"><button id="play">暂停</button>\n'
        '    <label>同步进度 <input id="progress" type="range" min="0" max="100" value="0"></label>\n'
        '    <label><input id="guides" type="checkbox"> 显示基线与中心线</label>\n'
        '    <span class="sub" style="margin:0">图片全部内联，共 %d 帧，无外链</span></div>\n'
        '</div>\n'
        '<div class="panel">\n  <h2>这只该加动作 · %d 个状态的变化像素低于 %d%%</h2>\n'
        '  <ul class="advice">\n%s\n  </ul>\n</div>\n'
        '<table class="matrix">\n<thead><tr><th>状态</th>%s</tr></thead>\n<tbody>\n%s\n</tbody>\n'
        '</table>\n<script>' % (len(pets), len(order), total_frames, CHANGE_THRESHOLD,
                               round(WEAK_SHARE * 100), _summary(pets, order), total_frames,
                               weak_total, round(WEAK_SHARE * 100), _advice(pets),
                               header, '\n'.join(body))
        + (PAGE_JS % CANVAS_W) + '</script>\n</body></html>')


def write_gallery(pet_dirs=None, out=None):
    """Write the overview page; ``pet_dirs`` defaults to every pet in ``pet/``."""
    pets = read_pets(pet_dirs)
    if not pets:
        raise S.SpecError('no pet directories to compare')
    path = Path(out) if out is not None else S.ROOT / 'preview' / 'gallery.html'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_page(pets), encoding='utf-8')
    return {'path': path, 'pets': [pet.id for pet in pets],
            'states': len(state_order(pets)), 'bytes': path.stat().st_size}
