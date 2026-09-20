import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import transforms as T


def _plate():
    im = Image.new('RGBA', (192, 208), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse([46, 20, 146, 190], fill=(230, 120, 40, 255))
    return im


def _top_row(im):
    return int(np.where(np.asarray(im)[:, :, 3].max(axis=1) > 127)[0].min())


def _bottom_row(im):
    return int(np.where(np.asarray(im)[:, :, 3].max(axis=1) > 127)[0].max())


def test_identity_transform_keeps_the_plate():
    plate = _plate()
    a = np.asarray(plate).astype(int)
    b = np.asarray(T.transform(plate)).astype(int)
    d = np.abs(a - b)
    # A 2x supersample round trip is never bit-exact: edge antialiasing shifts
    # and a few boundary pixels fall to zero alpha, which the zero-RGB
    # invariant then blanks (measured: mean 2.39 over all channels from a
    # handful of such pixels). Assert what actually matters -- the silhouette
    # and the colour -- instead of demanding bit equality.
    assert d[..., 3].mean() < 1.5
    assert d[a[..., 3] > 250, :3].mean() < 1.5


def test_transform_shape_and_zeroed_transparency():
    out = T.transform(_plate(), rotate_deg=8.0)
    assert out.size == (192, 208)
    arr = np.asarray(out)
    assert arr[arr[:, :, 3] == 0, :3].max() == 0


def test_shrink_reduces_foreground_area():
    full = np.asarray(_plate().getchannel('A'))
    small = np.asarray(T.transform(_plate(), scale=0.90))
    assert (small[:, :, 3] > 127).sum() < (full > 127).sum()


def test_rotate_keeps_the_feet_on_the_baseline():
    assert abs(_bottom_row(T.transform(_plate(), rotate_deg=8.0)) - _bottom_row(_plate())) <= 2


def test_dy_moves_the_plate_up():
    assert _top_row(T.transform(_plate(), dy=-6.0)) == _top_row(_plate()) - 6


def test_blink_open_is_identity_and_closed_is_dark():
    plate = _plate()
    eyes = [(80.0, 70.0, 20.0, 12.0)]
    assert np.array_equal(np.asarray(plate), np.asarray(T.paint_blink(plate, eyes, 0.0)))
    before = np.asarray(plate.convert('RGB'))[70, 80].sum()
    after = np.asarray(T.paint_blink(plate, eyes, 1.0).convert('RGB'))[70, 80].sum()
    assert after < before
