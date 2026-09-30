#!/usr/bin/env python
"""Re-cut an external petdex atlas so it meets this repo's geometry rubric.

The petdex sheets in D:/dockerdesk宠物 were fitted one row at a time, which left
three defects this repo rejects. This tool fixes the two that are properties of
frame *order* and *encoding*, and reports the third:

  * rgb-residue        -- libwebp regenerates RGB noise under alpha=0, so the
                          sheet moves to PNG, where a cleared pixel stays clear.
  * loop seam          -- a loop row's phase origin is arbitrary, so the cycle is
                          rotated to cut at its most-similar adjacent pair. The
                          frames themselves are untouched; playback is identical
                          up to where it starts.
  * neutral lead       -- cross-row-proportions reads frame[0] alone, so among the
                          rotations that already seam well, the one whose first
                          frame shows the character at full height is preferred.

Rows whose order carries meaning ('once' collapses, 'set' pose collections) are
never rotated.

A row that was shrunk because its bounding box had to hold a whole jump arc, or
hold a desk and chair next to the character, is a scale error inside the artwork
itself; that cannot be fixed by reordering and is only reported here.

    python tools/normalize_sheet.py pet/bear-fishing ...
    python tools/normalize_sheet.py --dry-run pet/bear-fishing
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import qa_check as Q

SEAM_TARGET = Q.MAX_SEAM_RATIO * 0.8   # rotate clear of the limit, not onto it
CUT_BIAS = 0.02     # small discount for the original order, so rows churn less
COLUMNS = 8


def _lead(frame):
    """What the rubric reads as a row's neutral pose: its first frame."""
    box = Q._bbox(frame)
    if box is None:
        return 0.0, 0.0
    return float(box[1] - box[0] + 1), float(int((frame[:, :, 3] > 0).sum()))


def _seam_ratio(seq):
    """QA's seam test for one rotation: wrap step over largest interior step."""
    n = len(seq)
    if n < 3:
        return 0.0
    inner = max(Q._frame_diff(seq[i], seq[i + 1]) for i in range(n - 1))
    if inner <= 0:
        return 0.0
    return Q._frame_diff(seq[0], seq[-1]) / float(inner)


def _rotations(seq):
    return [seq[cut:] + seq[:cut] for cut in range(len(seq))]


def choose_rotation(row):
    """Score every rotation of a loop row; immovable rows have one option."""
    n = len(row.frames)
    if row.kind != 'loop' or n < 2:
        return [(0, 0.0, _lead(row.frames[0]), row.frames[0])]
    scored = [(cut, _seam_ratio(rot), _lead(rot[0]), rot[0])
              for cut, rot in enumerate(_rotations(row.frames))]
    good = [s for s in scored if s[1] <= SEAM_TARGET]
    if not good:
        floor = min(s[1] for s in scored)
        good = [s for s in scored if s[1] <= floor + 1e-9]
    return good


def pick_cuts(rows, pixel_floor):
    """Cut each loop row so the leads agree on size and every seam stays smooth.

    Rotating a row changes only where its cycle starts, so the seam constraint
    filters the options and the neutral-pose choice is then free. All rows compete
    against each other here: cross-row-proportions is a max/min over the leads, so
    a single splayed frame can fail the sheet no matter how well the others match.
    """
    options = [choose_rotation(row) for row in rows]
    idle = next((i for i, row in enumerate(rows) if row.name == 'idle'), 0)
    refs = [lead for opts in options for _, _, lead, _ in opts if lead[0] > 0]
    best, best_cost = None, None
    for ref_h, ref_a in refs:
        picked = []
        for opts in options:
            graded = sorted(
                (abs(np.log(max(lead[0], 1.0) / ref_h))
                 + abs(np.log(max(lead[1], 1) / ref_a))
                 - (CUT_BIAS if cut == 0 else 0.0), index)
                for index, (cut, _, lead, _) in enumerate(opts))
            picked.append(opts[graded[0][1]])
        height = _spread(lead[0] for _, _, lead, _ in picked)
        area = _spread(max(lead[1], 1.0) for _, _, lead, _ in picked)
        seam = max(s for _, s, _, _ in picked)
        score = _score(height, area, seam) + 20.0 * _lookalikes(picked, idle, pixel_floor)
        if best_cost is None or score < best_cost:
            best, best_cost = picked, score
    return best


