import base64
import json
import math
import re
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

from petkit import emit, motion, render, spec as S  # noqa: E402
# petkit.build is the entry function; the stage lives in the module of the same name.
from petkit.build import run_previews  # noqa: E402

COPIED_ROWS = ROOT / 'pet' / 'huhu-carrot-office'
FRAMES = ROOT / 'pet' / 'huhu-carrot' / 'frames'
SHEET_PET = ROOT / 'pet' / 'raccoon-typing'
SHEET_PAGE = SHEET_PET / 'preview' / 'preview.html'
CELL_W, CELL_H = 192, 208


def _recipe(pet_id):
    return S.load_spec(pet_id)


def test_every_recipe_loads_and_owns_the_pet_dirs_it_declares():
    paths = S.spec_paths()
    assert len(paths) >= 3
    for path in paths:
        spec = S.load_spec(path)
        assert spec['id'] == path.stem
        dirs = S.pet_dirs(spec)
        assert dirs
        for _, _, pet_dir in dirs:
            assert (pet_dir / 'pet.json').is_file(), pet_dir


def test_a_recipe_that_declares_frames2d_also_declares_its_manifest_fields():
    for path in S.spec_paths():
        spec = S.load_spec(path)
        if S.output(spec, 'frames2d') is None:
            continue
        assert S.output(spec, 'frames2d')['tracks']
        for key in ('version', 'author', 'license'):
            assert spec.get(key), key


def test_the_four_shipped_pets_all_pass_validation_and_qa():
    for path in S.spec_paths():
        spec = S.load_spec(path)
        for _, _, pet_dir in S.pet_dirs(spec):
            validation = json.loads((pet_dir / 'validation.json').read_text(encoding='utf-8'))
            assert validation['ok'] is True, (pet_dir, validation['fails'])
            review = json.loads((pet_dir / 'qa' / 'review.json').read_text(encoding='utf-8'))
            assert review['ok'] is True, (pet_dir, review['fails'])


def test_idle_breath_matches_the_hand_written_scale_formula():
    """The channels must evaluate in the same order as the code they replaced,
    so the comparison is exact equality, not a tolerance."""
    track = _recipe('huhu-carrot')['outputs']['frames2d']['tracks']['idle']
    for index in range(16):
        phase = 0.5 - 0.5 * math.cos(2.0 * math.pi * index / 16)
        assert motion.pose(track, index, 16)['scale'] == 0.985 + 0.030 * phase


def test_hop_rows_match_the_hand_written_squash_formula():
    track = _recipe('dundun-office')['outputs']['sprite2d']['rows']['running-right']
    for index in range(8):
        phase = 2 * math.pi * index / 8
        squash_x = 1.07 - 0.24 * math.cos(phase)
        pose = motion.pose(track, index, 8)
        assert pose['squash_x'] == squash_x
        assert pose['squash_y'] == 1.0 - 0.45 * (squash_x - 1.0)
        assert pose['dx'] == 2.5 * math.sin(phase)


def test_one_shot_arc_matches_the_hand_written_lift_formula():
    track = _recipe('huhu-carrot')['outputs']['frames2d']['tracks']['done']
    for index in range(4):
        lift = math.sin(math.pi * (index / 3) ** 0.6)
        assert motion.pose(track, index, 4)['dy'] == -16.0 * lift


def test_alternating_tool_frames_match_the_hand_written_hop():
    track = _recipe('huhu-carrot')['outputs']['frames2d']['tracks']['tool']
    for index in range(8):
        hop = 1.0 if index % 2 == 0 else 0.0
        assert motion.pose(track, index, 8)['scale'] == 0.988 + 0.012 * hop


def test_rows_that_copy_a_track_are_byte_identical_to_its_frame_files():
    sheet = np.asarray(Image.open(COPIED_ROWS / 'spritesheet-win-1.png').convert('RGBA'))
    block = _recipe('huhu-carrot')['outputs']['sprite2d']
    names = render.row_names(block)
    checked = 0
    for row_index, name in enumerate(names):
        row = block['rows'][name]
        if 'from' not in row:
            continue
        count = render.row_count(row)
        for column in range(count):
            cell = sheet[row_index * CELL_H:(row_index + 1) * CELL_H,
                         column * CELL_W:(column + 1) * CELL_W]
            frame = np.asarray(Image.open(FRAMES / row['from'] /
                                         render.frame_name(column)).convert('RGBA'))
            assert np.array_equal(cell, frame), (name, column)
            checked += 1
    assert checked == 34


