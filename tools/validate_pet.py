from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

PET_ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
SEGMENT_PATTERN = re.compile(r'^[A-Za-z0-9._-]+$')
TRACK_NAME_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]{0,31}$')
VERSION_PATTERN = re.compile(r'^\d+\.\d+\.\d+$')
TOP_KEYS = {'$schema', 'petManifestVersion', 'id', 'displayName', 'description',
            'version', 'author', 'license', 'homepage', 'renderer', 'sprite2d',
            'live2d', 'frames2d', 'sequences', 'remarks', 'gameplay'}
FLAT_KEYS = {'id', 'displayName', 'description', 'spritesheetPath', 'spriteVersionNumber',
             'cell', 'columns', 'frames', 'tracks', 'sequences', 'remarks'}
VOICE_KEYS = {'$schema', 'voicePackVersion', 'status', 'tools', 'toolRemaining',
              'whispers', 'panel', 'remarks', 'ranks'}
SCENES = {'prepare', 'waiting', 'thinking', 'review', 'toolResult', 'done',
          'failed', 'toolFailed', 'maxTokens', 'interrupted', 'blocked'}
REMARK_KINDS = {'pet', 'petCooldown', 'feed', 'feedCooldown', 'noTreats'}
PHASE_KEYS = {'idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'}
ROW_NAMES = ['idle', 'running-right', 'running-left', 'waving', 'jumping',
             'failed', 'waiting', 'running', 'review']
WHISPER_CATEGORY_KEYS = {'thinking', 'writing', 'reading', 'editing', 'running',
                         'searching', 'git', 'delegating', 'browsing', 'generic'}
WHISPER_RESULT_KEYS = {'pass', 'fail', 'done'}
RENDERERS = {'sprite2d', 'live2d', 'frames2d'}
PANEL_ACTIONS = {'feed', 'rename', 'hide'}
LOSSLESS_FORMATS = {'PNG', 'WEBP'}
MS_MIN, MS_MAX = 16, 5000
CELL_W, CELL_H, COLS, ROWS = 192, 208, 8, 9
DEFAULT_FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6]
POOL_MAX, LINE_MAX = 64, 160
REMARK_LINE_MAX = 120
LABEL_MAX, STAT_MAX = 40, 80


class Report:
    def __init__(self, pet_id):
        self.pet_id = pet_id
        self.checks = []

    def add(self, check, ok, detail=''):
        self.checks.append({'check': check, 'ok': bool(ok), 'detail': detail})

    def failures(self):
        return [c['check'] for c in self.checks if not c['ok']]

    @property
    def ok(self):
        return not self.failures()


def _flatten_v2_sprite2d(doc):
    block = doc.get('sprite2d') or {}
    flat = {'id': doc.get('id'), 'displayName': doc.get('displayName'),
            'description': doc.get('description'),
            'spritesheetPath': block.get('spritesheetPath')}
    for key in ('cell', 'columns', 'frames', 'tracks'):
        if key in block:
            flat[key] = block[key]
    if block.get('atlasRows') == 11:
        flat['spriteVersionNumber'] = 2
    for key in ('sequences', 'remarks'):
        if key in doc:
            flat[key] = doc[key]
    return flat


def check_manifest(doc, report):
    report.add('id-lowercase-kebab',
               isinstance(doc.get('id'), str) and bool(PET_ID_PATTERN.fullmatch(doc['id'])),
               str(doc.get('id')))
    report.add('display-name-present',
               isinstance(doc.get('displayName'), str) and doc['displayName'].strip() != '')
    report.add('description-present',
               isinstance(doc.get('description'), str) and doc['description'].strip() != '')
    if doc.get('petManifestVersion') == 2:
        extras = ', '.join(sorted(set(doc) - TOP_KEYS))
        report.add('v2-top-level-allow-list', not extras, extras)
        renderer = doc.get('renderer', 'sprite2d')
        report.add('renderer-enum', renderer in RENDERERS, str(renderer))
        report.add('renderer-block-present', isinstance(doc.get(renderer), dict),
                   str(type(doc.get(renderer)).__name__))
        report.add('version-three-part',
                   bool(VERSION_PATTERN.fullmatch(doc.get('version', ''))),
                   str(doc.get('version')))
        report.add('license-present',
                   isinstance(doc.get('license'), str) and doc['license'].strip() != '')
        return 'v2'
    extras = ', '.join(sorted(set(doc) - FLAT_KEYS))
    report.add('flat-top-level-allow-list', not extras, extras)
    return 'v1-flat'


