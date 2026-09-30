import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / 'tools' / 'validate_pet.py'
PETS = [ROOT / 'pet' / 'huhu-carrot', ROOT / 'pet' / 'huhu-carrot-office']


def _run(pet_dir):
    return subprocess.run([sys.executable, str(TOOL), str(pet_dir)],
                          capture_output=True, text=True, encoding='utf-8')


def _report(pet_dir):
    return json.loads((pet_dir / 'validation.json').read_text(encoding='utf-8'))


def _copy_to(pet_dir, target):
    dst = Path(target)
    shutil.copytree(pet_dir, dst)
    return dst


def test_both_shipped_pets_validate_ok():
    for pet_dir in PETS:
        proc = _run(pet_dir)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        report = _report(pet_dir)
        assert report['ok'] is True
        assert report['fails'] == []


def test_validation_json_records_every_check():
    report = _report(PETS[0])
    assert len(report['checks']) >= 12
    assert report['petId'] == 'huhu-carrot'
    assert all(set(c) == {'check', 'ok', 'detail'} for c in report['checks'])
    assert all(c['ok'] for c in report['checks'])


ROWS_11 = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed',
           'waiting', 'running', 'review', 'gaze-1', 'gaze-2']


def test_declared_row_names_replace_the_repo_atlas_spec(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-rows', manifest={
        'rowNames': ROWS_11,
        'tracks': {'failed': {'kind': 'once', 'fallback': 'idle'},
                   'gaze-1': {'kind': 'set'}, 'gaze-2': {'kind': 'set'}}})
    proc = _run(dst)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = _report(dst)
    assert report['fails'] == []
    checks = {c['check']: c for c in report['checks']}
    assert checks['row-declarations-valid']['ok'] is True
    assert checks['atlas-spec-cross-check-skipped']['detail'] == 'rows declared by the pet'
    assert 'atlas-frames-match-spec' not in checks


def test_a_pet_without_its_own_row_names_still_cross_checks_the_spec(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-plain')
    _run(dst)
    checks = {c['check'] for c in _report(dst)['checks']}
    assert 'row-declarations-absent-ok' in checks
    assert 'atlas-row-names-match-spec' in checks


def test_once_row_needs_a_repeating_fallback(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-bad-fallback', manifest={
        'rowNames': ROWS_11,
        'tracks': {'failed': {'kind': 'once'}}})
    proc = _run(dst)
    assert proc.returncode == 1
    assert 'row-declarations-valid' in _report(dst)['fails']
    detail = next(c['detail'] for c in _report(dst)['checks']
                  if c['check'] == 'row-declarations-valid')
    assert 'failed:fallback-invalid' in detail


def test_unknown_row_kind_and_unknown_row_fail(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-bad-kind', manifest={
        'rowNames': ROWS_11,
        'tracks': {'gaze-1': {'kind': 'ping-pong'}, 'nope': {'kind': 'set'}}})
    proc = _run(dst)
    assert proc.returncode == 1
    detail = next(c['detail'] for c in _report(dst)['checks']
                  if c['check'] == 'row-declarations-valid')
    assert 'tracks:unknown-row:nope' in detail
    assert 'gaze-1:unknown-kind:ping-pong' in detail


def test_idle_may_not_be_declared_as_a_one_shot(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-idle-once', manifest={
        'tracks': {'idle': {'kind': 'set'}}})
    proc = _run(dst)
    assert proc.returncode == 1
    detail = next(c['detail'] for c in _report(dst)['checks']
                  if c['check'] == 'row-declarations-valid')
    assert 'idle:must-repeat' in detail


def test_legacy_loop_false_reads_as_a_one_shot_row(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-legacy', manifest={
        'rowNames': ROWS_11,
        'tracks': {'failed': {'loop': False, 'fallback': 'idle'}}})
    proc = _run(dst)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _report(dst)['fails'] == []


