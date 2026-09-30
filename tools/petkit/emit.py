"""Write every artifact a recipe produces: spec records, manifests, previews.

The byte-level details here are deliberate. JSON is written with two-space
indent plus a trailing newline, the same as every other spec file in the repo;
manifests keep the engine's field order; previews keep the exact Pillow call
parameters the hand-written builders used, because re-encoding with different
options changes the shipped bytes without changing the picture.

A rendered pet (``rows`` in the recipe) declares ``cell``, ``columns`` and
``frames`` in its manifest, because those are read back off its own atlas. A pet
whose atlas is supplied (``source: "sheet"``) declares none of them, so the
engine's defaults apply to a sheet this build never inspected.
"""

from __future__ import annotations

import base64
import json
import math
import shutil
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from transforms import CANVAS_H, CANVAS_W

from validate_pet import resolve_row_names, row_kind

from . import motion, render
from . import spec as S

MANIFEST_SCHEMA = 'https://schemas.linxin666.org/dsh-pet/pet-manifest-v2.schema.json'
VOICE_SCHEMA = 'https://schemas.linxin666.org/dsh-pet/voice-pack-v1.schema.json'
CHECKER_DARK = (168, 168, 168)
CHECKER_LIGHT = (235, 235, 235)
OVERVIEW_COLUMNS = 4
VOICE_KEYS = ('status', 'whispers', 'panel')
# A preview page is one self-contained file: every image is an inline data URI
# and the player is a few lines of plain JavaScript, so it works from the
# filesystem, inside the engine's preview pane, or mail-dropped to someone.
PAGE_CSS = (
    ':root{color-scheme:dark}\n'
    'body{font-family:system-ui;background:#22242a;color:#eee;margin:24px}\n'
    'h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:0 0 8px;color:#ddd}\n'
    'h3{font-size:13px;margin:0;color:#bbb}\n'
    '.sub{color:#8d93a1;font-size:12px;margin:0 0 18px;line-height:1.6}\n'
    '.hero{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}\n'
    'figure{margin:0} figure img{border-radius:6px;background:#2c2f36}\n'
    '.strip{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}\n'
    '.strip button{background:#2c2f36;border:1px solid #3a3f4a;border-radius:6px;padding:4px 6px;'
    'cursor:pointer;color:#cfd3dc;font:inherit;font-size:11px;text-align:center}\n'
    '.strip button:hover{border-color:#5b6ee0}\n'
    '.strip img{width:48px;height:52px;display:block;background:#ebebeb;border-radius:3px;margin-bottom:3px}\n'
    '.grid{display:flex;flex-wrap:wrap;gap:14px}\n'
    '.card{background:#2c2f36;border-radius:8px;padding:10px}\n'
    '.card header{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:6px}\n'
    '.meta,.framemeta{color:#8d93a1;font-size:11px}\n'
    '.stage{position:relative;width:192px;height:208px;background-color:#ebebeb;'
    'background-image:linear-gradient(45deg,#a8a8a8 25%,transparent 25%,transparent 75%,#a8a8a8 75%),'
    'linear-gradient(45deg,#a8a8a8 25%,transparent 25%,transparent 75%,#a8a8a8 75%);'
    'background-size:16px 16px;background-position:0 0,8px 8px;border-radius:4px;overflow:hidden}\n'
    '.stage img{position:absolute;left:0;top:0;width:192px;height:208px}\n'
    '.ctl{display:flex;gap:6px;align-items:center;margin:8px 0 6px;flex-wrap:wrap}\n'
    '.ctl button,.modes button{background:#3a3f4a;border:0;color:#eee;border-radius:4px;padding:3px 8px;'
    'cursor:pointer;font:inherit;font-size:12px}\n'
    '.ctl button:hover,.modes button:hover{background:#4a5160}\n'
    '.modes button.on{background:#5b6ee0}\n'
    'input[type=range]{width:110px}\n'
    '.thumbs{display:flex;gap:3px;flex-wrap:wrap;width:192px}\n'
    '.thumb{padding:0;border:1px solid transparent;background:none;border-radius:3px;cursor:pointer;line-height:0}\n'
    '.thumb img{width:22px;height:24px;background:#ebebeb;border-radius:2px}\n'
    '.thumb.on{border-color:#5b6ee0}\n'
    '.panel{background:#2c2f36;border-radius:8px;padding:12px;margin:0 0 18px}\n'
    '.ov{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start}\n'
    '.ovctl{display:flex;flex-direction:column;gap:10px;font-size:12px;color:#cfd3dc;min-width:290px}\n'
    '.ovctl label{display:flex;gap:8px;align-items:center;justify-content:space-between}\n'
    '.guide{position:absolute;background:#5b6ee0;opacity:.8;pointer-events:none}\n'
    '.guide.h{left:0;right:0;top:199px;height:1px}\n'
    '.guide.v{top:0;bottom:0;left:96px;width:1px}'
)

