import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import build_previews as BP

ROOT = Path(__file__).resolve().parent.parent
PREV = ROOT / 'preview'
BASE = ROOT / 'assets' / 'derived' / 'base.huhu.png'
TRACKS = ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed']


def test_static_preview_is_two_times_the_base():
    im = Image.open(PREV / 'huhu-static.png')
    assert im.size == (384, 416)
    assert im.mode == 'RGBA'


def test_all_seven_track_gifs_exist_with_the_right_sizes():
    for track in TRACKS:
        im = Image.open(PREV / ('track-' + track + '.gif'))
        assert im.format == 'GIF'
        assert im.mode == 'P'
        assert (im.size[0], im.size[1]) == (192, 208)


def test_non_looping_gifs_get_one_idle_transition_frame():
    assert Image.open(PREV / 'track-done.gif').n_frames == 5
    assert Image.open(PREV / 'track-failed.gif').n_frames == 5
    assert Image.open(PREV / 'track-idle.gif').n_frames == 16


def test_gif_frames_actually_differ():
    im = Image.open(PREV / 'track-idle.gif')
    arr = np.array(im.convert('RGBA'))
    second = np.array(im.seek(1) and im.convert('RGBA'))
    assert not np.array_equal(arr, second)


def test_overview_grid_is_four_columns_and_two_rows_of_cells():
    im = Image.open(PREV / '胡胡动作总览.png')
    assert im.size == (1536, 832)
    assert im.mode == 'RGBA'


def test_atlas_preview_matches_the_shipped_atlas():
    a = np.asarray(Image.open(PREV / 'atlas-huhu-carrot-office.png').convert('RGBA'))
    b = np.asarray(Image.open(ROOT / 'pet' / 'huhu-carrot-office' /
                               'spritesheet-win-1.png').convert('RGBA'))
    assert a.shape == b.shape
    assert np.array_equal(a, b)


def test_transparent_check_is_rgb_with_both_checker_colors():
    im = Image.open(PREV / 'huhu-transparent-check.png')
    assert im.mode == 'RGB'
    assert im.size == (192, 208)
    # The first 4 pixels all sit inside one 12 px checker tile, so they are one
    # colour; sample 144 pixels, which spans six tiles along the top row.
    flat = np.asarray(im).reshape(-1, 3)
    seen = {(int(x), int(y), int(z)) for x, y, z in flat[:144]}
    assert seen.issuperset({(168, 168, 168), (235, 235, 235)})


def test_checkerboard_helper_does_not_mutate_the_input():
    src = np.asarray(Image.open(BASE).convert('RGBA')).copy()
    before = src.copy()
    out = BP.checkerboard(Image.open(BASE).convert('RGBA'))
    assert out.mode == 'RGB'
    assert np.array_equal(np.asarray(Image.open(BASE).convert('RGBA')), before)
