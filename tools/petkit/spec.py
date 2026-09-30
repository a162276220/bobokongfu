"""Load and check a pet recipe (``pets/<id>.json``).

A recipe is data, not code: it names the base image, the motion of every track
and row, the manifest text (remarks, voice) and where the outputs go. The
recipes for the shipped pets rebuild the exact same bytes as the hand-written
builders they replaced, so the checks below are strict about key names and about
unknown keys -- a typo must fail loudly instead of silently taking a default.

Only the recipe's *shape* is judged here. Whether the numbers add up (durations
as long as the frames they time, alternating poses that actually move) is the
builder's job, and whether the result is a legal pet is validate_pet's.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SPEC_DIR = ROOT / 'pets'
PET_DIR = ROOT / 'pet'

ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
SEGMENT_PATTERN = re.compile(r'^[A-Za-z0-9._-]+$')

# The nine classic sprite2d rows, in the engine's fixed order.
ROW_NAMES = ['idle', 'running-right', 'running-left', 'waving', 'jumping',
             'failed', 'waiting', 'running', 'review']
# The seven frames2d activity phases.
PHASE_NAMES = ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed']
OUTPUT_KINDS = ('frames2d', 'sprite2d')
STAGE_NAMES = ('frames2d', 'sprite2d', 'manifests', 'previews')

TOP_KEYS = {'id', 'displayName', 'description', 'version', 'author', 'license',
            'base', 'eyes', 'remarks', 'voice', 'outputs', 'previews'}
FRAMES2D_KEYS = {'petId', 'dir', 'defaultFrameMs', 'spec', 'phases', 'tracks',
                 'blinkStage'}
SPRITE2D_KEYS = {'petId', 'spritesheet', 'columns', 'spec', 'source', 'rows',
                 'tracks', 'sequences', 'rowNames', 'spriteVersionNumber',
                 'blinkStage'}
ROW_KEYS = {'motion', 'poses', 'durations', 'loop', 'fallback', 'blink',
            'vectors', 'from'}
COPIED_ROW_KEYS = {'from', 'durations', 'loop', 'fallback'}
TRACK_KEYS = {'motion', 'poses', 'frameMs', 'loop', 'fallback', 'blink', 'vectors'}
PREVIEW_KEYS = {'style', 'dir', 'page', 'frameMs', 'static', 'overview', 'atlas',
                'transparent', 'after'}
CHANNEL_KEYS = {'target', 'kind', 'offset', 'amp', 'cycles', 'phase', 'warp',
                'values', 'of'}
MOTION_KINDS = ('const', 'sin', 'cos', 'raised-cos', 'square', 'arc', 'values',
                'volume')
TARGETS = ('scale', 'dx', 'dy', 'rotate_deg', 'squash_x', 'squash_y')
REMARK_KINDS = ('pet', 'petCooldown', 'feed', 'feedCooldown', 'noTreats')
PREVIEW_STYLES = ('classic', 'pack', 'sheet')
BLINK_STAGES = ('before', 'after')


class SpecError(Exception):
    """A recipe is missing, malformed or self-contradictory."""


def spec_file(name):
    """Accept an id, a bare filename or a path."""
    text = str(name)
    if text.endswith('.json') or '/' in text or '\\' in text:
        path = Path(text)
        return path if path.is_absolute() else ROOT / path
    return SPEC_DIR / (text + '.json')


def spec_paths():
    """Every recipe on disk, in a stable order."""
    return sorted(SPEC_DIR.glob('*.json'))


def _unknown(mapping, allowed):
    return sorted(set(mapping) - set(allowed))


def _check_channel(where, channel, problems):
    if not isinstance(channel, dict):
        problems.append(where + ': not an object')
        return
    bad = _unknown(channel, CHANNEL_KEYS)
    if bad:
        problems.append(where + ': unknown keys ' + ', '.join(bad))
    target = channel.get('target')
    if target not in TARGETS:
        problems.append(where + ': target must be one of ' + ', '.join(TARGETS))
    kind = channel.get('kind', 'sin')
    if kind not in MOTION_KINDS:
        problems.append(where + ': unknown kind ' + str(kind))
        return
    if kind == 'const' and not isinstance(channel.get('offset'), (int, float)):
        problems.append(where + ': const needs a numeric offset')
    if kind == 'values' and not isinstance(channel.get('values'), str):
        problems.append(where + ': values needs a vector name')
    if kind == 'volume':
        if channel.get('of') not in TARGETS:
            problems.append(where + ': volume needs of=<target>')
        elif channel.get('of') == target:
            problems.append(where + ': volume cannot read itself')


def _check_blink(where, blink, count, problems):
    if isinstance(blink, list):
        if len(blink) != count:
            problems.append('%s: blink list is %d long, frames are %d'
                            % (where, len(blink), count))
        return
    if not isinstance(blink, dict):
        problems.append(where + ': blink must be an index->amount object or a list')
        return
    for key, value in blink.items():
        if not str(key).isdigit():
            problems.append('%s: blink key %s is not a frame index' % (where, key))
        elif not 0 <= int(key) < count:
            problems.append('%s: blink index %s is outside the track' % (where, key))
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append('%s: blink value %r is not a number' % (where, key))


def _timing(where, track, timing_key, problems):
    """Per-frame milliseconds; the count of frames a track has lives here."""
    timing = track.get(timing_key)
    if timing is None:
        problems.append(where + ': needs ' + timing_key)
        return None, None
    if isinstance(timing, dict):
        bad = _unknown(timing, {'value', 'override', 'count'})
        if bad or 'value' not in timing:
            problems.append(where + ': ' + timing_key +
                            ' object takes value, override and count only')
            return None, None
        override = timing.get('override', {})
        if not isinstance(override, dict) or any(not str(k).isdigit() for k in override):
            problems.append(where + ': ' + timing_key + '.override is an index->ms object')
            return None, None
        longest = max([int(k) for k in override] + [-1]) + 1
        count = timing.get('count', longest)
        if not isinstance(count, int) or isinstance(count, bool) or count < longest:
            problems.append(where + ': ' + timing_key + '.count must cover every override')
            return None, None
        ms = [override.get(str(i), timing['value']) for i in range(count)]
    elif isinstance(timing, list) and timing:
        ms = list(timing)
        count = len(ms)
    else:
        problems.append(where + ': ' + timing_key + ' must be a non-empty list or '
                        '{"value": ms, "override": {index: ms}, "count": n}')
        return None, None
    if any(isinstance(v, bool) or not isinstance(v, int) for v in ms):
        problems.append(where + ': ' + timing_key + ' must be whole milliseconds')
        return None, None
    return ms, count


def _check_track(where, track, timing_key, problems, allowed=TRACK_KEYS, copied=False):
    if not isinstance(track, dict):
        problems.append(where + ': not an object')
        return
    bad = _unknown(track, allowed)
    if bad:
        problems.append(where + ': unknown keys ' + ', '.join(bad))
    ms, count = _timing(where, track, timing_key, problems)
    if copied:
        for key in ('poses', 'motion', 'blink', 'vectors'):
            if key in track:
                problems.append('%s: a copied row cannot also carry %s' % (where, key))
        return

    poses = track.get('poses')
    motion = track.get('motion')
    if poses is not None and motion is not None:
        problems.append(where + ': use either poses or motion, not both')
        return
    if poses is None and motion is None:
        problems.append(where + ': needs poses or motion')
        return
    if poses is not None:
        if not isinstance(poses, list) or not poses:
            problems.append(where + ': poses must be a non-empty list')
            return
        for i, pose in enumerate(poses):
            if not isinstance(pose, dict):
                problems.append('%s: pose %d is not an object' % (where, i))
                continue
            bad = _unknown(pose, TARGETS)
            if bad:
                problems.append('%s: pose %d has unknown keys %s' % (where, i, ', '.join(bad)))
        count = len(poses)
        if ms is not None and len(ms) != count:
            problems.append('%s: %d poses but %d timings' % (where, count, len(ms)))
    else:
        if not isinstance(motion, list) or not motion:
            problems.append(where + ': motion must be a non-empty list')
            return
        for i, channel in enumerate(motion):
            _check_channel('%s: motion[%d]' % (where, i), channel, problems)

    vectors = track.get('vectors', {})
    if not isinstance(vectors, dict):
        problems.append(where + ': vectors must be an object of number lists')
        vectors = {}
    for name, vector in vectors.items():
        if not isinstance(vector, list) or len(vector) != count:
            problems.append('%s: vector %s must hold %d numbers' % (where, name, count))
    for channel in (motion or []):
        if isinstance(channel, dict) and channel.get('kind') == 'values':
            if channel.get('values') not in vectors:
                problems.append('%s: vector %s is not defined' % (where, channel.get('values')))
    if track.get('blink') is not None:
        _check_blink(where, track['blink'], count, problems)
    fallback = track.get('fallback')
    if fallback is not None and not isinstance(fallback, str):
        problems.append(where + ': fallback must be a track name')


def _check_frames2d(block, problems):
    bad = _unknown(block, FRAMES2D_KEYS)
    if bad:
        problems.append('outputs.frames2d: unknown keys ' + ', '.join(bad))
    if block.get('blinkStage', 'before') not in BLINK_STAGES:
        problems.append('outputs.frames2d: blinkStage must be before or after')
    tracks = block.get('tracks')
    if not isinstance(tracks, dict) or not tracks:
        problems.append('outputs.frames2d: tracks must be a non-empty object')
        return
    for track_name, track in tracks.items():
        if not ID_PATTERN.match(str(track_name)):
            problems.append('outputs.frames2d: track name %r is not lowercase kebab'
                            % track_name)
        _check_track('outputs.frames2d.tracks.%s' % track_name, track,
                     'frameMs', problems)
    phases = block.get('phases')
    if phases is None:
        missing = [p for p in PHASE_NAMES if p not in tracks]
        if missing:
            problems.append('outputs.frames2d: no phases block, and tracks do not '
                            'cover ' + ', '.join(missing))
        return
    bad = _unknown(phases, PHASE_NAMES)
    if bad:
        problems.append('outputs.frames2d.phases: unknown phases ' + ', '.join(bad))
    for phase, target in phases.items():
        if target not in tracks:
            problems.append('outputs.frames2d.phases.%s: no such track %r'
                            % (phase, target))
    if 'idle' not in phases:
        problems.append('outputs.frames2d.phases: idle is required')


def _check_sprite2d(block, problems):
    bad = _unknown(block, SPRITE2D_KEYS)
    if bad:
        problems.append('outputs.sprite2d: unknown keys ' + ', '.join(bad))
    sheet = block.get('spritesheet')
    if not isinstance(sheet, str) or not SEGMENT_PATTERN.match(sheet):
        problems.append('outputs.sprite2d: spritesheet must be a bare file name')
    if 'columns' in block and block['columns'] != 8:
        problems.append('outputs.sprite2d: columns must be 8, the engine row width')
    if block.get('blinkStage', 'before') not in BLINK_STAGES:
        problems.append('outputs.sprite2d: blinkStage must be before or after')
    row_names = block.get('rowNames')
    if row_names is not None:
        if not isinstance(row_names, list) or not row_names:
            problems.append('outputs.sprite2d: rowNames must be a non-empty list')
        elif len(row_names) not in (9, 11):
            problems.append('outputs.sprite2d: rowNames must describe 9 or 11 rows')
    rows = block.get('rows')
    if rows is None:
        if block.get('source') != 'sheet':
            problems.append('outputs.sprite2d: needs rows ("default" for the '
                            'standard nine-row pack), or source: "sheet" for an '
                            'atlas that is supplied instead of built')
        elif not isinstance(block.get('tracks'), dict):
            problems.append('outputs.sprite2d: a sheet pet must declare its tracks')
        return
    if block.get('source') == 'sheet':
        problems.append('outputs.sprite2d: source: "sheet" has nothing to render')
    if block.get('tracks') is not None:
        problems.append('outputs.sprite2d: tracks are derived from rows; drop the block')
    if rows == 'default':
        return
    if not isinstance(rows, dict) or not rows:
        problems.append('outputs.sprite2d: rows must be a non-empty object')
        return
    canonical = row_names or ROW_NAMES
    for row_name, row in rows.items():
        where = 'outputs.sprite2d.rows.%s' % row_name
        if row_name not in canonical:
            problems.append(where + ': not a declared row')
        if not isinstance(row, dict):
            problems.append(where + ': not an object')
            continue
        copied = 'from' in row
        _check_track(where, row, 'durations', problems,
                     allowed=COPIED_ROW_KEYS if copied else ROW_KEYS, copied=copied)
    if 'idle' not in rows:
        problems.append('outputs.sprite2d.rows: idle is required')


def problems(spec, path=None):
    """Every reason this recipe cannot be built, as readable lines."""
    found = []
    if not isinstance(spec, dict):
        return ['recipe must be a JSON object']
    bad = _unknown(spec, TOP_KEYS)
    if bad:
        found.append('unknown keys ' + ', '.join(bad))
    for key in ('id', 'displayName', 'description', 'outputs'):
        if key not in spec:
            found.append('missing ' + key)
    if found:
        return found
    if not ID_PATTERN.match(str(spec['id'])):
        found.append('id must be lowercase kebab, at most 64 characters')
    elif path is not None and Path(path).stem != spec['id']:
        found.append('id %r must match the file name %r' % (spec['id'], Path(path).name))
    if not str(spec['displayName']).strip():
        found.append('displayName must not be empty')
    if not str(spec['description']).strip():
        found.append('description must not be empty')
    if 'version' in spec and not re.fullmatch(r'\d+\.\d+\.\d+', str(spec['version'])):
        found.append('version must be three numbers')

    base = spec.get('base')
    if base is not None and not (ROOT / base).is_file():
        found.append('base image not found: ' + str(base))
    eyes = spec.get('eyes')
    if isinstance(eyes, str) and not (ROOT / eyes).is_file():
        found.append('eye regions not found: ' + str(eyes))

    outputs = spec['outputs']
    if not isinstance(outputs, dict) or not outputs:
        found.append('outputs must be a non-empty object')
        return found
    unknown = _unknown(outputs, OUTPUT_KINDS)
    if unknown:
        found.append('outputs: unknown kinds ' + ', '.join(unknown))
    for kind, block in outputs.items():
        if kind not in OUTPUT_KINDS:
            continue
        if not isinstance(block, dict):
            found.append('outputs.%s must be an object' % kind)
            continue
        pet_id = block.get('petId', spec['id'])
        if not ID_PATTERN.match(str(pet_id)):
            found.append('outputs.%s.petId must be lowercase kebab' % kind)
        if base is None and block.get('source') != 'sheet':
            found.append('outputs.%s needs a base image' % kind)
        (_check_frames2d if kind == 'frames2d' else _check_sprite2d)(block, found)

    previews = spec.get('previews')
    if previews is not None:
        if not isinstance(previews, dict):
            found.append('previews must be an object')
        else:
            bad = _unknown(previews, PREVIEW_KEYS)
            if bad:
                found.append('previews: unknown keys ' + ', '.join(bad))
            style = previews.get('style')
            if style not in PREVIEW_STYLES:
                found.append('previews.style must be one of ' + ', '.join(PREVIEW_STYLES))
            elif style == 'classic' and ('frames2d' not in outputs
                                         or 'sprite2d' not in outputs):
                found.append('previews.style classic needs both a frames2d output and '
                             'a sprite2d output for its atlas copy')
            elif style in ('pack', 'sheet') and 'sprite2d' not in outputs:
                found.append('previews.style ' + style + ' needs a sprite2d output')
            elif style == 'pack' and not spec.get('base'):
                found.append('previews.style pack draws the base image, so a pet with '
                             'a supplied atlas wants previews.style sheet')
            after = previews.get('after')
            if after is not None and (not isinstance(after, list)
                                      or not all(isinstance(v, str) for v in after)):
                found.append('previews.after must be a list of row or track names')
    remarks = spec.get('remarks')
    if remarks is not None:
        if not isinstance(remarks, dict):
            found.append('remarks must be an object')
        else:
            bad = _unknown(remarks, REMARK_KINDS)
            if bad:
                found.append('remarks: unknown slots ' + ', '.join(bad))
    return found


def load_spec(source):
    """Read one recipe, raising SpecError with every problem it found."""
    path = spec_file(source)
    if not path.is_file():
        raise SpecError('recipe not found: ' + str(path))
    try:
        spec = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise SpecError('%s: not valid JSON: %s' % (path, exc)) from exc
    found = problems(spec, path)
    if found:
        raise SpecError('%s:\n  - %s' % (path, '\n  - '.join(found)))
    return spec


def pet_dirs(spec):
    """(kind, petId, directory) for every pet directory this recipe owns."""
    out = []
    for kind in OUTPUT_KINDS:
        block = spec['outputs'].get(kind)
        if block is None:
            continue
        out.append((kind, block.get('petId', spec['id']),
                    PET_DIR / block.get('petId', spec['id'])))
    return out


def output(spec, kind):
    return spec['outputs'].get(kind)


def path_of(block, key, default=None):
    """Resolve an optional repo-relative path from a recipe block."""
    value = block.get(key, default)
    if value is None:
        return None
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def base_of(spec):
    """The character's base image, opened and normalised to 192x208 RGBA."""
    from PIL import Image

    base = path_of(spec, 'base')
    if base is None:
        raise SpecError('this recipe has no base image')
    image = Image.open(base).convert('RGBA')
    if image.size != (192, 208):
        raise SpecError('base image must be 192x208, got %dx%d at %s'
                        % (image.size[0], image.size[1], base))
    return image


def eyes_of(spec):
    """Eye regions as [(cx, cy, w, h)], either inline or from a JSON file."""
    eyes = spec.get('eyes')
    if eyes is None:
        return []
    if isinstance(eyes, str):
        eyes = json.loads((ROOT / eyes).read_text(encoding='utf-8'))['eyes']
    return [tuple(float(v) for v in region) for region in eyes]


def timing(track, key):
    """A track's per-frame milliseconds, expanding the {"value", "override"} form."""
    value = track[key]
    if isinstance(value, list):
        return list(value)
    override = value.get('override', {})
    longest = max([int(k) for k in override] + [-1]) + 1
    count = value.get('count', longest)
    return [int(override.get(str(i), value['value'])) for i in range(count)]