def _lookalikes(picked, idle, pixel_floor):
    """Rows whose neutral pose is indistinguishable from idle's.

    Some source sheets ship a state row that is only a phase-shifted copy of idle;
    a careless cut then lines idle's own phase up with it and the two read as one
    state, which the states-distinct check rejects.
    """
    reference = picked[idle][3].astype(np.int32)
    return sum(1 for index, option in enumerate(picked) if index != idle
               and int((np.abs(option[3].astype(np.int32) - reference)
                        .sum(axis=2) > 24).sum()) < pixel_floor)


def _score(height, area, seam):
    """How far the sheet sits inside the three geometry limits it must clear."""
    over = (4.0 * max(0.0, seam - SEAM_TARGET)
            + 20.0 * max(0.0, height - Q.MAX_ROWS_HEIGHT_RATIO)
            + 20.0 * max(0.0, area - Q.MAX_ROWS_AREA_RATIO))
    return over + 0.1 * (height / Q.MAX_ROWS_HEIGHT_RATIO
                         + area / Q.MAX_ROWS_AREA_RATIO)


def _spread(values):
    values = [v for v in values if v > 0]
    if len(values) < 2:
        return 1.0
    return max(values) / min(values)


def rebuild(grid):
    """Return (new atlas, per-row notes) with loop rows re-cut and gaps cleared."""
    cell_w, cell_h = grid.cell
    atlas = np.zeros((cell_h * len(grid.rows), cell_w * COLUMNS, 4), np.uint8)
    notes = []
    pixel_floor = 2.0 * Q.MIN_STATE_DIFFERENCE * cell_w * cell_h
    picked = pick_cuts(grid.rows, pixel_floor)
    for index, (row, (cut, seam, _, _)) in enumerate(zip(grid.rows, picked)):
        seq = row.frames[cut:] + row.frames[:cut] if cut else list(row.frames)
        for col, frame in enumerate(seq):
            if col >= COLUMNS:
                break
            atlas[index * cell_h:(index + 1) * cell_h,
                  col * cell_w:(col + 1) * cell_w] = frame
        notes.append({'row': row.name, 'kind': row.kind, 'frames': len(seq),
                      'cut': cut, 'seam': round(seam, 3)})
    invisible = atlas[:, :, 3] == 0
    atlas[:, :, :3][invisible] = 0
    return atlas, notes


def normalise(pet_dir, dry_run=False):
    pet_dir = Path(pet_dir)
    recipe = Path('pets') / (pet_dir.name + '.json')
    spec = json.loads(recipe.read_text(encoding='utf-8'))
    sprite2d = spec['outputs']['sprite2d']
    old_name = sprite2d['spritesheet']
    old_path = pet_dir / old_name
    new_name = Path(old_name).with_suffix('.png').name

    grid = Q.load_grid(pet_dir)
    atlas, notes = rebuild(grid)

    changed_rows = [n for n in notes if n['cut']]
    in_bytes = int(old_path.stat().st_size) if old_path.exists() else 0
    if not dry_run:
        Image.fromarray(atlas, 'RGBA').save(pet_dir / new_name, format='PNG',
                                            optimize=True)
        if new_name != old_name and old_path.exists():
            old_path.unlink()
        if new_name != old_name:
            sprite2d['spritesheet'] = new_name
            recipe.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n',
                              encoding='utf-8', newline='\n')
    return {'pet': pet_dir.name, 'sheet': '%s -> %s' % (old_name, new_name),
            'rotated_rows': [n['row'] for n in changed_rows],
            'in_bytes': in_bytes,
            'out_bytes': 0 if dry_run else int((pet_dir / new_name).stat().st_size),
            'rows': notes}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('pets', nargs='+', help='pet directories to re-cut')
    parser.add_argument('--dry-run', action='store_true',
                        help='report what would change, write nothing')
    args = parser.parse_args(argv)

    for pet in args.pets:
        info = normalise(pet, args.dry_run)
        print('%-30s %s  %s%d -> %d bytes'
              % (info['pet'], info['sheet'], '[dry] ' if args.dry_run else '',
                 info['in_bytes'], info['out_bytes']))
        if info['rotated_rows']:
            print('    re-cut rows: ' + ', '.join(info['rotated_rows']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