def test_the_atlas_declares_the_frame_counts_derived_from_its_rows():
    spec = _recipe('huhu-carrot')
    manifest = json.loads((ROOT / 'pet' / 'huhu-carrot-office' /
                           'pet.json').read_text(encoding='utf-8'))
    assert manifest['frames'] == [8, 8, 6, 6, 4, 4, 6, 6, 6]
    rows = motion.declared_rows(S.output(spec, 'sprite2d'))
    assert [render.row_count(rows[name]) for name in render.row_names(S.output(spec, 'sprite2d'))] \
        == manifest['frames']
    names = manifest.get('rowNames') or render.row_names(S.output(spec, 'sprite2d'))
    assert set(manifest['tracks']) == set(names)


def test_the_frames2d_manifest_declares_every_activity_phase():
    spec = _recipe('huhu-carrot')
    manifest = json.loads((ROOT / 'pet' / 'huhu-carrot' / 'pet.json').read_text(encoding='utf-8'))
    assert set(manifest['frames2d']['phases']) == set(S.PHASE_NAMES)
    assert set(manifest['frames2d']['tracks']) == set(S.output(spec, 'frames2d')['tracks'])


def test_default_rows_are_the_nine_canonical_rows():
    rows = motion.declared_rows({'rows': 'default'})
    names = render.row_names({'rows': 'default'})
    assert names == S.ROW_NAMES
    assert set(rows) == set(names)
    for name in names:
        assert render.row_count(rows[name]) >= 4


def _minimal_recipe():
    return {
        'id': 'my-pet',
        'displayName': '我的宠物',
        'description': 'qa fixture',
        'base': 'assets/derived/base.huhu.png',
        'outputs': {'sprite2d': {'spritesheet': 'spritesheet.png', 'rows': 'default'}},
    }


def test_a_two_field_recipe_is_enough_to_build_a_pet():
    assert S.problems(_minimal_recipe()) == []


def test_a_typo_in_a_motion_channel_is_reported_not_defaulted():
    recipe = _minimal_recipe()
    recipe['outputs']['sprite2d']['rows'] = {
        'idle': {'durations': {'value': 400, 'override': {}, 'count': 4},
                 'motion': [{'target': 'squash_x', 'kind': 'sinn', 'amp': 0.02}]}}
    found = S.problems(recipe)
    assert any('unknown kind' in line for line in found), found


def test_a_recipe_missing_its_base_image_is_reported():
    recipe = _minimal_recipe()
    recipe['base'] = 'assets/derived/base.nope.png'
    assert any('base image not found' in line for line in S.problems(recipe))


def test_rows_and_tracks_cannot_both_be_declared():
    recipe = _minimal_recipe()
    recipe['outputs']['sprite2d']['tracks'] = {'idle': {'kind': 'loop'}}
    assert any('tracks are derived from rows' in line for line in S.problems(recipe))


def _entry(*args):
    """Run the build entry, decoding its output leniently: on a cp936 console
    the child prints its display names in the local code page, not UTF-8."""
    proc = subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_pet.py')] + list(args),
                          capture_output=True)
    stdout = proc.stdout.decode('utf-8', 'replace')
    stderr = proc.stderr.decode('utf-8', 'replace')
    return proc.returncode, stdout, stderr


def _page_cards(path):
    """Every state card as ``(name, kind, per-frame ms, loops, body)``."""
    html = path.read_text(encoding='utf-8')
    cards = re.findall(r'<section class="card" data-state="([^"]+)" data-kind="([^"]*)" '
                       r'data-ms="([^"]+)" data-loop="(\d)">(.*?)</section>', html, re.S)
    return html, [(name, kind, ms.split(','), loop == '1', body)
                  for name, kind, ms, loop, body in cards]


