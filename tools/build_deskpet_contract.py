"""Regenerate the workbench's pet contract from the manifests that ship.

``淘金矿工小屋/deskpet-players.js`` used to carry a hand-copied summary of every
pet.json ("改 pet/ 后需手工同步"), which was tolerable for four pets and is a
silent rot risk for sixteen. The workbench opens over file://, so it cannot
fetch the manifests at runtime -- but it can be handed a contract a build step
wrote from them. This is that step; tests/test_deskpet_contract.py keeps it
honest with --check.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import validate_pet as V  # noqa: E402  (resolve_row_names)
from petkit import emit  # noqa: E402  (row_durations, _painted_columns)

ROOT = TOOLS.parent
PET_DIR = ROOT / 'pet'
PLAYERS = ROOT / '淘金矿工小屋' / 'deskpet-players.js'
MARK = 'PET-SPECS'
CELL = {'w': 192, 'h': 208}
DEFAULT_FRAME_MS = 200
# The workbench drives pets through eight semantic moods; a pet answers each one
# with the best row it actually has, walking the candidates in order. The mood's
# own name leads, so a pet that literally ships a thinking track uses it.
MAP_CANDIDATES = {
    'idle': ['idle'],
    'waiting': ['waiting', 'gaze-1', 'review', 'idle'],
    'thinking': ['thinking', 'running', 'gaze-1', 'review', 'idle'],
    'tool': ['tool', 'running', 'review', 'running-right', 'idle'],
    'review': ['review', 'running', 'idle'],
    'done': ['done', 'waving', 'jumping', 'idle'],
    'failed': ['failed', 'jumping', 'idle'],
    'cheer': ['cheer', 'done', 'jumping', 'waving', 'idle'],
}
# A supplied atlas that declares no kinds still plays failed as a reaction rather
# than a loop -- the same call the engine makes.
ONE_SHOT_DEFAULT = {'failed'}


def key(name):
    return name if re.fullmatch(r'[A-Za-z_$][\w$]*', name) else json.dumps(name)


def js(value, indent=''):
    """Serialise a spec fragment as readable JS with unquoted keys."""
    pad = indent + '  '
    if isinstance(value, dict):
        if not value:
            return '{}'
        return '{\n%s\n%s}' % (
            ',\n'.join('%s%s: %s' % (pad, key(k), js(v, pad)) for k, v in value.items()),
            indent)
    if isinstance(value, list):
        if not value:
            return '[]'
        if all(isinstance(v, str) for v in value):
            return '[' + ', '.join(json.dumps(v, ensure_ascii=False) for v in value) + ']'
        if all(isinstance(v, int) for v in value):
            return '[' + ', '.join(str(v) for v in value) + ']'
        return '[\n%s\n%s]' % (
            ',\n'.join('%s%s' % (pad, js(v, pad)) for v in value), indent)
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return json.dumps(value, ensure_ascii=False)


def sheet_spec(pet_id, doc):
    path = PET_DIR / pet_id / doc['spritesheetPath']
    with Image.open(path) as opened:
        rgba = opened.convert('RGBA')
        cols = max(1, rgba.width // CELL['w'])
        rows = max(1, rgba.height // CELL['h'])
        frames = [emit._painted_columns(rgba, index, cols) for index in range(rows)]
    names = V.resolve_row_names(doc, rows)
    declared = doc.get('tracks') or {}
    tracks = {}
    for index, name in enumerate(names):
        entry = declared.get(name) or {}
        kind = entry.get('kind') or ('once' if name in ONE_SHOT_DEFAULT else 'loop')
        track = {'ms': emit.row_durations(entry, name, frames[index], DEFAULT_FRAME_MS)}
        if kind != 'loop':
            track['loop'] = False
            track['fallback'] = entry.get('fallback') or 'idle'
        tracks[name] = track
    return {
        'kind': 'sheet',
        'cells': dict(CELL),
        'sheet': {
            'file': '%s/%s' % (pet_id, doc['spritesheetPath']),
            'cols': cols,
            'frames': frames,
            'rowNames': names,
            'tracks': tracks,
        },
        'map': _map(names),
    }


def frames2d_spec(pet_id, doc):
    block = doc['frames2d']
    tracks = {}
    for name, entry in block['tracks'].items():
        default = block.get('defaultFrameMs', DEFAULT_FRAME_MS)
        declared = [int(v) for v in (entry.get('frameMs') or [])]
        track = {'frames': list(entry['frames']),
                 'ms': [declared[i % len(declared)] if declared else default
                        for i in range(len(entry['frames']))]}
        if entry.get('loop') is False:
            track['loop'] = False
            if entry.get('fallback'):
                track['fallback'] = entry['fallback']
        tracks[name] = track
    return {
        'kind': 'frames2d',
        'cells': dict(CELL),
        'frames2d': {
            'dir': '%s/%s' % (pet_id, block.get('dir', 'frames')),
            'defaultFrameMs': block.get('defaultFrameMs', DEFAULT_FRAME_MS),
            'tracks': tracks,
        },
        'map': _map(list(tracks)),
    }


def _map(available):
    rows = set(available)
    return {mood: next((row for row in candidates if row in rows), 'idle')
            for mood, candidates in MAP_CANDIDATES.items()}


def specs():
    out = {}
    for manifest in sorted(PET_DIR.glob('*/pet.json')):
        pet_id = manifest.parent.name
        doc = json.loads(manifest.read_text(encoding='utf-8'))
        spec = (frames2d_spec(pet_id, doc) if doc.get('frames2d')
                else sheet_spec(pet_id, doc))
        out[pet_id] = {'name': doc.get('displayName') or pet_id, **spec}
    return out


def render():
    lines = ['  var PET_SPECS = {']
    for pet_id, spec in specs().items():
        lines.append('    %s: %s,' % (key(pet_id), js(spec, '    ')))
    lines.append('  };')
    return '\n'.join(lines)


BLOCK_RE = re.compile(r'  /\* %s:BEGIN\b.*?/\* %s:END \*/' % (MARK, MARK), re.S)


def replaced(text):
    block = ('  /* %s:BEGIN -- generated by tools/build_deskpet_contract.py, '
             'do not hand-edit */\n%s\n  /* %s:END */' % (MARK, render(), MARK))
    if BLOCK_RE.search(text):
        return text[:BLOCK_RE.search(text).start()] + block + \
            text[BLOCK_RE.search(text).end():]
    old = re.search(r'  var PET_SPECS = \{.*?\n  \};', text, re.S)
    if not old:
        raise SystemExit('deskpet-players.js has no PET_SPECS block to replace')
    return text[:old.start()] + block + text[old.end():]


def main(argv):
    text = PLAYERS.read_text(encoding='utf-8')
    new = replaced(text)
    if '--check' in argv:
        if new != text:
            print('PET_SPECS is out of sync with pet/*/pet.json -- '
                  'run tools/build_deskpet_contract.py')
            return 1
        print('PET_SPECS matches the manifests (%d pets)' % len(specs()))
        return 0
    PLAYERS.write_text(new, encoding='utf-8', newline='\n')
    print('%d pets written into %s' % (len(specs()),
                                       PLAYERS.relative_to(ROOT)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
