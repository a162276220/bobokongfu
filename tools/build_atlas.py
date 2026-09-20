from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import transforms as T

FRAMES = ROOT / 'pet' / 'huhu-carrot' / 'frames'
OUT_DIR = ROOT / 'pet' / 'huhu-carrot-office'
OUT = OUT_DIR / 'spritesheet-win-1.png'
SPEC_OUT = ROOT / 'assets' / 'derived' / 'atlas-spec.json'
BASE = ROOT / 'assets' / 'derived' / 'base.huhu.png'
EYES = ROOT / 'assets' / 'derived' / 'eye-regions.json'

COLS, ROW_COUNT = 8, 9
CW, CH = 192, 208
ROW_NAMES = ['idle', 'running-right', 'running-left', 'waving',
             'jumping', 'failed', 'waiting', 'running', 'review']
IDLE_MS = [400] * 8
IDLE_BLINK = {6: 1.0, 7: 0.45}
SWAY_DEG = (0.0, 4.0, 5.0, 0.0, -4.0, -5.0)
HOP_LIFT = (0.0, 0.62, 1.0, 0.62, 0.18, 0.0)


def _phase(i, n):
    return 0.5 - 0.5 * math.cos(2.0 * math.pi * i / n)


def idle_row(base, eyes):
    out = []
    for i in range(8):
        ph = _phase(i, 8)
        im = T.paint_blink(base, eyes, IDLE_BLINK.get(i, 0.0))
        out.append(T.transform(im, scale=0.985 + 0.030 * ph,
                               dy=2.0 * math.sin(2.0 * math.pi * i / 8)))
    return out


def sway_row(base, eyes):
    return [T.transform(T.paint_blink(base, eyes, 0.0), rotate_deg=deg) for deg in SWAY_DEG]


def hop_row(base, eyes):
    out = []
    for lift in HOP_LIFT:
        out.append(T.transform(T.paint_blink(base, eyes, 0.0), dy=-12.0 * lift,
                               squash_y=1.0 + 0.035 * lift, squash_x=1.0 - 0.035 * lift))
    return out


def track_row(track):
    names = sorted((FRAMES / track).glob('f*.png'))
    return [Image.open(FRAMES / track / ('f%02d.png' % i)).convert('RGBA') for i in range(len(names))]


def build_atlas(rows):
    sheet = Image.new('RGBA', (COLS * CW, ROW_COUNT * CH), (0, 0, 0, 0))
    for row_index, frames in enumerate(rows):
        for col, im in enumerate(frames):
            # Paste without a mask. Passing the frame as its own mask would
            # blend each antialiased edge pixel against the transparent cell,
            # halving its RGB and breaking byte-identity with the source
            # frame file that test_running_right_row_reuses_the_tool_track_frames
            # asserts on.
            sheet.paste(im, (col * CW, row_index * CH))
    arr = np.asarray(sheet).copy()
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, 'RGBA')


def main():
    base = Image.open(BASE).convert('RGBA')
    eyes = json.loads(EYES.read_text(encoding='utf-8'))['eyes']
    rows = [idle_row(base, eyes), track_row('tool'), sway_row(base, eyes),
            hop_row(base, eyes), track_row('done'), track_row('failed'),
            track_row('waiting'), track_row('thinking'), track_row('review')]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # PNG, same reason as the frames2d tracks: lossless WEBP does not preserve
    # the RGB of fully transparent pixels across a save/load round trip, which
    # would break the zeroed-transparent-RGB invariant on the shipped bytes.
    atlas = build_atlas(rows)
    atlas.save(OUT, format='PNG', optimize=True)
    spec = {
        'columns': COLS,
        'rows': ROW_COUNT,
        'cell': {'width': CW, 'height': CH},
        'frames': [len(r) for r in rows],
        'rowNames': ROW_NAMES,
        'tracks': {
            'idle': {'durations': IDLE_MS},
            'running-right': {'durations': [110] * 8},
            'running-left': {'durations': [160] * 6},
            'waving': {'durations': [140] * 6},
            'jumping': {'durations': [130] * 4, 'loop': False, 'fallback': 'idle'},
            'failed': {'durations': [150] * 4, 'loop': False, 'fallback': 'idle'},
            'waiting': {'durations': [180] * 6},
            'running': {'durations': [140] * 6},
            'review': {'durations': [160] * 6},
        },
    }
    SPEC_OUT.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + chr(10), encoding='utf-8')
    print('atlas', OUT, atlas.size)
    print('frames', spec['frames'])
    print('idle loop ms', sum(IDLE_MS))


if __name__ == '__main__':
    main()
