"""The cross-pet overview page.

The gallery exists to be trusted at a glance, so these tests are about the two
things that could quietly make it lie: a cell that is not the pixels that ship,
and a badge that is not the numbers in the manifest.
"""

import base64
import re
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

import qa_check  # noqa: E402
from petkit import cli, emit, gallery, spec as S  # noqa: E402

CELL_RE = (r'class="mcell(?: weak)?" data-pet="([^"]+)" data-state="([^"]+)" '
           r'data-frames="(\d+)" data-ms="([^"]+)">\s*'
           r'<div class="stage"><img class="strip" alt="" src="data:image/webp;base64,([^"]+)"')


def _cells(html):
    found = re.findall(CELL_RE, html)
    return [(pet, state, int(frames), ms.split(','), payload)
            for pet, state, frames, ms, payload in found]


def _grids():
    return {path.parent.name: qa_check.load_grid(path.parent)
            for path in sorted((ROOT / 'pet').glob('*/pet.json'))}


def _decode(payload):
    return np.asarray(Image.open(BytesIO(base64.b64decode(payload))).convert('RGBA'))


@pytest.fixture(scope='module')
def page_path(tmp_path_factory):
    out = tmp_path_factory.mktemp('gallery') / 'gallery.html'
    gallery.write_gallery(out=out)
    return out


@pytest.fixture(scope='module')
def page(page_path):
    return page_path.read_text(encoding='utf-8')


def test_the_matrix_has_one_column_per_pet_and_one_row_per_state(page):
    columns = re.findall(r'<th class="pet">([^<]*)<span>([^<]+) · (frames2d|sprite2d)', page)
    assert [column[1] for column in columns] == \
        [path.parent.name for path in sorted(S.PET_DIR.glob('*/pet.json'))]
    assert columns, 'the overview parsed no pet columns'

    rows = re.findall(r'<th scope="row"><b>([^<]+)</b>', page)
    grids = _grids()
    present = sorted({name for grid in grids.values() for name in
                      [row.name for row in grid.rows if row.frames]})
    assert rows[:9] == [name for name in S.ROW_NAMES if name in present]
    assert sorted(rows[9:]) == sorted(set(present) - set(rows[:9]))
    for name in rows:
        for pet_id, grid in grids.items():
            has = any(row.name == name and row.frames for row in grid.rows)
            assert ('data-pet="%s" data-state="%s"' % (pet_id, name) in page) is has, (pet_id, name)


def test_every_cell_is_the_pixels_that_ship(page):
    grids = _grids()
    cells = _cells(page)
    assert cells
    for pet_id, state, frames, _, payload in cells:
        row = next(row for row in grids[pet_id].rows if row.name == state)
        assert len(row.frames) == frames, (pet_id, state)
        strip = _decode(payload)
        assert strip.shape == (gallery.CANVAS_H, gallery.CANVAS_W * frames, 4)
        want = gallery.strip_array(row.frames)
        assert np.array_equal(gallery.premultiplied(strip), gallery.premultiplied(want)), \
            (pet_id, state)


def test_the_badges_are_the_manifests_own_numbers(page):
    grids = _grids()
    cells = _cells(page)
    for pet_id, state, frames, ms, _ in cells:
        doc = _manifest(pet_id)
        durations = emit.row_durations(gallery._tracks(doc).get(state), state, frames,
                                       gallery.DEFAULT_CELL_MS)
        assert ms == [str(value) for value in durations], (pet_id, state)
        row = next(row for row in grids[pet_id].rows if row.name == state)
        label = emit.KIND_LABELS.get(row.kind, row.kind)
        assert ('%d 帧 · %.2f s · %s' % (frames, sum(durations) / 1000.0, label)) in page


def _manifest(pet_id):
    import json
    return json.loads((ROOT / 'pet' / pet_id / 'pet.json').read_text(encoding='utf-8'))


def test_a_state_a_pet_lacks_is_an_empty_cell(page):
    grids = _grids()
    rows = re.findall(r'<th scope="row"><b>([^<]+)</b>', page)
    missing = sum(1 for name in rows for grid in grids.values()
                  if not any(row.name == name and row.frames for row in grid.rows))
    assert page.count('<td class="mcell empty">—</td>') == missing
    # Every state on the page belongs to at least one pet, and no pet carries every
    # state, so the dashes are a real but partial spread -- recomputed from the
    # grids above rather than pinned to however many pets shipped this week.
    assert 0 < missing < len(rows) * len(grids)