def test_the_preview_page_plays_every_state_with_its_own_timings():
    html, cards = _page_cards(ROOT / 'preview' / 'huhu-carrot.html')
    spec = _recipe('huhu-carrot')
    tracks = S.output(spec, 'frames2d')['tracks']
    assert [name for name, _, _, _, _ in cards] == list(tracks)
    for name, _, ms, loop, body in cards:
        assert ms == [str(v) for v in S.timing(tracks[name], 'frameMs')]
        assert body.count('class="thumb"') == len(ms)
        assert loop is (tracks[name].get('loop', True))


def test_the_preview_page_has_pause_step_and_scrub_controls():
    html, cards = _page_cards(ROOT / 'preview' / 'huhu-carrot.html')
    for _, _, _, _, body in cards:
        for marker in ('data-act="prev"', 'data-act="toggle"', 'data-act="next"',
                       'class="scrub"', 'class="framemeta"'):
            assert marker in body
    assert 'setTimeout' in html and 'clearTimeout' in html
    assert html.count('data-jump=') == len(cards)


def test_the_preview_page_overlays_the_base_on_a_chosen_frame():
    html, _ = _page_cards(ROOT / 'preview' / 'huhu-carrot.html')
    for marker in ('id="ovFrame"', 'id="ovBase"', 'id="ovState"', 'id="ovIndex"',
                   'id="ovAlpha"', 'class="guide h"', 'class="guide v"',
                   'data-mode="difference"'):
        assert marker in html, marker
    assert 'mixBlendMode' in html


def test_a_state_appears_on_the_page_as_one_copy_of_each_frame():
    for page in (ROOT / 'preview' / 'huhu-carrot.html',
                 ROOT / 'pet' / 'dundun-office' / 'preview' / 'preview.html'):
        html = page.read_text(encoding='utf-8')
        _, cards = _page_cards(page)
        frames = sum(body.count('class="thumb"') for _, _, _, _, body in cards)
        # The hero figures are the only other embedded images; the player, the
        # state strip and the overlay all reuse the thumbnails' sources.
        assert html.count('data:image/png;base64,') == frames + html.count('<figure>')


def _sheet_atlas():
    return Image.open(SHEET_PET / 'spritesheet.webp').convert('RGBA')


def test_a_supplied_atlas_page_is_sliced_out_of_the_atlas_itself():
    """打工卜's previews may not be redrawn: every frame on the page has to be the
    exact cell the engine will read out of that same 11-row atlas."""
    spec = _recipe('raccoon-typing')
    names = render.row_names(S.output(spec, 'sprite2d'))
    assert len(names) == 11
    atlas = _sheet_atlas()
    _, cards = _page_cards(SHEET_PAGE)
    assert [name for name, _, _, _, _ in cards] == names
    for row, (_, _, _, _, body) in enumerate(cards):
        payloads = re.findall(r'<img src="data:image/png;base64,([^"]+)"', body)
        assert len(payloads) == 8, names[row]
        for column, payload in enumerate(payloads):
            frame = Image.open(BytesIO(base64.b64decode(payload))).convert('RGBA')
            cell = atlas.crop((column * CELL_W, row * CELL_H,
                               (column + 1) * CELL_W, (row + 1) * CELL_H))
            assert np.array_equal(np.asarray(frame), np.asarray(cell)), (names[row], column)


def test_the_sheet_style_reads_kinds_and_timings_the_way_the_engine_does():
    _, cards = _page_cards(SHEET_PAGE)
    assert dict((name, kind) for name, kind, _, _, _ in cards) == {
        'idle': 'loop', 'running-right': 'loop', 'running-left': 'loop',
        'waving': 'loop', 'jumping': 'loop', 'failed': 'once',
        'waiting': 'loop', 'running': 'loop', 'review': 'loop',
        'gaze-1': 'set', 'gaze-2': 'set'}
    ms = {name: values for name, _, values, _, _ in cards}
    # A row the manifest leaves silent plays the engine's default pattern for
    # that row; a pose set it has never heard of falls back to the recipe's own
    # frameMs, sliced or padded to the cells the row actually paints.
    assert ms['idle'] == ['500', '500', '600', '500', '500', '600', '500', '500']
    assert ms['failed'] == ['550', '550', '550', '600', '650', '700', '550', '550']
    assert ms['gaze-1'] == ['200'] * 8
    assert ms['jumping'] == ['400', '400', '400', '450', '450', '400', '400', '400']