def test_row_names_longer_than_the_atlas_fail(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-long', manifest={
        'rowNames': ROWS_11 + ['extra']})
    proc = _run(dst)
    assert proc.returncode == 1
    detail = next(c['detail'] for c in _report(dst)['checks']
                  if c['check'] == 'row-declarations-valid')
    assert 'rowNames:longer-than-atlas' in detail


def test_both_pets_report_distinct_ids():
    ids = {_report(d)['petId'] for d in PETS}
    assert ids == {'huhu-carrot', 'huhu-carrot-office'}


def test_unknown_top_level_key_fails(tmp_path):
    dst = _copy_to(PETS[1], tmp_path / 'bad-keys')
    path = dst / 'pet.json'
    doc = json.loads(path.read_text(encoding='utf-8'))
    doc['renderer'] = 'frames2d'
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
    proc = _run(dst)
    assert proc.returncode == 1
    report = _report(dst)
    assert report['ok'] is False
    assert any('allow-list' in c['check'] for c in report['checks'] if not c['ok'])


def test_illegal_placeholder_in_status_fails(tmp_path):
    dst = _copy_to(PETS[0], tmp_path / 'bad-placeholder')
    path = dst / 'voice.json'
    doc = json.loads(path.read_text(encoding='utf-8'))
    doc['status']['done'].append('第 {n} 步完成')
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
    proc = _run(dst)
    assert proc.returncode == 1
    assert 'voice-content-policy' in _report(dst)['fails']


def test_missing_frame_file_fails(tmp_path):
    dst = _copy_to(PETS[0], tmp_path / 'bad-frames')
    (dst / 'frames' / 'thinking' / 'f00.png').unlink()
    proc = _run(dst)
    assert proc.returncode == 1
    assert 'frames2d-track-content' in _report(dst)['fails']


def test_removing_a_used_cell_from_the_atlas_fails(tmp_path):
    dst = _copy_to(PETS[1], tmp_path / 'bad-atlas')
    path = dst / 'pet.json'
    doc = json.loads(path.read_text(encoding='utf-8'))
    doc['frames'] = [8, 8, 6, 6, 4, 4, 6, 6, 8]
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
    proc = _run(dst)
    assert proc.returncode == 1
    assert 'spritesheet-cell-content' in _report(dst)['fails']


def _write_v2_pet(pet_dir, gaps=(), extra_rows=11, manifest=None):
    """Synthetic engine-pack-v2 pet: flat manifest, no frames declaration,
    11-row atlas with per-row used counts derived from painted content."""
    from PIL import Image, ImageDraw

    pet_dir.mkdir(parents=True)
    used_per_row = [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8][:extra_rows]
    img = Image.new('RGBA', (8 * 192, extra_rows * 208), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for row, used in enumerate(used_per_row):
        for col in range(used):
            if (row, col) in gaps:
                continue
            x, y = col * 192 + 10, row * 208 + 10
            draw.rectangle([x, y, x + 49, y + 49], fill=(200, 60, 30, 255))
    img.save(pet_dir / 'spritesheet.png')
    doc = {'id': 'v2-synth', 'displayName': 'V2 Synth',
           'description': 'synthetic v2 atlas for tests',
           'spritesheetPath': 'spritesheet.png', 'spriteVersionNumber': 2}
    doc.update(manifest or {})
    (pet_dir / 'pet.json').write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return pet_dir


def test_v2_atlas_without_frames_declaration_passes(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-synth')
    proc = _run(dst)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _report(dst)['fails'] == []


def test_v2_atlas_with_row_gap_fails(tmp_path):
    dst = _write_v2_pet(tmp_path / 'v2-gap', gaps={(1, 1)})
    proc = _run(dst)
    assert proc.returncode == 1
    report = _report(dst)
    assert 'spritesheet-cell-content' in report['fails']
    detail = next(c['detail'] for c in report['checks']
                  if c['check'] == 'spritesheet-cell-content')
    assert 'r1-c1:gap-in-used-range' in detail