def check_frames2d(pet_dir, block, report):
    tracks = block.get('tracks')
    phases = block.get('phases')
    report.add('frames2d-tracks-present', isinstance(tracks, dict) and bool(tracks))
    report.add('frames2d-phases-present', isinstance(phases, dict) and 'idle' in (phases or {}))
    if not isinstance(tracks, dict) or not isinstance(phases, dict):
        return
    report.add('frames2d-phase-keys-allowed', set(phases) <= PHASE_KEYS,
               ', '.join(sorted(set(phases) - PHASE_KEYS)))
    bad = [k for k, v in phases.items() if not isinstance(v, str) or v not in tracks]
    report.add('frames2d-phases-map-to-tracks', not bad, ', '.join(bad))
    bad_names = [t for t in tracks if not TRACK_NAME_PATTERN.fullmatch(t)]
    report.add('frames2d-track-names-kebab', not bad_names, ', '.join(bad_names))
    frame_dir = block.get('dir', '.')
    problems = []
    for track, entry in tracks.items():
        frames = entry.get('frames', [])
        frame_ms = entry.get('frameMs', [])
        if not isinstance(frames, list) or not frames:
            problems.append(track + ':no-frames')
            continue
        if len(frames) != len(frame_ms):
            problems.append(track + ':frames-frameMs-mismatch')
        for ms in frame_ms:
            if not isinstance(ms, int) or not (MS_MIN <= ms <= MS_MAX):
                problems.append(track + ':frameMs-out-of-range')
        for name in frames:
            if (not isinstance(name, str) or '/' in name or chr(92) in name
                    or not SEGMENT_PATTERN.fullmatch(name)):
                problems.append(track + ':unsafe-name')
                continue
            if not (pet_dir / frame_dir / track / name).exists():
                problems.append(track + '/' + name + ':missing')
        if entry.get('loop') is False:
            fallback = entry.get('fallback')
            target = tracks.get(fallback)
            if not (isinstance(fallback, str) and isinstance(target, dict)
                    and target.get('loop', True) is not False):
                problems.append(track + ':fallback-invalid')
    report.add('frames2d-track-content', not problems, '; '.join(problems))


