from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PREV = ROOT / 'preview'
BASE = ROOT / 'assets' / 'derived' / 'base.huhu.png'
FRAMES = ROOT / 'pet' / 'huhu-carrot' / 'frames'
FRAMES_SPEC = ROOT / 'assets' / 'derived' / 'frames-spec.json'
ATLAS = ROOT / 'pet' / 'huhu-carrot-office' / 'spritesheet-win-1.png'
CHECKER_DARK = (168, 168, 168)
CHECKER_LIGHT = (235, 235, 235)
OVERVIEW_COLS = 4
OVERVIEW_ROWS = 2


def checkerboard(rgba, tile=12):
    canvas = Image.new('RGB', rgba.size, CHECKER_LIGHT)
    pixels = canvas.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            if ((x // tile) + (y // tile)) % 2 == 0:
                pixels[x, y] = CHECKER_DARK
    canvas.paste(rgba, (0, 0), rgba)
    return canvas


def load_track(spec, track):
    frames = [Image.open(FRAMES / track / name).convert('RGBA')
              for name in spec[track]['frames']]
    if spec[track]['loop'] is False:
        idle_first = spec['idle']['frames'][0]
        frames.append(Image.open(FRAMES / 'idle' / idle_first).convert('RGBA'))
    return frames


def save_gif(path, frames, frame_ms):
    rgb = [f.convert('RGB') for f in frames]
    tail = frame_ms + [frame_ms[-1]] * (len(rgb) - len(frame_ms))
    rgb[0].save(path, save_all=True, append_images=rgb[1:],
                duration=tail, loop=0, optimize=True)


def build_overview(spec):
    cell_w, cell_h = 192 * 2, 208 * 2
    sheet = Image.new('RGBA', (OVERVIEW_COLS * cell_w, OVERVIEW_ROWS * cell_h),
                      CHECKER_LIGHT + (255,))
    for index, track in enumerate(spec):
        first = spec[track]['frames'][0]
        cell = Image.open(FRAMES / track / first).convert('RGBA').resize(
            (cell_w, cell_h), Image.Resampling.LANCZOS)
        checker = checkerboard(cell)
        sheet.paste(checker, ((index % OVERVIEW_COLS) * cell_w,
                              (index // OVERVIEW_COLS) * cell_h))
    return sheet


def main():
    PREV.mkdir(parents=True, exist_ok=True)
    spec = json.loads(FRAMES_SPEC.read_text(encoding='utf-8'))
    base = Image.open(BASE).convert('RGBA')
    base.resize((384, 416), Image.Resampling.LANCZOS).save(PREV / 'huhu-static.png')
    for track, data in spec.items():
        save_gif(PREV / ('track-' + track + '.gif'), load_track(spec, track), data['frameMs'])
    build_overview(spec).save(PREV / '胡胡动作总览.png')
    shutil.copyfile(ATLAS, PREV / 'atlas-huhu-carrot-office.png')
    checkerboard(base).save(PREV / 'huhu-transparent-check.png')
    print('preview files')
    for child in sorted(PREV.iterdir()):
        print(' ', child.name)


if __name__ == '__main__':
    main()
