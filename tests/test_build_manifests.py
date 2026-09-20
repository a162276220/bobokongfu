import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOP_KEYS = {'$schema', 'petManifestVersion', 'id', 'displayName', 'description',
            'version', 'author', 'license', 'homepage', 'renderer', 'sprite2d',
            'live2d', 'frames2d', 'sequences', 'remarks', 'gameplay'}
PHASE_KEYS = {'idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'}
ROW_NAMES = ['idle', 'running-right', 'running-left', 'waving', 'jumping',
             'failed', 'waiting', 'running', 'review']
REMARK_KINDS = {'pet', 'petCooldown', 'feed', 'feedCooldown', 'noTreats'}


def _f2():
    return json.loads((ROOT / 'pet' / 'huhu-carrot' / 'pet.json').read_text(encoding='utf-8'))


def _s2():
    return json.loads((ROOT / 'pet' / 'huhu-carrot-office' / 'pet.json').read_text(encoding='utf-8'))


def _voice(name):
    return json.loads((ROOT / 'pet' / name / 'voice.json').read_text(encoding='utf-8'))


def test_frames2d_manifest_stays_inside_the_v2_top_level_allow_list():
    doc = _f2()
    assert set(doc) <= TOP_KEYS
    assert doc['petManifestVersion'] == 2
    assert doc['renderer'] == 'frames2d'
    assert re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', doc['id'])
    assert re.fullmatch(r'\d+\.\d+\.\d+', doc['version'])
    assert doc['license']


def test_frames2d_phases_cover_all_seven_activity_phases():
    doc = _f2()
    tracks = doc['frames2d']['tracks']
    assert set(doc['frames2d']['phases']) == PHASE_KEYS
    assert set(tracks) == PHASE_KEYS
    for name, entry in tracks.items():
        assert entry['frames']
        assert len(entry['frames']) == len(entry['frameMs'])
        assert all(16 <= v <= 5000 for v in entry['frameMs'])
        if entry['loop'] is False:
            assert entry['fallback'] in tracks
            assert tracks[entry['fallback']]['loop'] is not False


def test_frames2d_track_files_exist_on_disk():
    doc = _f2()
    base = ROOT / 'pet' / 'huhu-carrot' / doc['frames2d']['dir']
    for track, entry in doc['frames2d']['tracks'].items():
        for name in entry['frames']:
            assert re.fullmatch(r'[A-Za-z0-9._-]+', name)
            assert '/' not in name
            assert (base / track / name).exists()


VOICE_KEYS = {'$schema', 'voicePackVersion', 'status', 'tools', 'toolRemaining',
              'whispers', 'panel', 'remarks', 'ranks'}
SCENES = {'prepare', 'waiting', 'thinking', 'review', 'toolResult', 'done',
          'failed', 'toolFailed', 'maxTokens', 'interrupted', 'blocked'}


def test_sprite2d_manifest_uses_the_flat_legacy_shape():
    doc = _s2()
    assert 'renderer' not in doc
    assert 'sprite2d' not in doc
    assert 'petManifestVersion' not in doc
    assert 'spriteVersionNumber' not in doc
    assert doc['spritesheetPath'] == 'spritesheet-win-1.png'
    assert doc['cell'] == {'width': 192, 'height': 208}
    assert doc['columns'] == 8
    assert doc['frames'] == [8, 8, 6, 6, 4, 4, 6, 6, 6]
    assert all(n <= doc['columns'] for n in doc['frames'])
    assert set(doc['tracks']) == set(ROW_NAMES)
    assert (ROOT / 'pet' / 'huhu-carrot-office' / doc['spritesheetPath']).exists()


def test_sprite2d_sequences_are_five_valid_row_names():
    doc = _s2()
    assert doc['sequences']
    for phase, seq in doc['sequences'].items():
        assert phase in PHASE_KEYS
        assert len(seq) >= 5
        assert all(name in ROW_NAMES for name in seq)


def test_non_looping_tracks_declare_a_looping_fallback():
    doc = _s2()
    for name, entry in doc['tracks'].items():
        durations = entry.get('durations')
        if durations:
            assert all(16 <= v <= 5000 for v in durations)
            assert len(durations) <= doc['columns']
        if entry.get('loop') is False:
            assert entry.get('fallback') in doc['tracks']


def test_voice_pack_keys_and_placeholder_policy():
    for name in ('huhu-carrot', 'huhu-carrot-office'):
        doc = _voice(name)
        assert set(doc) <= VOICE_KEYS
        assert doc['voicePackVersion'] == 1
        assert set(doc['status']) <= SCENES
        assert set(doc['whispers']) <= {'categories', 'results'}
        for pool in doc['status'].values():
            assert 0 < len(pool) <= 64
        for line in sum(doc['status'].values(), []):
            assert '{' not in line
            assert len(line) <= 160
        assert all(len(v) <= 40 for v in doc['panel']['labels'].values())
        assert all(len(v) <= 80 for v in doc['panel']['stats'].values())
        assert set(doc['panel']['actions'] ) <= {'feed', 'rename', 'hide'}
        assert any('{n}' in v for v in doc['panel']['stats'].values())


def test_remarks_slots_are_within_the_engine_allow_list():
    for doc in (_f2(), _s2()):
        assert set(doc['remarks']) <= REMARK_KINDS
        assert 'pet' in doc['remarks']
        for pool in doc['remarks'].values():
            assert 0 < len(pool) <= 64
            assert all(len(line) <= 120 for line in pool)
