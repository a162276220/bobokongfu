from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import transforms as T

OUT = ROOT / 'pet' / 'huhu-carrot' / 'frames'
BASE = ROOT / 'assets' / 'derived' / 'base.huhu.png'
EYES = ROOT / 'assets' / 'derived' / 'eye-regions.json'
SPEC_OUT = ROOT / 'assets' / 'derived' / 'frames-spec.json'

# 16 frames: 11 neutral breathing frames, a closed eye at index 11, a half
# open eye at index 12, then 3 neutral frames. Cycle length 3940 ms.
IDLE_MS = [260] * 11 + [150, 150] + [260] * 3
BLINK_T = {11: 1.0, 12: 0.5}


def _phase(i, n):
    return 0.5 - 0.5 * math.cos(2.0 * math.pi * i / n)


def idle_frame(i):
    n = 16
    ph = _phase(i, n)
    return (dict(scale=0.985 + 0.030 * ph, dy=2.0 * math.sin(2.0 * math.pi * i / n)),
            BLINK_T.get(i, 0.0))


def waiting_frame(i):
    n = 6
    ph = _phase(i, n)
    return (dict(scale=0.990 + 0.020 * ph, dx=3.0 * math.sin(2.0 * math.pi * i / n)), 0.0)


def thinking_frame(i):
    n = 6
    ph = _phase(i, n)
    return (dict(scale=0.995 + 0.015 * ph, rotate_deg=-3.0 - 1.0 * ph), 0.0)


def tool_frame(i):
    n = 8
    hop = 1.0 if i % 2 == 0 else 0.0
    return (dict(scale=0.988 + 0.012 * hop, dx=3.0 * math.sin(2.0 * math.pi * i / n),
                 rotate_deg=2.5 * math.sin(2.0 * math.pi * i / n)), 0.0)


def review_frame(i):
    n = 6
    return (dict(rotate_deg=4.0 * math.sin(2.0 * math.pi * i / n)), 0.0)


def done_frame(i):
    n = 4
    lift = math.sin(math.pi * i / (n - 1))
    return (dict(dy=-16.0 * lift, squash_y=1.0 + 0.04 * lift, squash_x=1.0 - 0.04 * lift), 0.0)


def failed_frame(i):
    n = 4
    return (dict(scale=0.96, rotate_deg=1.5 * math.sin(2.0 * math.pi * i / n)), 0.0)


TRACKS = {
    'idle':     dict(n=16, ms=IDLE_MS, loop=True,  fallback=None,   fn=idle_frame),
    'waiting':  dict(n=6,  ms=[180] * 6, loop=True,  fallback=None,   fn=waiting_frame),
    'thinking': dict(n=6,  ms=[140] * 6, loop=True,  fallback=None,   fn=thinking_frame),
    'tool':     dict(n=8,  ms=[110] * 8, loop=True,  fallback=None,   fn=tool_frame),
    'review':   dict(n=6,  ms=[160] * 6, loop=True,  fallback=None,   fn=review_frame),
    'done':     dict(n=4,  ms=[130] * 4, loop=False, fallback='idle', fn=done_frame),
    'failed':   dict(n=4,  ms=[150] * 4, loop=False, fallback='idle', fn=failed_frame),
}


def render_track(base, eyes, spec):
    frames = []
    for i in range(spec['n']):
        kwargs, blink_t = spec['fn'](i)
        frames.append(T.transform(T.paint_blink(base, eyes, blink_t), **kwargs))
    return frames


def write_track(track, frames):
    # PNG, not WEBP: lossless WEBP does not preserve the RGB of fully
    # transparent pixels through a save/load round trip. Measured on an idle
    # frame -- 0 such pixels in memory, 1097 after a WEBP round trip, with
    # values like (0,0,255) and (0,127,0). The engine accepts both
    # extensions, so PNG keeps the documented zeroed-transparent-RGB
    # invariant true on the shipped bytes.
    target = OUT / track
    target.mkdir(parents=True, exist_ok=True)
    for i, im in enumerate(frames):
        im.save(target / ('f%02d.png' % i), format='PNG', optimize=True)
    return ['f%02d.png' % i for i in range(len(frames))]


def main():
    base = Image.open(BASE).convert('RGBA')
    eyes = json.loads(EYES.read_text(encoding='utf-8'))['eyes']
    written = {}
    for track, spec in TRACKS.items():
        names = write_track(track, render_track(base, eyes, spec))
        written[track] = dict(frames=names, frameMs=list(spec['ms']),
                              loop=spec['loop'], fallback=spec['fallback'])
        print(track, spec['n'], sum(spec['ms']), 'ms')
    SPEC_OUT.write_text(json.dumps(written, ensure_ascii=False, indent=2) + chr(10),
                        encoding='utf-8')
    print('wrote', SPEC_OUT)


if __name__ == '__main__':
    main()