def test_the_stillest_cell_of_each_row_is_marked_once(page):
    """The tag has to sit on the least-moving cell of its row, recomputed here from
    the same frames -- otherwise the tag is decoration, not evidence."""
    grids = _grids()
    marked = {}
    for pet_id, state, body in re.findall(
            r'<td class="mcell[^"]*" data-pet="([^"]+)" data-state="([^"]+)"[^>]*>(.*?)</td>',
            page, re.S):
        marked.setdefault(state, {})[pet_id] = '本行最静' in body
    for state, flags in marked.items():
        shares = {pet_id: gallery.measure(
            next(row.frames for row in grids[pet_id].rows if row.name == state))[0]
            for pet_id in flags}
        low = min(shares.values())
        assert {pet for pet, on in flags.items() if on} == {
            pet for pet, share in shares.items() if share <= low + 1e-12}, state


def _weak_from_pixels():
    """The (pet, state) pairs that are genuinely under the line, recomputed here
    from the same frames the page embeds -- so a test of the highlight is a test
    of a real measurement, not of a class string the page happens to emit.
    """
    weak = set()
    for pet_id, grid in _grids().items():
        for row in grid.rows:
            if row.frames and gallery.measure(row.frames)[0] < gallery.WEAK_SHARE:
                weak.add((pet_id, row.name))
    return weak


def test_only_the_cells_under_the_motion_line_are_zoomed(page):
    weak = _weak_from_pixels()
    assert weak, 'the shipped pets should have at least one barely-moving state'
    flagged = set(re.findall(
        r'<td class="mcell weak" data-pet="([^"]+)" data-state="([^"]+)"', page))
    assert flagged == weak
    # the frame is in the stylesheet, next to the class that turns it on
    assert '.mcell.weak{' in page and 'transform:scale(' in page


def test_the_advice_list_is_a_button_per_weak_state_and_nothing_else(page):
    weak = _weak_from_pixels()
    chips = re.findall(r'<button data-pet="([^"]+)" data-state="([^"]+)">([^<]+)</button>', page)
    assert {(pet, state) for pet, state, _ in chips} == weak
    # every button names the cell it jumps to, and that cell exists on the page
    cells = {(pet, state) for pet, state, *_ in _cells(page)}
    for pet_id, state, label in chips:
        assert (pet_id, state) in cells
        share = gallery.measure(
            next(row.frames for row in _grids()[pet_id].rows if row.name == state))[0]
        assert label == '%s %.1f%%' % (state, share * 100.0), (pet_id, state)


def test_a_pet_above_the_line_is_named_as_fine(page):
    healthy = {pet_id for pet_id, grid in _grids().items()
               if all(gallery.measure(row.frames)[0] >= gallery.WEAK_SHARE
                      for row in grid.rows if row.frames)}
    listed = set(re.findall(r'<li class="ok"><b>[^<]+</b><span class="sub">([^ ·]+) ·', page))
    assert listed == healthy


def test_every_advice_button_has_something_to_flash(page):
    """The click handler looks cells up by data-pet/data-state; if the script ever
    drifts from the markup the list becomes decorative, so pin both halves here.
    """
    assert "querySelectorAll('.advice button')" in page
    assert "'.mcell[data-pet=" in page
    for pet_id, state in re.findall(r'<button data-pet="([^"]+)" data-state="([^"]+)"', page):
        assert 'data-pet="%s" data-state="%s"' % (pet_id, state) in page


def test_the_page_carries_exactly_one_image_per_state(page):
    assert page.count('data:image/') == len(_cells(page))
    assert len(re.findall(r'<img[^>]+>', page)) == len(_cells(page))
    assert 'src="http' not in page


def test_the_page_rebuilds_byte_for_byte(page_path, tmp_path):
    again = tmp_path / 'again.html'
    gallery.write_gallery(out=again)
    assert again.read_bytes() == page_path.read_bytes()


def test_the_ranking_only_counts_the_canonical_rows_a_pet_has(page):
    grids = _grids()
    scores = {}
    for pet_id, grid in grids.items():
        canonical = [row for row in grid.rows if row.frames and row.name in S.ROW_NAMES]
        assert canonical
        scores[pet_id] = sum(gallery.measure(row.frames)[0] for row in canonical) / len(canonical)
    listed = re.findall(r'<b>(\d+\.\d)%</b>', page)
    assert sorted(float(value) for value in listed) == \
        sorted(round(score * 100, 1) for score in scores.values())
    # ranked widest motion first, so the last line is the stillest pet
    assert [float(value) for value in listed] == sorted(
        (round(score * 100, 1) for score in scores.values()), reverse=True)
    assert page.count('class="rank worst"') == 1


def test_a_full_build_refreshes_the_gallery_but_a_single_pet_does_not(monkeypatch, capsys):
    calls = []

    def fake(pet_dirs=None, out=None):
        calls.append(out)
        return {'path': ROOT / 'preview' / 'gallery.html', 'pets': [], 'states': 0, 'bytes': 0}

    monkeypatch.setattr(gallery, 'write_gallery', fake)
    assert cli.main(['--stage', 'manifests', 'raccoon-typing']) == 0
    assert calls == []
    assert cli.main(['--stage', 'manifests', '--gallery', 'raccoon-typing']) == 0
    assert calls == [None]
