"""Pixel-level QA pass over a built pet, following the hatch-pet QA rubric.

The shipped ``validate_pet.py`` guards the manifest/geometry contract; this tool
guards the *visual* half of the same rubric, so a rebuild can self-check against
one checklist. Rubric sections map onto check-name prefixes:

- ``geometry:``   atlas size, frames inside their cell, unused cells, no baked
                  opaque background
- ``consistency:``same silhouette/proportions/palette across frames and rows,
                  no detached extra subject, no chroma-key residue
- ``animation:``  exact frame counts, seamless loop, motion present, states
                  visually distinct from idle
- ``fitness:``    first idle frame usable as the static pet, idle is the calmest
                  row, key colours absent from the character
- ``preview:``    preview GIFs match the cell geometry

Checks are graded ``error`` (blocks the run) or ``warn`` (recorded, only blocks
with ``--strict``). Thresholds are calibrated against the shipped 胡胡 atlas and
documented next to each constant.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

CELL_W, CELL_H, COLUMNS = 192, 208, 8
ROW_NAMES = ['idle', 'running-right', 'running-left', 'waving', 'jumping',
             'failed', 'waiting', 'running', 'review']
# Per-row playback semantics a pet declares in its own manifest: `loop`
# repeats, `set` is a direction/pose set the engine picks from (nothing to keep
# continuous across the wrap), `once` plays through and then falls back. Rows a
# pet leaves undeclared are loops, which is what the engine assumes.
ROW_KINDS = ('loop', 'set', 'once')
FALLBACK_PETS = ['pet/huhu-carrot', 'pet/huhu-carrot-office']


def _default_pets():
    """Every pet the recipes declare, so a new pet is QA'd without being listed
    here. A recipe that will not load is petkit's problem, not this checker's:
    fall back to the two pets the repo has always shipped."""
    try:
        from petkit import spec as pet_spec
        found = []
        for path in pet_spec.spec_paths():
            for _, _, pet_dir in pet_spec.pet_dirs(pet_spec.load_spec(path)):
                found.append(str(pet_dir.relative_to(pet_spec.ROOT)).replace(chr(92), '/'))
        return found or FALLBACK_PETS
    except Exception:
        return FALLBACK_PETS


DEFAULT_PETS = _default_pets()

# Alpha at or above this counts as solid sprite; lower values are anti-aliasing.
SOLID_ALPHA = 32
# Every used frame must keep this much clear margin from its cell border.
MIN_CELL_MARGIN = 1
# Opaque coverage above this looks like a baked-in background rectangle.
MAX_CELL_COVERAGE = 0.85
# A near-solid cell that is essentially white is a surviving chroma backdrop.
NEAR_WHITE = 245
# Within-row spread of frame height / opaque area.
MAX_ROW_SCALE_RATIO = 1.35
# `jumping` and `failed` are the rows whose rubric purpose *is* a scale change
# (anticipation/lift/descent, deflated reaction), so their inner spread is looser.
DEFORMED_ROWS = {'jumping', 'failed'}
MAX_DEFORMED_SCALE_RATIO = 2.0
# Spread of the neutral (first) frame across rows: catches a row built on a
# differently sized base, without punishing a deliberate in-row deformation.
MAX_ROWS_HEIGHT_RATIO = 1.25
MAX_ROWS_AREA_RATIO = 1.4
# Within-row movement of the lowest opaque pixel, and across row medians.
MAX_ROW_BASELINE_SPAN = 32
MAX_ROWS_BASELINE_SPAN = 14
# Per-frame mean colour distance from the atlas-wide median mean colour.
MAX_PALETTE_DISTANCE = 90
# Share of solid pixels that must belong to one single connected subject.
MIN_SUBJECT_SHARE = 0.95
# Loop rows: first/last frame difference relative to the largest inner step.
MAX_SEAM_RATIO = 1.5
# A row state must differ from idle by at least this share of cell pixels.
MIN_STATE_DIFFERENCE = 0.02
# Chroma-key colours must not survive inside the character.
MAX_KEY_MAGENTA_PIXELS = 24
MAX_KEY_GREEN_PIXELS = 96


class Report:
    def __init__(self, pet_id, kind):
        self.pet_id = pet_id
        self.kind = kind
        self.checks = []

    def add(self, check, ok, detail='', level='error'):
        self.checks.append({'check': check, 'level': level, 'ok': bool(ok),
                            'detail': str(detail)})

    def fails(self):
        return [c['check'] for c in self.checks if not c['ok'] and c['level'] == 'error']

    def warns(self):
        return [c['check'] for c in self.checks if not c['ok'] and c['level'] == 'warn']

    @property
    def ok(self):
        return not self.fails()


def row_kind(entry):
    """Playback kind of one track entry; ``loop: false`` is the legacy spelling
    of ``once``."""
    if not isinstance(entry, dict):
        return 'loop'
    kind = entry.get('kind')
    if kind in ROW_KINDS:
        return kind
    return 'once' if entry.get('loop') is False else 'loop'


def resolve_row_names(doc, row_count):
    """Row names for an atlas: the pet's own ``rowNames``, then the classic
    nine, then ``rowN``."""
    declared = doc.get('rowNames')
    names = [n for n in declared if isinstance(n, str)] if isinstance(declared, list) else []
    for index in range(len(names), row_count):
        names.append(ROW_NAMES[index] if index < len(ROW_NAMES) else 'row%d' % index)
    return names


class Row:
    def __init__(self, name, frames, expected=None, loop=True, content_used=None,
                 kind=None):
        self.name = name
        self.frames = frames
        self.expected = expected
        self.kind = kind or ('loop' if loop else 'once')
        self.loop = self.kind == 'loop'
        self.content_used = content_used


class Grid:
    """A pet rendered as rows of 192x208 RGBA frames, whatever its source."""

    def __init__(self, pet_id, kind, cell, rows, atlas=None, atlas_frames=None,
                 layout_error=None):
        self.pet_id = pet_id
        self.kind = kind
        self.cell = cell
        self.rows = rows
        self.atlas = atlas
        self.atlas_frames = atlas_frames
        self.layout_error = layout_error


def _frame_diff(a, b):
    return int(np.abs(a.astype(np.int32) - b.astype(np.int32)).sum())


def _bbox(frame):
    ys, xs = np.nonzero(frame[:, :, 3] > 0)
    if len(ys) == 0:
        return None
    return (int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max()))


def _row_baseline_span(row):
    bottoms = []
    for frame in row.frames:
        box = _bbox(frame)
        if box is not None:
            bottoms.append(box[1])
    if not bottoms:
        return None
    return max(bottoms) - min(bottoms)


def _row_median_baseline(row):
    bottoms = [_bbox(f)[1] for f in row.frames if _bbox(f) is not None]
    return float(np.median(bottoms)) if bottoms else None


def _row_spans(row):
    heights, areas = [], []
    for frame in row.frames:
        box = _bbox(frame)
        if box is None:
            continue
        heights.append(box[1] - box[0] + 1)
        areas.append(int((frame[:, :, 3] > 0).sum()))
    return heights, areas


def component_sizes(mask):
    """Sizes of 4-connected components in a boolean mask, largest first."""
    labels = np.where(mask, np.arange(1, mask.size + 1, dtype=np.int32).reshape(mask.shape), 0)
    while True:
        best = labels
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            moved = np.roll(labels, shift, axis=axis)
            if axis == 0:
                if shift > 0:
                    moved[0, :] = 0
                else:
                    moved[-1, :] = 0
            else:
                if shift > 0:
                    moved[:, 0] = 0
                else:
                    moved[:, -1] = 0
            bigger = moved > 0
            candidate = np.where(bigger & ((best == 0) | (moved < best)), moved, best)
            best = np.where(mask, candidate, 0)
        if np.array_equal(best, labels):
            return sorted(np.bincount(labels.ravel())[1:].tolist(), reverse=True)
        labels = best


def _used_columns(sheet, row, cell, columns):
    """Columns with content in one atlas row, for manifests that omit `frames`."""
    used = 0
    for col in range(columns):
        cell_px = sheet[row * cell[1]:(row + 1) * cell[1], col * cell[0]:(col + 1) * cell[0]]
        if int((cell_px[:, :, 3] > 0).sum()):
            used = col + 1
    return used


def load_grid(pet_dir):
    pet_dir = Path(pet_dir).resolve()
    doc = json.loads((pet_dir / 'pet.json').read_text(encoding='utf-8'))
    pet_id = doc.get('id') or pet_dir.name
    block = doc.get('frames2d')
    if isinstance(block, dict) and block.get('tracks'):
        frame_dir = pet_dir / block.get('dir', 'frames')
        rows = []
        for track, entry in block['tracks'].items():
            names = [f for f in entry.get('frames', []) if isinstance(f, str)]
            frames = [np.asarray(Image.open(frame_dir / track / name).convert('RGBA'))
                      for name in names]
            rows.append(Row(track, frames, loop=entry.get('loop', True) is not False))
        return Grid(pet_id, 'frames2d', (CELL_W, CELL_H), rows)

    cell = doc.get('cell') or {'width': CELL_W, 'height': CELL_H}
    cell = (int(cell['width']), int(cell['height']))
    sheet = np.asarray(Image.open(pet_dir / doc.get('spritesheetPath', 'spritesheet.webp'))
                       .convert('RGBA'))
    if sheet.shape[1] % cell[0] or sheet.shape[0] % cell[1]:
        return Grid(pet_id, 'sprite2d', cell, [], layout_error=(
            'atlas %dx%d is not a whole number of %dx%d cells'
            % (sheet.shape[1], sheet.shape[0], cell[0], cell[1])))
    columns = int(doc.get('columns', COLUMNS))
    row_count = sheet.shape[0] // cell[1]
    counts = doc.get('frames') or []
    if len(counts) != row_count:
        counts = [_used_columns(sheet, r, cell, columns) for r in range(row_count)]
        declared = False
    else:
        declared = True
    names = resolve_row_names(doc, row_count)
    tracks = doc.get('tracks') or {}
    rows = []
    for index, used in enumerate(counts):
        name = names[index]
        frames = [sheet[index * cell[1]:(index + 1) * cell[1],
                        col * cell[0]:(col + 1) * cell[0]]
                  for col in range(int(used))]
        content = _used_columns(sheet, index, cell, columns)
        rows.append(Row(name, frames, expected=int(used) if declared else None,
                        kind=row_kind(tracks.get(name)), content_used=content))
    return Grid(pet_id, 'sprite2d', cell, rows, atlas=sheet,
                atlas_frames=[int(c) for c in counts])


def check_geometry(grid, report):
    if grid.kind == 'sprite2d':
        rows = len(grid.rows)
        expected = (grid.cell[0] * COLUMNS, grid.cell[1] * rows)
        report.add('geometry:atlas-size-exact', grid.atlas.shape[1::-1] == expected,
                   '%s expected %s (%d rows)'
                   % (grid.atlas.shape[1::-1], expected, rows))
        problems = []
        for index, used in enumerate(grid.atlas_frames):
            for col in range(COLUMNS):
                cell = grid.atlas[index * grid.cell[1]:(index + 1) * grid.cell[1],
                                  col * grid.cell[0]:(col + 1) * grid.cell[0]]
                filled = int((cell[:, :, 3] > 0).sum())
                if col < used:
                    continue
                if filled:
                    problems.append('r%d-c%d:content-in-unused-cell' % (index, col))
                elif int(cell[:, :, :3].max()) != 0:
                    problems.append('r%d-c%d:rgb-residue' % (index, col))
        report.add('geometry:unused-cells-clear', not problems, '; '.join(problems[:8]))

    margins, coverage, whitish = [], [], []
    for row in grid.rows:
        for frame in row.frames:
            box = _bbox(frame)
            if box is None:
                margins.append(-1)
                continue
            top, bottom, left, right = box
            margins.append(min(top, left, grid.cell[1] - 1 - bottom, grid.cell[0] - 1 - right))
            opaque = frame[:, :, 3] > 0
            coverage.append(float(opaque.mean()))
            count = int(opaque.sum())
            if count:
                pale = int(((frame[:, :, :3].min(axis=2) >= NEAR_WHITE) & opaque).sum())
                whitish.append(pale / count)
    report.add('geometry:cells-within-bounds', min(margins) >= MIN_CELL_MARGIN,
               'min margin %d px' % min(margins))
    baked = coverage and (max(coverage) > MAX_CELL_COVERAGE
                          and max(whitish, default=0.0) > 0.5)
    report.add('geometry:no-baked-background',
               max(coverage, default=0.0) <= MAX_CELL_COVERAGE and not baked,
               'max coverage %.3f, max near-white share %.3f'
               % (max(coverage, default=0.0), max(whitish, default=0.0)))


def check_consistency(grid, report):
    ratios, neutral_heights, neutral_areas, palette = [], [], [], []
    for row in grid.rows:
        heights, areas = _row_spans(row)
        limit = MAX_DEFORMED_SCALE_RATIO if row.name in DEFORMED_ROWS else MAX_ROW_SCALE_RATIO
        if heights:
            ratios.append(('%s height' % row.name, max(heights) / min(heights), limit))
            ratios.append(('%s area' % row.name, max(areas) / min(areas), limit))
        if row.frames:
            box = _bbox(row.frames[0])
            if box is not None:
                neutral_heights.append(box[1] - box[0] + 1)
                neutral_areas.append(int((row.frames[0][:, :, 3] > 0).sum()))
        for frame in row.frames:
            opaque = frame[:, :, 3] > 0
            if opaque.any():
                palette.append(frame[:, :, :3][opaque].mean(axis=0))
    worst = max(ratios, key=lambda r: r[1] / r[2], default=('-', 1.0, 1.0))
    report.add('consistency:row-scale-stable', worst[1] <= worst[2],
               'worst %s ratio %.3f (limit %.2f)' % (worst[0], worst[1], worst[2]))

    row_ratio = (max(neutral_heights) / min(neutral_heights)) if neutral_heights else 1.0
    area_ratio = (max(neutral_areas) / min(neutral_areas)) if neutral_areas else 1.0
    report.add('consistency:cross-row-proportions',
               row_ratio <= MAX_ROWS_HEIGHT_RATIO and area_ratio <= MAX_ROWS_AREA_RATIO,
               'neutral-frame height ratio %.3f, area ratio %.3f' % (row_ratio, area_ratio))

    spans = [_row_baseline_span(row) for row in grid.rows]
    spans = [s for s in spans if s is not None]
    medians = [_row_median_baseline(row) for row in grid.rows]
    medians = [m for m in medians if m is not None]
    across = (max(medians) - min(medians)) if medians else 0.0
    report.add('consistency:baseline-stable',
               max(spans, default=0) <= MAX_ROW_BASELINE_SPAN
               and across <= MAX_ROWS_BASELINE_SPAN,
               'max in-row bottom span %d px, across row medians %.1f px'
               % (max(spans, default=0), across))

    if palette:
        mid = np.median(np.stack(palette), axis=0)
        worst = max(float(np.abs(colour - mid).sum()) for colour in palette)
    else:
        worst = 0.0
    report.add('consistency:palette-stable', worst <= MAX_PALETTE_DISTANCE,
               'max mean-colour distance %.1f' % worst)

    worst_share, worst_at = 1.0, ''
    for row in grid.rows:
        for index, frame in enumerate(row.frames):
            solid = frame[:, :, 3] >= SOLID_ALPHA
            sizes = component_sizes(solid)
            if not sizes:
                continue
            share = sizes[0] / float(sum(sizes))
            if share < worst_share:
                worst_share, worst_at = share, '%s-c%d' % (row.name, index)
    report.add('consistency:subject-dominance', worst_share >= MIN_SUBJECT_SHARE,
               'smallest largest-component share %.4f at %s' % (worst_share, worst_at or '-'))

    magenta = green = 0
    for row in grid.rows:
        for frame in row.frames:
            opaque = frame[:, :, 3] > SOLID_ALPHA
            if not opaque.any():
                continue
            pixels = frame[:, :, :3][opaque]
            magenta += int(((pixels[:, 0] >= 230) & (pixels[:, 2] >= 230)
                            & (pixels[:, 1] <= 60)).sum())
            green += int(((pixels[:, 1] >= 230) & (pixels[:, 0] <= 60)
                          & (pixels[:, 2] <= 60)).sum())
    report.add('consistency:key-colour-absent',
               magenta <= MAX_KEY_MAGENTA_PIXELS and green <= MAX_KEY_GREEN_PIXELS,
               'magenta %d / %d, pure green %d / %d'
               % (magenta, MAX_KEY_MAGENTA_PIXELS, green, MAX_KEY_GREEN_PIXELS))


def check_animation(grid, report):
    if grid.kind == 'sprite2d':
        bad = ['%s:declared %d, painted %s' % (r.name, r.expected, r.content_used)
               for r in grid.rows
               if r.expected is not None and r.content_used != r.expected]
        report.add('animation:row-frame-counts', not bad, '; '.join(bad))

    seams = []
    not_repeating = []
    for row in grid.rows:
        if row.kind != 'loop':
            not_repeating.append('%s:%s' % (row.name, row.kind))
            continue
        if len(row.frames) < 3:
            continue
        inner = max(_frame_diff(row.frames[i], row.frames[i + 1])
                    for i in range(len(row.frames) - 1))
        seam = _frame_diff(row.frames[0], row.frames[-1])
        if inner <= 0:
            continue
        seams.append((row.name, seam / float(inner)))
    worst = max(seams, key=lambda s: s[1]) if seams else ('-', 0.0)
    detail = 'worst %s seam ratio %.3f' % (worst[0], worst[1])
    if not_repeating:
        detail += '; not repeating: ' + ', '.join(not_repeating)
    report.add('animation:loop-seam-continuous', worst[1] <= MAX_SEAM_RATIO, detail)

    static = [row.name for row in grid.rows
              if len(row.frames) > 1 and all(_frame_diff(row.frames[0], f) == 0
                                             for f in row.frames[1:])]
    report.add('animation:row-motion-present', not static, '; '.join(static),
               level='warn')

    idle = next((row for row in grid.rows if row.name == 'idle' and row.frames), None)
    if idle is None:
        report.add('animation:states-distinct-from-idle', True, 'no idle row')
    else:
        reference = idle.frames[0].astype(np.int32)
        floor = MIN_STATE_DIFFERENCE * grid.cell[0] * grid.cell[1]
        thin, total = [], 0
        for row in grid.rows:
            if row.name == 'idle' or not row.frames:
                continue
            total += 1
            delta = int((np.abs(row.frames[0].astype(np.int32) - reference).sum(axis=2) > 24).sum())
            if delta < floor:
                thin.append('%s:%d px' % (row.name, delta))
        report.add('animation:states-distinct-from-idle', not thin,
                   '; '.join(thin) if thin
                   else '%d rows compared, floor %d px' % (total, floor))


def check_fitness(grid, report):
    idle = next((row for row in grid.rows if row.name == 'idle' and row.frames), None)
    if idle is None:
        report.add('fitness:idle-first-frame-usable', False, 'no idle frames')
        return
    first = idle.frames[0]
    box = _bbox(first)
    opaque = int((first[:, :, 3] > 0).sum())
    usable = box is not None and opaque >= 0.01 * grid.cell[0] * grid.cell[1] \
        and min(box[0], box[2], grid.cell[1] - 1 - box[1], grid.cell[0] - 1 - box[3]) >= 1
    report.add('fitness:idle-first-frame-usable', usable,
               'opaque %d px, bbox %s' % (opaque, box))

    energies = []
    for row in grid.rows:
        if len(row.frames) < 2:
            continue
        steps = [_frame_diff(row.frames[i], row.frames[i + 1])
                 for i in range(len(row.frames) - 1)]
        if steps:
            energies.append((row.name, float(np.mean(steps))))
    if len(energies) < 2:
        report.add('fitness:idle-calmest-row', True, 'not enough animated rows',
                   level='warn')
    else:
        idle_energy = next((e for name, e in energies if name == 'idle'), None)
        median = float(np.median([e for _, e in energies]))
        report.add('fitness:idle-calmest-row',
                   idle_energy is not None and idle_energy <= median,
                   'idle %.0f vs median %.0f' % (idle_energy or -1, median),
                   level='warn')


def check_previews(pet_dir, grid, report):
    names = {row.name for row in grid.rows}
    found = []
    for root in (Path(pet_dir) / 'preview', ROOT / 'preview'):
        if not root.is_dir():
            continue
        for path in sorted(root.glob('track-*.gif')):
            if path.stem[len('track-'):] in names:
                found.append(path)
    if not found:
        report.add('preview:gif-geometry', True, 'no preview GIFs for this pet', level='warn')
        return
    problems = []
    for path in found:
        with Image.open(path) as gif:
            size = gif.size
            frames = getattr(gif, 'n_frames', 1)
        if size != grid.cell:
            problems.append('%s:%s' % (path.name, size))
        if frames < 2:
            problems.append('%s:static' % path.name)
    report.add('preview:gif-geometry', not problems, '; '.join(problems[:8]), level='warn')


def review_pet(pet_dir):
    try:
        grid = load_grid(pet_dir)
    except FileNotFoundError as exc:
        report = Report(Path(pet_dir).resolve().name, 'unknown')
        report.add('geometry:pet-loadable', False, str(exc))
        return report
    report = Report(grid.pet_id, grid.kind)
    if grid.layout_error:
        report.add('geometry:atlas-layout-supported', False, grid.layout_error)
        return report
    check_geometry(grid, report)
    check_consistency(grid, report)
    check_animation(grid, report)
    check_fitness(grid, report)
    check_previews(Path(pet_dir).resolve(), grid, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Run the hatch-pet QA rubric over a built pet.')
    parser.add_argument('pet_dir', nargs='*', default=DEFAULT_PETS,
                        help='pet directories (default: both shipped pets)')
    parser.add_argument('--strict', action='store_true',
                        help='treat warnings as failures')
    parser.add_argument('--fail-fast', action='store_true',
                        help='stop at the first pet that fails')
    args = parser.parse_args(argv)

    failed = False
    for target in args.pet_dir:
        pet_dir = Path(target)
        report = review_pet(pet_dir)
        out = {'petId': report.pet_id, 'kind': report.kind, 'strict': bool(args.strict),
               'ok': report.ok and not (args.strict and report.warns()),
               'fails': report.fails(), 'warns': report.warns(), 'checks': report.checks}
        qa_dir = pet_dir / 'qa'
        qa_dir.mkdir(parents=True, exist_ok=True)
        (qa_dir / 'review.json').write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + chr(10), encoding='utf-8')
        print('%s (%s)' % (report.pet_id, report.kind))
        print('  ok', out['ok'], 'checks', len(report.checks),
              'errors', len(report.fails()), 'warnings', len(report.warns()))
        for name in report.fails():
            print('  FAIL', name)
        for name in report.warns():
            print('  WARN', name)
        if not out['ok']:
            failed = True
            if args.fail_fast:
                break
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