# Reads everything it needs off the DOM: each frame lives once, as a thumbnail,
# and the player, the state strip and the overlay all reuse those sources.
PAGE_JS = """
(function () {
  const cards = Array.from(document.querySelectorAll('.card'));
  const states = cards.map(function (card) {
    const thumbs = Array.from(card.querySelectorAll('.thumb'));
    const state = {
      name: card.dataset.state,
      loop: card.dataset.loop === '1',
      ms: card.dataset.ms.split(',').map(Number),
      thumbs: thumbs,
      srcs: thumbs.map(function (b) { return b.querySelector('img').src; }),
      frame: card.querySelector('.frame'),
      scrub: card.querySelector('.scrub'),
      meta: card.querySelector('.framemeta'),
      toggle: card.querySelector('[data-act="toggle"]'),
      index: 0,
      playing: true,
      timer: null
    };
    function show(i) {
      state.index = i;
      state.frame.src = state.srcs[i];
      state.scrub.value = i;
      state.meta.textContent = '第 ' + (i + 1) + '/' + state.srcs.length + ' 帧 · ' + state.ms[i] + ' ms';
      state.thumbs.forEach(function (b, n) { b.classList.toggle('on', n === i); });
    }
    function stop() {
      state.playing = false;
      clearTimeout(state.timer);
      state.toggle.textContent = '播放';
    }
    function play() {
      if (state.playing) return;
      state.playing = true;
      state.toggle.textContent = '暂停';
      if (!state.loop && state.index >= state.srcs.length - 1) show(0);
      tick();
    }
    function tick() {
      clearTimeout(state.timer);
      if (!state.playing) return;
      state.timer = setTimeout(function () {
        const next = state.index + 1;
        if (next >= state.srcs.length) {
          if (!state.loop) { stop(); return; }
          show(0);
        } else {
          show(next);
        }
        tick();
      }, state.ms[state.index]);
    }
    state.toggle.addEventListener('click', function () { state.playing ? stop() : play(); });
    card.querySelector('[data-act="prev"]').addEventListener('click', function () {
      stop();
      show((state.index + state.srcs.length - 1) % state.srcs.length);
    });
    card.querySelector('[data-act="next"]').addEventListener('click', function () {
      stop();
      show((state.index + 1) % state.srcs.length);
    });
    state.scrub.addEventListener('input', function () { stop(); show(Number(state.scrub.value)); });
    thumbs.forEach(function (b, n) { b.addEventListener('click', function () { stop(); show(n); }); });
    show(0);
    tick();
    return state;
  });

  // The strip reuses each state's first frame, so no image is embedded twice.
  Array.from(document.querySelectorAll('[data-jump]')).forEach(function (button) {
    button.querySelector('img').src = states[Number(button.dataset.jump)].srcs[0];
  });
  // A hero with no picture of its own -- a supplied atlas has no base image to
  // show -- borrows the first frame rather than inlining those pixels twice.
  Array.from(document.querySelectorAll('.hero figure img')).forEach(function (img) {
    if (!img.getAttribute('src')) img.src = states[0].srcs[0];
  });

  const overlay = document.getElementById('ovFrame');
  if (overlay) {
    const base = document.getElementById('ovBase');
    // The overlay's base is the raw base image the hero already embeds.
    const hero = document.querySelector('.hero figure img');
    if (hero) base.src = hero.src;
    const select = document.getElementById('ovState');
    const index = document.getElementById('ovIndex');
    const alpha = document.getElementById('ovAlpha');
    const meta = document.getElementById('ovMeta');
    select.innerHTML = states.map(function (s, i) {
      return '<option value="' + i + '">' + s.name + '</option>';
    }).join('');
    function sync() {
      const state = states[Number(select.value)];
      index.max = state.srcs.length - 1;
      const i = Math.min(Number(index.value), state.srcs.length - 1);
      index.value = i;
      overlay.src = state.srcs[i];
      const frameOnly = document.querySelector('[data-mode="frame"]').classList.contains('on');
      overlay.style.opacity = 1;
      base.style.opacity = frameOnly ? 0 : alpha.value / 100;
      meta.textContent = state.name + ' 第 ' + (i + 1) + '/' + state.srcs.length +
        ' 帧 · ' + state.ms[i] + ' ms · ' + (state.loop ? '循环' : '一次性');
    }
    [select, index, alpha].forEach(function (el) { el.addEventListener('input', sync); });
    Array.from(document.querySelectorAll('[data-mode]')).forEach(function (button) {
      button.addEventListener('click', function () {
        Array.from(document.querySelectorAll('[data-mode]')).forEach(function (b) {
          b.classList.toggle('on', b === button);
        });
        base.style.mixBlendMode = button.dataset.mode === 'difference' ? 'difference' : 'normal';
        sync();
      });
    });
    Array.from(document.querySelectorAll('[data-jump]')).forEach(function (button) {
      button.addEventListener('click', function () {
        select.value = button.dataset.jump;
        index.value = 0;
        sync();
        const card = document.querySelector('.card[data-state="' +
          states[Number(button.dataset.jump)].name + '"]');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    sync();
  }
})();
"""


