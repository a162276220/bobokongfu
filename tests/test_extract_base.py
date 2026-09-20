import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'assets' / 'derived' / 'base.huhu.png'
EYES = ROOT / 'assets' / 'derived' / 'eye-regions.json'


def _alpha():
    return np.asarray(Image.open(BASE).convert('RGBA'))[:, :, 3]


def test_base_canvas_shape_and_mode():
    im = Image.open(BASE)
    assert im.size == (192, 208)
    assert im.mode == 'RGBA'


def test_character_fills_a_substantial_area():
    assert (_alpha() > 127).sum() > 3000


def test_character_sits_on_the_baseline():
    rows = np.where(_alpha().max(axis=1) > 127)[0]
    assert rows.min() >= 6
    assert rows.max() <= 204


def test_transparent_pixels_have_zero_rgb():
    im = np.asarray(Image.open(BASE).convert('RGBA'))
    hidden = im[:, :, 3] == 0
    assert hidden.any()
    assert im[hidden, :3].max() == 0


def test_eyes_are_two_distinct_level_spots_on_the_face():
    eyes = json.loads(EYES.read_text(encoding='utf-8'))['eyes']
    assert len(eyes) == 2
    (cx1, cy1, w1, h1), (cx2, cy2, w2, h2) = eyes
    assert cx1 < cx2
    assert cx2 - cx1 >= 12
    # The character fills canvas y 32..200 and its eyes sit just below the
    # vertical midpoint. Bounds are calibrated against the measured source.
    assert abs(cy2 - cy1) <= 20
    for cx, cy, w, h in eyes:
        assert 6 < cx < 186
        assert 40 < cy < 170
        assert 6 <= w <= 40
        assert 4 <= h <= 40