def check_sprite2d(pet_dir, doc, report):
    rel = doc.get('spritesheetPath', 'spritesheet.webp')
    segments = [s for s in rel.split('/') if s]
    safe = (isinstance(rel, str) and bool(segments) and chr(92) not in rel
            and '..' not in segments
            and all(SEGMENT_PATTERN.fullmatch(s) for s in segments))
    report.add('spritesheet-path-safe', safe, str(rel))
    sheet = pet_dir / rel
    report.add('spritesheet-exists', sheet.exists())
    if not safe or not sheet.exists():
        return
    img = Image.open(sheet)
    # Both PNG and WEBP are accepted by the engine and both are lossless. PNG is
    # what this project ships, because lossless WEBP does not preserve the RGB
    # of fully transparent pixels across a save/load round trip.
    report.add('spritesheet-format-lossless', img.format in LOSSLESS_FORMATS, str(img.format))
    report.add('spritesheet-mode-rgba', img.mode == 'RGBA', img.mode)
    columns = doc.get('columns', COLS)
    atlas_rows = 11 if doc.get('spriteVersionNumber') == 2 else ROWS
    frames = doc.get('frames', DEFAULT_FRAME_COUNTS)
    expected = (columns * CELL_W, atlas_rows * CELL_H)
    report.add('spritesheet-size', img.size == expected,
               str(img.size) + ' expected ' + str(expected))
    report.add('atlas-rows-classic-9', atlas_rows == 9, 'atlasRows=' + str(atlas_rows))
    report.add('frames-within-columns',
               all(isinstance(n, int) and 0 <= n <= columns for n in frames),
               str(frames))
    arr = np.asarray(img.convert('RGBA'))
    problems = []
    for row, used in enumerate(frames):
        for col in range(columns):
            cell = arr[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W]
            filled = int((cell[:, :, 3] > 0).sum())
            if col < used:
                if filled == 0:
                    problems.append('r%d-c%d:empty-used-cell' % (row, col))
            elif filled != 0:
                problems.append('r%d-c%d:content-in-unused-cell' % (row, col))
            elif int(cell[:, :, :3].max()) != 0:
                problems.append('r%d-c%d:rgb-residue' % (row, col))
    report.add('spritesheet-cell-content', not problems, '; '.join(problems[:12]))


def check_atlas_matches_spec(doc, report):
    spec_path = ROOT / 'assets' / 'derived' / 'atlas-spec.json'
    if not spec_path.exists():
        report.add('atlas-spec-cross-check-skipped', True, 'atlas-spec.json absent')
        return
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    report.add('atlas-frames-match-spec', doc.get('frames') == spec.get('frames'),
               str(doc.get('frames')) + ' vs ' + str(spec.get('frames')))
    report.add('atlas-row-names-match-spec', spec.get('rowNames') == ROW_NAMES,
               str(spec.get('rowNames')))


def check_sequences(doc, report):
    seqs = doc.get('sequences')
    if seqs is None:
        report.add('sequences-absent-ok', True)
        return
    report.add('sequences-is-object', isinstance(seqs, dict))
    if not isinstance(seqs, dict):
        return
    problems = []
    for phase, seq in seqs.items():
        if phase not in PHASE_KEYS:
            problems.append(phase + ':unknown-phase')
            continue
        if not isinstance(seq, list) or len(seq) < 5:
            problems.append(phase + ':needs-at-least-5')
            continue
        for name in seq:
            if name not in ROW_NAMES:
                problems.append(phase + ':' + str(name) + ':not-a-row-name')
    report.add('sequences-valid', not problems, '; '.join(problems))


def check_remarks(doc, report):
    remarks = doc.get('remarks')
    if remarks is None:
        report.add('remarks-absent-ok', True)
        return
    problems = []
    if not isinstance(remarks, dict):
        problems.append('remarks:not-an-object')
    else:
        unknown = ', '.join(sorted(set(remarks) - REMARK_KINDS))
        if unknown:
            problems.append('remarks:unknown-slot:' + unknown)
        for slot, pool in remarks.items():
            if not isinstance(pool, list) or not (1 <= len(pool) <= POOL_MAX):
                problems.append(slot + ':pool-size')
                continue
            for line in pool:
                if not isinstance(line, str) or len(line) > REMARK_LINE_MAX:
                    problems.append(slot + ':line-policy')
    report.add('remarks-valid', not problems, '; '.join(problems))


def _tokens(text):
    found = []
    start = -1
    for index, ch in enumerate(text):
        if ch == '{':
            start = index
        elif ch == '}' and start >= 0:
            found.append(text[start:index + 1])
            start = -1
    return found


