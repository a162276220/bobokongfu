"""The motion vocabulary: a track's channels become per-frame transform keywords.

Every track is a list of *channels*; each channel writes one keyword of
``transforms.transform`` for one frame. The vocabulary is deliberately narrow
(``spec.MOTION_KINDS``), and each kind evaluates its arithmetic in the same
order as the hand-written frame functions this module replaced -- the shipped
pets are rebuilt byte for byte from these recipes, so a reordered multiply shows
up as a changed PNG rather than as a silent style drift.

Channel fields:

``target``  scale, dx, dy, rotate_deg, squash_x or squash_y
``kind``    const     -> offset
            sin       -> offset + amp * sin(2*pi*cycles*i/count + phase)
            cos       -> offset + amp * cos(...)
            raised-cos-> offset + amp * (0.5 - 0.5*cos(...))   one-way breath
            square    -> offset + amp * (1 or 0), the sign of cos(...)  alternation
            arc       -> offset + amp * sin(pi * (i/(count-1))**warp)   a one-shot hop
            values    -> offset + amp * vectors[name][i]           hand-drawn curve
            volume    -> offset - amp * (other_channel - offset)   plush squash
``offset``  the resting value; a scale/squash channel rests at 1.0, a
            translation or rotation at 0.0. When it is 0 the sum is written as
            ``amp * term`` so the arithmetic matches a hand-written ``-12.0 * v``.
``amp``     amplitude, default 1.0; ``cycles`` periods per track, default 1.0;
            ``phase`` radians, default 0.0; ``warp`` arc exponent, default 0.6.
"""

from __future__ import annotations

import math

from .spec import SpecError, timing

# Movement language measured off the reference tutorial: horizontal
# squash-and-stretch carries almost everything, vertical give only on `failed`.
DEFAULT_ROWS = {
    'idle': {'durations': [400] * 8, 'motion': [
        {'target': 'squash_x', 'kind': 'sin', 'offset': 1.0, 'amp': 0.020},
        {'target': 'squash_y', 'kind': 'sin', 'offset': 1.0, 'amp': -0.020}]},
    'running-right': {'durations': [110] * 8, 'motion': [
        {'target': 'squash_x', 'kind': 'cos', 'offset': 1.07, 'amp': -0.24},
        {'target': 'squash_y', 'kind': 'volume', 'of': 'squash_x', 'offset': 1.0, 'amp': 0.45},
        {'target': 'dx', 'kind': 'sin', 'amp': 2.5},
        {'target': 'rotate_deg', 'kind': 'sin', 'amp': 2.0}]},
    'running-left': {'durations': [160] * 6, 'motion': [
        {'target': 'squash_x', 'kind': 'cos', 'offset': 1.07, 'amp': -0.21},
        {'target': 'squash_y', 'kind': 'volume', 'of': 'squash_x', 'offset': 1.0, 'amp': 0.45},
        {'target': 'dx', 'kind': 'sin', 'amp': -2.2},
        {'target': 'rotate_deg', 'kind': 'sin', 'amp': -2.0}]},
    'waving': {'durations': [140] * 6, 'motion': [
        {'target': 'squash_x', 'kind': 'cos', 'offset': 1.16, 'amp': -0.19,
         'phase': 1.5707963267948966},
        {'target': 'squash_y', 'kind': 'volume', 'of': 'squash_x', 'offset': 1.0, 'amp': 0.45},
        {'target': 'dx', 'kind': 'sin', 'amp': 1.5, 'phase': 1.5707963267948966},
        {'target': 'rotate_deg', 'kind': 'sin', 'amp': 1.2, 'phase': 1.5707963267948966}]},
    'jumping': {'durations': [130] * 4, 'poses': [
        {'squash_x': 1.12, 'squash_y': 0.90},
        {'squash_x': 0.94, 'squash_y': 1.06, 'dy': -6.0},
        {'squash_x': 1.00, 'squash_y': 1.02, 'dy': -3.0},
        {'squash_x': 1.10, 'squash_y': 0.92}]},
    'failed': {'durations': [150] * 4, 'poses': [
        {'squash_x': 1.06, 'squash_y': 0.94},
        {'squash_x': 1.16, 'squash_y': 0.58},
        {'squash_x': 1.14, 'squash_y': 0.62},
        {'squash_x': 1.04, 'squash_y': 0.88}]},
    'waiting': {'durations': [180] * 6, 'motion': [
        {'target': 'rotate_deg', 'kind': 'sin', 'amp': 2.0, 'phase': 1.0471975511965976},
        {'target': 'dx', 'kind': 'sin', 'amp': 1.2, 'phase': 1.0471975511965976}]},
    'running': {'durations': [140] * 6, 'motion': [
        {'target': 'squash_x', 'kind': 'sin', 'offset': 1.0, 'amp': 0.05,
         'phase': 1.5707963267948966},
        {'target': 'squash_y', 'kind': 'sin', 'offset': 1.0, 'amp': -0.05,
         'phase': 1.5707963267948966}]},
    'review': {'durations': [160] * 6, 'motion': [
        {'target': 'rotate_deg', 'kind': 'sin', 'amp': 1.6, 'phase': 1.5707963267948966}]},
}
DEFAULT_SEQUENCES = {'idle': ['idle', 'idle', 'waving', 'idle', 'running-left']}