def test_the_sheet_style_never_rewrites_the_supplied_atlas():
    """The atlas is an input, not a product: rebuilding previews twice must leave
    it byte for byte alone and give the same page back."""
    atlas = SHEET_PET / 'spritesheet.webp'
    before = atlas.read_bytes()
    spec = _recipe('raccoon-typing')
    first = run_previews(spec)['dir']
    page = (first / 'preview.html').read_bytes()
    run_previews(spec)
    assert atlas.read_bytes() == before
    assert (first / 'preview.html').read_bytes() == page
    assert (first / ('atlas-%s.webp' % spec['id'])).read_bytes() == before


def test_the_sheet_page_inlines_each_atlas_cell_once():
    html = SHEET_PAGE.read_text(encoding='utf-8')
    # 88 cells plus the contact sheet; the reference-frame hero borrows the very
    # first cell instead of inlining a second copy of it.
    assert html.count('data:image/') == html.count('class="thumb"') + 1
    assert '<img width="576">' in html


def test_a_supplied_atlas_recipe_needs_no_base_image():
    recipe = {'id': 'supplied', 'displayName': '外部图集', 'description': 'qa fixture',
              'outputs': {'sprite2d': {
                  'spritesheet': 'spritesheet.webp', 'source': 'sheet',
                  'tracks': {'failed': {'kind': 'once', 'fallback': 'idle'}}}},
              'previews': {'style': 'sheet', 'dir': 'pet/supplied/preview', 'frameMs': 200}}
    assert S.problems(recipe) == []
    recipe['previews']['style'] = 'pack'
    assert any('wants previews.style sheet' in line for line in S.problems(recipe))


def test_a_silent_sheet_recipe_still_previews_its_own_cells():
    """No durations anywhere: the engine's pattern for a known row, the recipe's
    frameMs for one it does not know."""
    atlas = _sheet_atlas()
    assert emit.row_durations({}, 'idle', 8, 200) == [500, 500, 600, 500, 500, 600, 500, 500]
    assert emit.row_durations({}, 'gaze-9', 3, 200) == [200, 200, 200]
    assert emit.row_durations({'durations': [120, 340]}, 'idle', 3, 200) == [120, 340, 120]
    assert emit.row_durations({'frameMs': [90, 90]}, 'idle', 4, 200) == [90, 90, 90, 90]
    assert emit._painted_columns(atlas, 9) == 8


def test_a_sheet_row_the_build_cannot_read_fails_loudly():
    """A blank row would otherwise become an empty GIF. The author has to say how
    many frames it holds instead."""
    spec = {'id': 'raccoon-typing', 'displayName': '打工卜', 'description': 'qa fixture'}
    block = {'style': 'sheet', 'dir': 'pet/raccoon-typing/preview'}
    sprite2d = {'petId': 'raccoon-typing', 'spritesheet': 'spritesheet.webp',
                'source': 'sheet', 'frames': [0] * 11}
    with pytest.raises(S.SpecError) as raised:
        emit.sheet_previews(spec, block, sprite2d)
    assert 'paints no cells' in str(raised.value)


def test_the_pack_page_marks_one_shot_rows_as_one_shot():
    _, cards = _page_cards(ROOT / 'pet' / 'dundun-office' / 'preview' / 'preview.html')
    one_shot = {name for name, _, _, loop, _ in cards if not loop}
    assert one_shot == {'jumping', 'failed'}
    assert len(cards) == 9


def test_the_build_entry_lists_every_recipe():
    code, stdout, stderr = _entry('--list')
    assert code == 0, stdout + stderr
    for pet_id in ('huhu-carrot', 'dundun-office', 'raccoon-typing'):
        assert pet_id in stdout, pet_id


def test_a_broken_recipe_stops_the_build_with_a_readable_reason(tmp_path):
    broken = tmp_path / 'broken.json'
    broken.write_text('{"id": "broken"}', encoding='utf-8')
    code, stdout, stderr = _entry(str(broken))
    assert code == 1
    assert 'FAILED' in stdout
    assert 'missing' in stdout