def check_voice(pet_dir, report):
    path = pet_dir / 'voice.json'
    if not path.exists():
        report.add('voice-absent-ok', True)
        return
    try:
        doc = json.loads(path.read_text(encoding='utf-8'))
        report.add('voice-valid-json', True)
    except Exception as exc:
        report.add('voice-valid-json', False, str(exc))
        return
    report.add('voice-is-object', isinstance(doc, dict))
    if not isinstance(doc, dict):
        return
    extras = ', '.join(sorted(set(doc) - VOICE_KEYS))
    report.add('voice-top-level-allow-list', not extras, extras)
    problems = []
    status = doc.get('status')
    if status is not None:
        if not isinstance(status, dict):
            problems.append('status:not-an-object')
        else:
            for key, pool in status.items():
                if key not in SCENES:
                    problems.append('status.' + key + ':unknown-scene')
                    continue
                if not isinstance(pool, list) or not (1 <= len(pool) <= POOL_MAX):
                    problems.append('status.' + key + ':pool-size')
                    continue
                for line in pool:
                    if not isinstance(line, str):
                        problems.append('status.' + key + ':non-string')
                    elif '{' in line or len(line) > LINE_MAX:
                        problems.append('status.' + key + ':line-policy')
    whispers = doc.get('whispers')
    if whispers is not None:
        if not isinstance(whispers, dict) or set(whispers) - {'categories', 'results'}:
            problems.append('whispers:unknown-subkey')
        elif isinstance(whispers, dict):
            for group, kinds in (('categories', WHISPER_CATEGORY_KEYS),
                                 ('results', WHISPER_RESULT_KEYS)):
                sub = whispers.get(group)
                if isinstance(sub, dict):
                    bad = ', '.join(sorted(set(sub) - kinds))
                    if bad:
                        problems.append('whispers.' + group + ':unknown-key:' + bad)
    panel = doc.get('panel') or {}
    for key, value in (panel.get('labels') or {}).items():
        if not isinstance(value, str) or '{' in value or len(value) > LABEL_MAX:
            problems.append('panel.labels.' + key + ':policy')
    allowed_tokens = {'{rank}', '{n}', '{points}'}
    for key, value in (panel.get('stats') or {}).items():
        tokens = _tokens(value if isinstance(value, str) else '')
        if not isinstance(value, str) or len(value) > STAT_MAX or set(tokens) - allowed_tokens:
            problems.append('panel.stats.' + key + ':policy')
    actions = panel.get('actions')
    if actions is not None and (not isinstance(actions, list) or set(actions) - PANEL_ACTIONS):
        problems.append('panel.actions:policy')
    report.add('voice-content-policy', not problems, '; '.join(problems))


def validate_pet_dir(pet_dir):
    report = Report(Path(pet_dir).name)
    pet_json = Path(pet_dir) / 'pet.json'
    report.add('pet-json-exists', pet_json.exists())
    if not pet_json.exists():
        return report
    try:
        doc = json.loads(pet_json.read_text(encoding='utf-8'))
        report.add('pet-json-valid-json', isinstance(doc, dict))
    except Exception as exc:
        report.add('pet-json-valid-json', False, str(exc))
        return report
    if not isinstance(doc, dict):
        return report
    style = check_manifest(doc, report)
    if style == 'v2' and doc.get('renderer') == 'frames2d':
        check_frames2d(pet_dir, doc.get('frames2d') or {}, report)
    else:
        flat = _flatten_v2_sprite2d(doc) if style == 'v2' else doc
        check_sprite2d(pet_dir, flat, report)
        check_atlas_matches_spec(flat, report)
    check_sequences(doc, report)
    check_remarks(doc, report)
    check_voice(pet_dir, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Validate a desktop pet directory.')
    parser.add_argument('pet_dir')
    args = parser.parse_args(argv)
    pet_dir = Path(args.pet_dir).resolve()
    report = validate_pet_dir(pet_dir)
    out = {'petId': report.pet_id, 'ok': report.ok,
           'fails': report.failures(), 'checks': report.checks}
    (pet_dir / 'validation.json').write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + chr(10), encoding='utf-8')
    print('petId', report.pet_id)
    print('ok', report.ok)
    print('checks', len(report.checks))
    for name in report.failures():
        print('FAIL', name)
    return 0 if report.ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
