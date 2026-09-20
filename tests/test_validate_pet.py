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
