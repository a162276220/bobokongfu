"""Turn a recipe's motion into frames and an atlas.

Two blink stages exist because the two hand-written pipelines differed and both
are baked into shipped pixels: 胡胡's frames2d tracks paint the eyelid on the
base image *before* transforming, while 墩墩's rows transform first and paint on
the transformed frame with forward-mapped eye centres. ``blinkStage`` in a
recipe chooses per output (and a row may override it).
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image

from transforms import CANVAS_H, CANVAS_W, paint_blink, transform

from . import motion, spec as S


def mapped_eyes(eyes, kwargs):
    """Eye centres pushed through the same forward affine as ``transform``.

    ``transforms.transform``'s forward map is ``x' = sx*cos*rx - sx*sin*ry + dx``
    with the pivot at (96, 208); this is that map written out, so a blink drawn
    after the transform lands on the transformed eye.
    """
    sx = kwargs.get('squash_x', 1.0) * kwargs.get('scale', 1.0)
    sy = kwargs.get('squash_y', 1.0) * kwargs.get('scale', 1.0)
    th = math.radians(kwargs.get('rotate_deg', 0.0))
    cos, sin = math.cos(th), math.sin(th)
    dx, dy = kwargs.get('dx', 0.0), kwargs.get('dy', 0.0)
    out = []
    for ex, ey, ew, eh in eyes:
        rx, ry = ex - 96.0, ey - 208.0
        out.append((96.0 + (sx * cos) * rx - (sx * sin) * ry + dx,
                    208.0 + (sy * sin) * rx + (sy * cos) * ry + dy, ew, eh))
    return out


def render_track(base, eyes, track, timing_key, stage='before'):
    """Every frame of one track, in order."""
    count = motion.count_of(track, timing_key)
    blinks = motion.blinks(track, count)
    frames = []
    for index in range(count):
        kwargs = motion.pose(track, index, count)
        image = paint_blink(base, eyes, blinks[index]) if blinks[index] and stage == 'before' else base
        frame = transform(image, **kwargs)
        if blinks[index] and stage == 'after':
            frame = paint_blink(frame, mapped_eyes(eyes, kwargs), blinks[index])
        frames.append(frame)
    return frames


def frame_name(index):
    return 'f%02d.png' % index


def save_frames(frames, directory):
    directory.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        # PNG, not WEBP: lossless WEBP does not preserve the RGB of fully
        # transparent pixels through a save/load round trip, and the engine
        # accepts either extension. PNG keeps the documented zeroed-transparent
        # invariant true on the shipped bytes.
        frame.save(directory / frame_name(index), format='PNG', optimize=True)
    return [frame_name(i) for i in range(len(frames))]


def load_frames(directory, count):
    return [Image.open(directory / frame_name(i)).convert('RGBA') for i in range(count)]


def build_atlas(rows, columns=None):
    """Paste every row into one sheet, unused cells left fully transparent."""
    columns = columns or 8
    sheet = Image.new('RGBA', (columns * CANVAS_W, len(rows) * CANVAS_H), (0, 0, 0, 0))
    for row_index, frames in enumerate(rows):
        for column, frame in enumerate(frames):
            # Pasted without a mask: passing the frame as its own mask would
            # blend each antialiased edge pixel against the transparent cell and
            # halve its RGB, so a row copied from a frames2d track would stop
            # being byte-identical to the file it came from.
            sheet.paste(frame, (column * CANVAS_W, row_index * CANVAS_H))
    array = np.asarray(sheet).copy()
    array[array[:, :, 3] == 0, :3] = 0
    return Image.fromarray(array, 'RGBA')


def row_names(block):
    """The rows a sprite2d block paints, in engine order."""
    if block.get('rowNames'):
        return list(block['rowNames'])
    if block.get('rows') == 'default':
        return [name for name in S.ROW_NAMES if name in motion.DEFAULT_ROWS]
    return [name for name in S.ROW_NAMES if name in (block.get('rows') or {})]


def row_count(row):
    """Frames a row paints, from its poses or from its declared durations."""
    return motion.count_of(row, 'durations')


def sheet_durations(rows):
    """Manifest ``tracks`` block derived from the rows themselves."""
    tracks = {}
    for name, row in rows.items():
        entry = {'durations': S.timing(row, 'durations')}
        if row.get('loop') is False:
            entry['loop'] = False
            entry['fallback'] = row.get('fallback', 'idle')
        tracks[name] = entry
    return tracks