def angle(channel, index, count):
    phase = channel.get('phase', 0.0)
    value = 2.0 * math.pi * channel.get('cycles', 1.0) * index / count
    return value + phase if phase else value


def _term(channel, index, count, vectors):
    kind = channel.get('kind', 'sin')
    if kind == 'sin':
        return math.sin(angle(channel, index, count))
    if kind == 'cos':
        return math.cos(angle(channel, index, count))
    if kind == 'raised-cos':
        return 0.5 - 0.5 * math.cos(angle(channel, index, count))
    if kind == 'square':
        return 1.0 if math.cos(angle(channel, index, count)) >= 0.0 else 0.0
    if kind == 'arc':
        if count < 2:
            raise SpecError('arc motion needs at least two frames')
        return math.sin(math.pi * (index / (count - 1)) ** channel.get('warp', 0.6))
    if kind == 'values':
        return vectors[channel['values']][index]
    raise SpecError('unknown motion kind: ' + str(kind))


def pose(track, index, count):
    """Transform keywords for frame ``index``; only the channels that were set."""
    poses = track.get('poses')
    if poses is not None:
        return dict(poses[index])
    vectors = track.get('vectors', {})
    out = {}
    for channel in track['motion']:
        target = channel['target']
        kind = channel.get('kind', 'sin')
        offset = channel.get('offset', 0.0)
        if kind == 'const':
            out[target] = offset
            continue
        if kind == 'volume':
            # Written exactly as the hand-authored ``1.0 - 0.45 * (sx - 1.0)``.
            other = channel['of']
            if other not in out:
                raise SpecError('volume channel %s is declared before %s' % (target, other))
            out[target] = offset - channel.get('amp', 1.0) * (out[other] - offset)
            continue
        term = _term(channel, index, count, vectors)
        amp = channel.get('amp', 1.0)
        out[target] = offset + amp * term if offset else amp * term
    return out


def blinks(track, count):
    """Per-frame eyelid amounts, 0.0 meaning open."""
    blink = track.get('blink')
    if blink is None:
        return [0.0] * count
    if isinstance(blink, list):
        return [float(v) for v in blink]
    return [float(blink.get(str(i), 0.0)) for i in range(count)]


def count_of(track, timing_key):
    """How many frames a track has: from its poses, else from its timing."""
    poses = track.get('poses')
    if poses is not None:
        return len(poses)
    return len(timing(track, timing_key))


def declared_rows(block):
    """Sprite2d rows, either the recipe's own or the standard nine-row pack."""
    rows = block['rows']
    if rows == 'default':
        return {name: dict(spec) for name, spec in DEFAULT_ROWS.items()}
    return rows