MIME = {'.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}


def _file_uri(path):
    """An existing file as the data URI a preview page embeds, byte for byte, so
    the page has no siblings to go missing and nothing gets re-encoded."""
    uri = MIME.get(Path(path).suffix.lower(), 'application/octet-stream')
    return 'data:%s;base64,%s' % (uri, base64.b64encode(Path(path).read_bytes()).decode())


def _png_uri(image):
    """One frame as a data URI. Each frame is embedded exactly once -- the
    player, the thumbnail row and the overlay all read the same source."""
    buffer = BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


def _state_card(state):
    ms = state['ms']
    kind = state.get('kind') or ('loop' if state.get('loop') else 'once')
    thumbs = ''.join('<button class="thumb"><img src="%s" alt=""></button>' % _png_uri(im)
                     for im in state['images'])
    return (
        '<section class="card" data-state="%s" data-kind="%s" data-ms="%s" data-loop="%d">\n'
        '  <header><h3>%s</h3><span class="meta">%d 帧 · %s %.2f s</span></header>\n'
        '  <div class="stage"><img class="frame" alt=""></div>\n'
        '  <div class="ctl">'
        '<button data-act="prev" title="上一帧">◀</button>'
        '<button data-act="toggle">暂停</button>'
        '<button data-act="next" title="下一帧">▶</button>'
        '<input class="scrub" type="range" min="0" max="%d" value="0">'
        '<span class="framemeta"></span></div>\n'
        '  <div class="thumbs">%s</div>\n'
        '</section>'
        % (state['name'], kind, ','.join(str(v) for v in ms),
           1 if kind == 'loop' else 0, state['name'], len(ms),
           KIND_LABELS.get(kind, '循环'), sum(ms) / 1000.0, len(ms) - 1, thumbs))


def _overlay_panel(reference):
    """The reference-vs-frame panel. ``reference`` names what the overlay lays on
    top of a frame: a rendered pet's own base image, or -- for a pet whose atlas
    is supplied -- the canonical frame the hero figure borrows."""
    return (
        '<section class="panel">\n'
        '  <h2>叠图检查 · %s vs 帧</h2>\n'
        '  <p class="sub">参考线是画布基线 y=199 与水平中心 x=96。%s默认以 55%% 叠在帧上，'
        '切到「差值」能把错位放大成亮边；选中的帧就是下面对应卡片的那一帧。</p>\n'
        '  <div class="ov">\n'
        '    <div class="stage"><img id="ovFrame" alt=""><img id="ovBase" alt="">'
        '<span class="guide h"></span><span class="guide v"></span></div>\n'
        '    <div class="ovctl">\n'
        '      <label>状态 <select id="ovState"></select></label>\n'
        '      <label>帧 <input id="ovIndex" type="range" min="0" max="0" value="0"></label>\n'
        '      <label>%s透明度 <input id="ovAlpha" type="range" min="0" max="100" value="55"></label>\n'
        % (reference, reference, reference) +
        '      <div class="modes"><button data-mode="normal" class="on">叠加</button>'
        '<button data-mode="difference">差值</button>'
        '<button data-mode="frame">只看帧</button></div>\n'
        '      <div id="ovMeta" class="framemeta"></div>\n'
        '    </div>\n'
        '  </div>\n'
        '</section>')


def write_page(path, title, hero, states, reference='底图'):
    """One self-contained page per pet: a strip of states, a player per state
    (pause, step, scrub, per-frame timing) and the reference-vs-frame overlay
    check. The first hero figure is what the overlay lays on top of a frame:
    a rendered pet's base image, or the first frame of a supplied atlas.

    A hero whose URI is ``None`` has no picture of its own and borrows the first
    frame the page already embeds, so no image is ever inlined twice."""
    figures = '\n'.join(
        '  <figure><h3>%s</h3><img width="%d"%s></figure>'
        % (label, width, '' if uri is None else ' src="%s"' % uri)
        for label, uri, width in hero)
    strip = '\n'.join(
        '<button data-jump="%d"><img class="jump" alt=""><div>%s</div></button>'
        % (index, state['name']) for index, state in enumerate(states))
    cards = '\n'.join(_state_card(state) for state in states)
    html = """<!doctype html><html><head><meta charset="utf-8">
<title>%s</title><style>
%s
</style></head><body>
<h1>%s — %d 态预览</h1>
<p class="sub">每张卡片可以暂停、单步、拖动进度到任意帧，播放节奏用的是配方里那一帧自己的时长；
缩略图点一下就跳过去，一次性状态的播放到尾会停住。</p>
<div class="hero">
%s
</div>
<div class="strip">
%s
</div>
%s
<div class="grid">
%s
</div>
<script>%s</script>
</body></html>"""         % (title, PAGE_CSS, title, len(states), figures, strip,
                         _overlay_panel(reference), cards, PAGE_JS)
    path.write_text(html, encoding='utf-8')
    return path


def write_json(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def frames_spec(spec):
    """The frames2d spec record: what was written, with which timings."""
    doc = {}
    for name, track in S.output(spec, 'frames2d')['tracks'].items():
        count = motion.count_of(track, 'frameMs')
        doc[name] = {'frames': [render.frame_name(i) for i in range(count)],
                     'frameMs': S.timing(track, 'frameMs'),
                     'loop': track.get('loop', True),
                     'fallback': track.get('fallback')}
    return doc


def atlas_spec(block):
    """The sprite2d spec record, derived from the rows the recipe declares."""
    rows = motion.declared_rows(block)
    names = render.row_names(block)
    return {'columns': 8,
            'rows': len(names),
            'cell': {'width': CANVAS_W, 'height': CANVAS_H},
            'frames': [render.row_count(rows[name]) for name in names],
            'rowNames': names,
            'tracks': render.sheet_durations({name: rows[name] for name in names})}


def frames2d_manifest(spec, block):
    doc = frames_spec(spec)
    tracks = {}
    for name, entry in doc.items():
        item = {'frames': list(entry['frames']), 'frameMs': list(entry['frameMs']),
                'loop': bool(entry['loop'])}
        if entry['fallback'] is not None:
            item['fallback'] = entry['fallback']
        tracks[name] = item
    phases = block.get('phases') or {phase: phase for phase in S.PHASE_NAMES}
    manifest = {'$schema': MANIFEST_SCHEMA, 'petManifestVersion': 2,
                'id': block.get('petId', spec['id']),
                'displayName': spec['displayName'],
                'description': spec['description'],
                'version': spec['version'],
                'author': spec['author'],
                'license': spec['license'],
                'renderer': 'frames2d',
                'frames2d': {'dir': block.get('dir', 'frames'),
                             'defaultFrameMs': block.get('defaultFrameMs', 200),
                             'tracks': tracks, 'phases': phases}}
    if spec.get('remarks'):
        manifest['remarks'] = spec['remarks']
    return manifest


def flat_manifest(spec, block):
    """The v1-shaped manifest Codex and the DSH v1 read path both accept."""
    rows = None if block.get('rows') is None else motion.declared_rows(block)
    manifest = {'id': block.get('petId', spec['id']),
                'displayName': spec['displayName'],
                'description': spec['description']}
    if block.get('spriteVersionNumber') is not None:
        manifest['spriteVersionNumber'] = block['spriteVersionNumber']
    manifest['spritesheetPath'] = block['spritesheet']
    if rows is not None:
        names = render.row_names(block)
        manifest['cell'] = {'width': CANVAS_W, 'height': CANVAS_H}
        manifest['columns'] = 8
        manifest['frames'] = [render.row_count(rows[name]) for name in names]
    if block.get('rowNames'):
        manifest['rowNames'] = list(block['rowNames'])
    if rows is not None:
        names = render.row_names(block)
        manifest['tracks'] = render.sheet_durations({name: rows[name] for name in names})
    else:
        manifest['tracks'] = dict(block['tracks'])
    if block.get('sequences'):
        manifest['sequences'] = dict(block['sequences'])
    if spec.get('remarks'):
        manifest['remarks'] = spec['remarks']
    return manifest


def voice_doc(spec):
    voice = spec.get('voice')
    if not voice:
        return None
    doc = {'$schema': VOICE_SCHEMA, 'voicePackVersion': 1}
    for key in VOICE_KEYS:
        if voice.get(key) is not None:
            doc[key] = voice[key]
    return doc


def checkerboard(rgba, tile=12):
    canvas = Image.new('RGB', rgba.size, CHECKER_LIGHT)
    pixels = canvas.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            if ((x // tile) + (y // tile)) % 2 == 0:
                pixels[x, y] = CHECKER_DARK
    canvas.paste(rgba, (0, 0), rgba)
    return canvas


def _save_gif(path, frames, frame_ms):
    rgb = [frame.convert('RGB') for frame in frames]
    tail = list(frame_ms) + [frame_ms[-1]] * (len(rgb) - len(frame_ms))
    rgb[0].save(path, save_all=True, append_images=rgb[1:], duration=tail,
                loop=0, optimize=True)


def _after(block, names, one_shot):
    """Which rows/tracks get one idle frame appended to their preview GIF.

    A preview that stops dead on the last frame of a one-shot row is hard to
    compare against the loop, so it ends on idle instead. The default is every
    row that declares ``loop: false``; a recipe may name them outright when the
    row is one-shot in the engine's eyes but is still declared as a loop (墩墩's
    jumping/failed rows).
    """
    declared = block.get('after')
    if declared is None:
        return set(one_shot)
    unknown = [name for name in declared if name not in names]
    if unknown:
        raise S.SpecError('previews.after names rows that do not exist: ' + ', '.join(unknown))
    return set(declared)


# Rows a supplied atlas does not time: the engine's own default patterns
# (registry.js DEFAULT_TRACK_PATTERNS in @linxin666/dsh-pet 0.3.23), so a preview
# shows the rhythm the engine will actually play rather than a guess. The engine
# slices or pads these to the number of cells a row paints.
ENGINE_ROW_MS = {
    'idle': [500, 500, 600, 500, 500, 600],
    'running-right': [300, 300, 300, 300, 300, 300, 300, 400],
    'running-left': [300, 300, 300, 300, 300, 300, 300, 400],
    'waving': [450, 450, 450, 450],
    'jumping': [400, 400, 400, 450, 450],
    'failed': [550, 550, 550, 600, 650, 700, 550, 550],
    'waiting': [550, 550, 600, 550, 550, 600],
    'running': [330, 330, 330, 330, 330, 400],
    'review': [650, 650, 650, 650, 650, 650],
}
KIND_LABELS = {'loop': '循环', 'once': '一次性', 'set': '姿态集'}


def row_durations(entry, name, count, default_ms):
    """Per-frame milliseconds for one state, straight off its manifest entry: the
    durations it declares (``durations`` for an atlas row, ``frameMs`` for a
    frames2d track) when it has them, else the engine's default pattern for that
    row name, sliced or padded to the frames the state actually holds."""
    declared = (entry or {}).get('durations') or (entry or {}).get('frameMs')
    base = [int(v) for v in declared] if isinstance(declared, list) and declared else []
    if not base:
        base = list(ENGINE_ROW_MS.get(name) or [int(default_ms)])
    return [base[i % len(base)] for i in range(count)]


def _painted_columns(sheet, row, columns=8):
    """How many cells a row of a supplied atlas paints, counted from column zero
    -- the same scan the engine does for a pack that declares no frame counts."""
    array = np.asarray(sheet)
    top = row * CANVAS_H
    used = 0
    for column in range(columns):
        cell = array[top:top + CANVAS_H, column * CANVAS_W:(column + 1) * CANVAS_W]
        if bool((cell[:, :, 3] > 0).any()):
            used = column + 1
    return used


def _slice_atlas(sheet, row, count, columns=8):
    top = row * CANVAS_H
    return [sheet.crop((column * CANVAS_W, top,
                        (column + 1) * CANVAS_W, top + CANVAS_H))
            for column in range(min(count, columns))]


def _contact_sheet(cells, names):
    """The half-scale checkerboard grid every atlas-reading shelf publishes."""
    cell_w, cell_h = CANVAS_W // 2, CANVAS_H // 2
    contact = Image.new('RGBA', (8 * cell_w, len(names) * cell_h), CHECKER_LIGHT + (255,))
    pixels = contact.load()
    for y in range(contact.height):
        for x in range(contact.width):
            if ((x // 6) + (y // 6)) % 2 == 0:
                pixels[x, y] = CHECKER_DARK + (255,)
    for index, name in enumerate(names):
        for column, frame in enumerate(cells[name]):
            contact.alpha_composite(frame.resize((cell_w, cell_h), Image.Resampling.LANCZOS),
                                    (column * cell_w, index * cell_h))
    return contact


def _preview_names(spec, block):
    out = S.path_of(block, 'dir', 'preview')
    sprite = S.output(spec, 'sprite2d') or {}
    sprite_id = sprite.get('petId', spec['id'])
    return (out,
            out / block.get('static', spec['id'] + '-static.png'),
            out / block.get('overview', spec['displayName'] + '动作总览.png'),
            out / block.get('atlas', 'atlas-' + sprite_id + '.png'),
            out / block.get('transparent', spec['id'] + '-transparent-check.png'))


def classic_previews(spec, block, base, frames_dir, atlas_path):
    """胡胡's preview shelf: a 2x still, one GIF per track, an overview grid, a
    copy of the atlas, a checkerboard cut-out check and a page tying them
    together."""
    out, static, overview, atlas_copy, transparent = _preview_names(spec, block)
    out.mkdir(parents=True, exist_ok=True)
    base.resize((CANVAS_W * 2, CANVAS_H * 2), Image.Resampling.LANCZOS).save(static)
    doc = frames_spec(spec)
    idle_first = doc['idle']['frames'][0]
    after = _after(block, list(doc), [name for name, entry in doc.items()
                                      if entry['loop'] is False])
    states = []
    for track, entry in doc.items():
        frames = [Image.open(frames_dir / track / name).convert('RGBA')
                  for name in entry['frames']]
        gif_frames = list(frames)
        if track in after:
            gif_frames.append(Image.open(frames_dir / 'idle' / idle_first).convert('RGBA'))
        _save_gif(out / ('track-' + track + '.gif'), gif_frames, entry['frameMs'])
        states.append({'name': track, 'images': frames,
                       'ms': list(entry['frameMs']), 'loop': track not in after})
    names = list(doc)
    cell_w, cell_h = CANVAS_W * 2, CANVAS_H * 2
    grid_rows = math.ceil(len(names) / OVERVIEW_COLUMNS)
    sheet = Image.new('RGBA', (OVERVIEW_COLUMNS * cell_w, grid_rows * cell_h),
                      CHECKER_LIGHT + (255,))
    for index, track in enumerate(names):
        cell = Image.open(frames_dir / track / doc[track]['frames'][0]).convert('RGBA')
        cell = cell.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
        sheet.paste(checkerboard(cell), ((index % OVERVIEW_COLUMNS) * cell_w,
                                         (index // OVERVIEW_COLUMNS) * cell_h))
    sheet.save(overview)
    shutil.copyfile(atlas_path, atlas_copy)
    checkerboard(base).save(transparent)

    write_page(out / block.get('page', spec['id'] + '.html'),
               '%s · %s' % (spec['displayName'], spec['id']),
               [('底图 3×', _file_uri(S.path_of(spec, 'base')), 576),
                ('抠图检查', _file_uri(transparent), 384),
                ('动作总览', _file_uri(overview), 768)],
               states)
    return out


def pack_previews(spec, block, sprite2d, base, atlas_path):
    """墩墩's preview shelf: GIFs plus a contact sheet and a single page, all
    sliced back out of the shipped atlas so the previews cannot drift from it."""
    out = S.path_of(block, 'dir') or (S.PET_DIR / sprite2d.get('petId', spec['id']) / 'preview')
    out.mkdir(parents=True, exist_ok=True)
    rows = motion.declared_rows(sprite2d)
    names = render.row_names(sprite2d)
    with Image.open(atlas_path) as opened:
        sheet = opened.convert('RGBA')
    cells = {name: _slice_atlas(sheet, index, render.row_count(rows[name]))
             for index, name in enumerate(names)}

    after = _after(block, names, [name for name in names
                                 if rows[name].get('loop') is False])
    states = []
    for name in names:
        rgb = [frame.convert('RGB') for frame in cells[name]]
        ms = S.timing(rows[name], 'durations')
        if name in after:
            rgb.append(cells['idle'][0].convert('RGB'))
        _save_gif(out / ('track-' + name + '.gif'), rgb, ms)
        states.append({'name': name, 'images': cells[name], 'ms': ms,
                       'kind': 'once' if name in after else 'loop'})

    contact_path = out / 'contact-sheet.png'
    _contact_sheet(cells, names).convert('RGB').save(contact_path)

    write_page(out / block.get('page', 'preview.html'),
               '%s · %s' % (spec['displayName'], sprite2d.get('petId', spec['id'])),
               [('底图 3×', _file_uri(S.path_of(spec, 'base')), 576),
                ('contact sheet', _file_uri(contact_path), 768)],
               states)
    return out


def sheet_previews(spec, block, sprite2d):
    """Preview shelf for a pet whose atlas is supplied instead of built: every
    GIF, the contact sheet and the page are sliced back out of that very file,
    so nothing is re-rendered and the preview cannot drift from what ships.

    Row names, playback kinds and cell counts are read the way the engine reads
    them -- the manifest's own declarations first, then the painted cells, then
    the engine's default timing pattern for a row the manifest leaves silent
    (a pose set like 打工卜's gaze rows is not in that table and falls back to
    the recipe's ``frameMs``).
    """
    pet_dir = S.PET_DIR / sprite2d.get('petId', spec['id'])
    sheet_path = pet_dir / sprite2d['spritesheet']
    with Image.open(sheet_path) as opened:
        sheet = opened.convert('RGBA')
    columns = int(sprite2d.get('columns', 8))
    names = resolve_row_names(sprite2d, max(1, sheet.height // CANVAS_H))
    declared = sprite2d.get('frames')
    tracks = sprite2d.get('tracks') or {}
    counts = {}
    for index, name in enumerate(names):
        if isinstance(declared, list) and index < len(declared):
            counts[name] = int(declared[index])
        else:
            counts[name] = _painted_columns(sheet, index, columns)
    kinds = {name: row_kind(tracks.get(name, {})) for name in names}
    blank = [name for name in names if not counts[name]]
    if blank:
        raise S.SpecError('%s: row %s paints no cells in %s; declare sprite2d.frames so '
                          'this build knows how many frames that row holds'
                          % (spec['id'], blank[0], sprite2d['spritesheet']))

    out = S.path_of(block, 'dir') or (pet_dir / 'preview')
    out.mkdir(parents=True, exist_ok=True)
    cells = {name: _slice_atlas(sheet, index, counts[name], columns)
             for index, name in enumerate(names)}
    after = _after(block, names, [name for name in names if kinds[name] == 'once'])

    states = []
    for name in names:
        ms = row_durations(tracks.get(name), name, len(cells[name]),
                            block.get('frameMs', 200))
        rgb = [frame.convert('RGB') for frame in cells[name]]
        if name in after and cells.get('idle'):
            rgb.append(cells['idle'][0].convert('RGB'))
        _save_gif(out / ('track-' + name + '.gif'), rgb, ms)
        states.append({'name': name, 'images': cells[name], 'ms': ms,
                       'kind': 'once' if name in after else kinds[name]})

    contact_path = out / 'contact-sheet.png'
    _contact_sheet(cells, names).convert('RGB').save(contact_path)
    atlas_copy = out / block.get('atlas', 'atlas-%s%s' % (
        sprite2d.get('petId', spec['id']), sheet_path.suffix))
    if atlas_copy.resolve() != sheet_path.resolve():
        shutil.copyfile(sheet_path, atlas_copy)
    write_page(out / block.get('page', 'preview.html'),
               '%s · %s' % (spec['displayName'], sprite2d.get('petId', spec['id'])),
               [('参考帧 · %s 第 1 帧' % names[0], None, 576),
                ('contact sheet', _file_uri(contact_path), 768)],
               states, '参考帧（%s 第 1 帧）' % names[0])
    return out
