import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / 'pet' / 'huhu-carrot' / 'frames'
SPEC = ROOT / 'assets' / 'derived' / 'frames-spec.json'
COUNTS = {'idle': 16, 'waiting': 6, 'thinking': 6, 'tool': 8,
          'review': 6, 'done': 4, 'failed': 4}


def _spec():
    return json.loads(SPEC.read_text(encoding='utf-8'))


EYES = ROOT / 'assets' / 'derived' / 'eye-regions.json'


def _load(track, i):
    return np.asarray(Image.open(FRAMES / track / ('f%02d.png' % i)).convert('RGBA'))


def test_all_seven_tracks_have_the_expected_frame_count():
    data = _spec()
    assert sorted(data) == sorted(COUNTS)
    for track, n in COUNTS.items():
        assert len(data[track]['frames']) == n
        assert len(data[track]['frameMs']) == n


def test_every_frame_is_192x208_png_with_zeroed_transparency():
    for track, data in _spec().items():
        for name in data['frames']:
            im = Image.open(FRAMES / track / name)
            assert im.size == (192, 208)
            assert im.format == 'PNG'
            arr = np.asarray(im.convert('RGBA'))
            assert arr[arr[:, :, 3] == 0, :3].max() == 0


def test_frames_within_a_track_are_not_all_identical():
    for track, data in _spec().items():
        diffs = [np.abs(_load(track, i).astype(int) - _load(track, 0).astype(int)).mean()
                 for i in range(1, len(data['frames']))]
        assert max(diffs) > 0.5


def test_idle_blinks_at_frame_11():
    # Measured on the real frames: the whole-frame mean diff against f00 is
    # about 12.0 for BOTH f10 and f11, because a 2.5% scale change moves the
    # silhouette edge by a few pixels and those edge pixels dominate the mean.
    # Whole-frame diff cannot discriminate the blink. The eye patch can:
    # brightness f10=132.91 f11=126.37 f12=130.97 f13=134.22.
    eyes = json.loads(EYES.read_text(encoding='utf-8'))['eyes']

    def brightness(i):
        a = _load('idle', i)
        return float(np.mean([
            a[int(cy - h):int(cy + h) + 1, int(cx - w):int(cx + w) + 1, :3].mean()
            for cx, cy, w, h in eyes]))

    assert brightness(11) < brightness(10) - 3.0
    assert brightness(11) < brightness(12) - 3.0
    assert brightness(11) < brightness(13) - 3.0


def test_loop_and_fallback_rules():
    data = _spec()
    for track in ('done', 'failed'):
        assert data[track]['loop'] is False
        assert data[track]['fallback'] == 'idle'
    for track in ('idle', 'waiting', 'thinking', 'tool', 'review'):
        assert data[track]['loop'] is True
        assert data[track]['fallback'] is None


def test_frame_ms_stay_within_the_engine_bounds():
    for data in _spec().values():
        assert all(16 <= v <= 5000 for v in data['frameMs'])
