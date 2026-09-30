import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / 'tools' / 'qa_check.py'
OFFICE = ROOT / 'pet' / 'huhu-carrot-office'
FRAMES2D = ROOT / 'pet' / 'huhu-carrot'

CELL_W, CELL_H, COLS = 192, 208, 8


def _run(*targets, strict=False):
    argv = [sys.executable, str(TOOL)]
    argv += [str(t) for t in targets]
    if strict:
        argv.append('--strict')
    return subprocess.run(argv, capture_output=True, text=True, encoding='utf-8')


def _review(pet_dir):
    return json.loads((Path(pet_dir) / 'qa' / 'review.json').read_text(encoding='utf-8'))


def _fails(pet_dir):
    return _review(pet_dir)['fails']


def _body(shift_x=0, shift_y=0, size=64, colour=(210, 110, 45, 255)):
    """A single round pet-ish blob sitting on the usual baseline."""
    cell = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(cell)
    half = size // 2
    draw.ellipse([95 - half + shift_x, 199 - size + shift_y, 95 + half + shift_x, 199 + shift_y],
                 fill=colour)
    return cell


def _write_pet(root, rows, frames=None, name='synthetic', columns=COLS, size=None,
               extra=None):
    """Write a synthetic sprite2d pet whose rows are lists of cell images."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    width = size[0] if size else columns * CELL_W
    height = size[1] if size else len(rows) * CELL_H
    sheet = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for row_index, row in enumerate(rows):
        for col_index, cell in enumerate(row):
            sheet.paste(cell, (col_index * CELL_W, row_index * CELL_H))
    sheet.save(root / 'spritesheet.png')
    doc = {'id': name, 'displayName': 'Synthetic', 'description': 'qa fixture',
           'spritesheetPath': 'spritesheet.png', 'cell': {'width': CELL_W, 'height': CELL_H},
           'columns': columns, 'frames': frames if frames is not None else [len(r) for r in rows]}
    doc.update(extra or {})
    (root / 'pet.json').write_text(json.dumps(doc, ensure_ascii=False, indent=2),
                                   encoding='utf-8')
    return root


def _idle_plus_running(tmp_path, running_cell=None):
    return _write_pet(tmp_path / 'pet', [
        [_body(), _body(shift_x=4)],
        [running_cell if running_cell is not None else _body(shift_x=30)],
    ])


def test_shipped_pets_pass_the_rubric_with_no_arguments():
    proc = _run()
    assert proc.returncode == 0, proc.stdout + proc.stderr
    for pet_dir in (FRAMES2D, OFFICE):
        report = _review(pet_dir)
        assert report['ok'] is True, report
        assert report['fails'] == []
        assert report['warns'] == []


def test_review_json_records_every_rubric_section():
    _run(OFFICE)
    report = _review(OFFICE)
    assert report['petId'] == 'huhu-carrot-office'
    assert report['kind'] == 'sprite2d'
    assert all(set(c) == {'check', 'level', 'ok', 'detail'} for c in report['checks'])
    assert all(c['level'] in {'error', 'warn'} for c in report['checks'])
    prefixes = {c['check'].split(':')[0] for c in report['checks']}
    assert prefixes == {'geometry', 'consistency', 'animation', 'fitness', 'preview'}
    assert len(report['checks']) >= 15


def test_frames2d_pet_is_reviewed_without_atlas_checks():
    proc = _run(FRAMES2D)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = _review(FRAMES2D)
    assert report['kind'] == 'frames2d'
    names = [c['check'] for c in report['checks']]
    assert 'geometry:atlas-size-exact' not in names
    assert 'geometry:cells-within-bounds' in names


def test_a_synthetic_pet_passes_so_the_thresholds_stay_honest(tmp_path):
    pet = _idle_plus_running(tmp_path)
    proc = _run(pet)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _fails(pet) == []


def test_eleven_row_atlas_from_the_installed_scheme_is_supported(tmp_path):
    rows = [[_body()] for _ in range(11)]
    pet = _write_pet(tmp_path / 'pet', rows, name='eleven')
    _run(pet)
    detail = {c['check']: c for c in _review(pet)['checks']}['geometry:atlas-size-exact']
    assert detail['ok'] is True
    assert '(1536, 2288)' in detail['detail']


def test_atlas_that_is_not_whole_cells_is_reported(tmp_path):
    rows = [[_body()]]
    pet = _write_pet(tmp_path / 'pet', rows, name='ragged', size=(1536, 1900))
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'geometry:atlas-layout-supported' in _fails(pet)


def test_frame_touching_its_cell_border_fails_bounds(tmp_path):
    clipped = _body(shift_y=-170)
    pet = _write_pet(tmp_path / 'pet', [[clipped]], name='clipped')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'geometry:cells-within-bounds' in _fails(pet)


def test_painting_an_unused_cell_fails(tmp_path):
    pet = _write_pet(tmp_path / 'pet', [[_body(), _body()]], frames=[1], name='unused')
    sheet = Image.open(pet / 'spritesheet.png').convert('RGBA')
    ImageDraw.Draw(sheet).rectangle([CELL_W, 0, 2 * CELL_W - 1, CELL_H - 1],
                                    fill=(255, 255, 255, 255))
    sheet.save(pet / 'spritesheet.png')
    proc = _run(pet)
    assert proc.returncode == 1
    fails = _fails(pet)
    assert 'geometry:unused-cells-clear' in fails
    # the painted column also contradicts the declared frame count
    assert 'animation:row-frame-counts' in fails


def test_opaque_backdrop_inside_a_used_frame_fails(tmp_path):
    pet = _write_pet(tmp_path / 'pet', [[_body()]], name='backdrop')
    sheet = Image.open(pet / 'spritesheet.png').convert('RGBA')
    ImageDraw.Draw(sheet).rectangle([0, 0, CELL_W - 1, CELL_H - 1],
                                    fill=(255, 255, 255, 255))
    sheet.save(pet / 'spritesheet.png')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'geometry:no-baked-background' in _fails(pet)


def test_detached_second_subject_fails_subject_dominance(tmp_path):
    cell = _body()
    ImageDraw.Draw(cell).ellipse([10, 10, 74, 74], fill=(30, 30, 30, 255))
    pet = _write_pet(tmp_path / 'pet', [[cell]], name='debris')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'consistency:subject-dominance' in _fails(pet)


def test_chroma_key_residue_fails_key_colour_check(tmp_path):
    cell = _body()
    ImageDraw.Draw(cell).rectangle([80, 120, 112, 150], fill=(247, 0, 232, 255))
    pet = _write_pet(tmp_path / 'pet', [[cell]], name='magenta')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'consistency:key-colour-absent' in _fails(pet)


def test_drifting_loop_fails_the_seam_check(tmp_path):
    drifting = [_body(shift_x=index * 14) for index in range(4)]
    pet = _write_pet(tmp_path / 'pet', [drifting], name='drift')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'animation:loop-seam-continuous' in _fails(pet)


def _drifting_row():
    """A row whose frames walk steadily sideways, so the wrap-around is a jump.
    It starts clear of the idle pose so the state stays distinguishable."""
    return [_body(shift_x=14 + index * 14) for index in range(4)]


def test_a_row_declared_as_a_set_is_exempt_from_the_seam_check(tmp_path):
    rows = [[_body()], _drifting_row()]
    declared = _write_pet(tmp_path / 'declared', rows, name='gaze',
                          extra={'rowNames': ['idle', 'gaze-1'],
                                 'tracks': {'gaze-1': {'kind': 'set'}}})
    undeclared = _write_pet(tmp_path / 'undeclared', rows, name='gaze',
                            extra={'rowNames': ['idle', 'gaze-1']})
    _run(declared)
    _run(undeclared)
    assert _fails(declared) == []
    assert 'animation:loop-seam-continuous' in _fails(undeclared)
    detail = {c['check']: c for c in _review(declared)['checks']}
    assert 'gaze-1:set' in detail['animation:loop-seam-continuous']['detail']


def test_legacy_loop_false_reads_as_a_one_shot_row(tmp_path):
    pet = _write_pet(tmp_path / 'pet', [[_body()], _drifting_row()], name='legacy',
                     extra={'rowNames': ['idle', 'running-right'],
                            'tracks': {'running-right': {'loop': False}}})
    proc = _run(pet)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _fails(pet) == []
    detail = {c['check']: c for c in _review(pet)['checks']}
    assert 'running-right:once' in detail['animation:loop-seam-continuous']['detail']


def test_state_identical_to_idle_fails_distinctness(tmp_path):
    pet = _idle_plus_running(tmp_path, running_cell=_body())
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'animation:states-distinct-from-idle' in _fails(pet)


def test_static_row_warns_but_only_strict_mode_blocks(tmp_path):
    pet = _write_pet(tmp_path / 'pet', [[_body(), _body(), _body()]], name='static')
    proc = _run(pet)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = _review(pet)
    assert report['warns'] == ['animation:row-motion-present']
    assert report['ok'] is True
    strict = _run(pet, strict=True)
    assert strict.returncode == 1
    assert _review(pet)['ok'] is False


def test_frames_out_of_step_with_the_declared_counts_fails(tmp_path):
    blank = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    pet = _write_pet(tmp_path / 'pet', [[_body(), blank]], frames=[2], name='counts')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'animation:row-frame-counts' in _fails(pet)


def test_palette_jump_between_rows_fails_palette_check(tmp_path):
    pet = _write_pet(tmp_path / 'pet', [
        [_body()],
        [_body(colour=(40, 70, 220, 255))],
    ], name='palette')
    proc = _run(pet)
    assert proc.returncode == 1
    assert 'consistency:palette-stable' in _fails(pet)


def test_report_is_written_next_to_the_pet_not_overwritten_twice(tmp_path):
    pet = _write_pet(tmp_path / 'pet', [[_body()]], name='stable')
    _run(pet)
    first = (pet / 'qa' / 'review.json').read_text(encoding='utf-8')
    _run(pet)
    assert (pet / 'qa' / 'review.json').read_text(encoding='utf-8') == first
    assert np.array_equal(
        np.asarray(Image.open(pet / 'spritesheet.png').convert('RGBA'))[:, :, 3].shape,
        (CELL_H, COLS * CELL_W))
