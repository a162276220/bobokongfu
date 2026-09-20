import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / 'pet' / 'huhu-carrot-office' / 'spritesheet-win-1.png'
SPEC = ROOT / 'assets' / 'derived' / 'atlas-spec.json'
CW, CH = 192, 208
EYES = ROOT / 'assets' / 'derived' / 'eye-regions.json'


def _spec():
    return json.loads(SPEC.read_text(encoding='utf-8'))


def _sheet():
    return np.asarray(Image.open(ATLAS).convert('RGBA'))


def test_atlas_size_format_and_zeroed_transparency():
    im = Image.open(ATLAS)
    assert im.size == (1536, 1872)
    assert im.format == 'PNG'
    arr = _sheet()
    assert arr[arr[:, :, 3] == 0, :3].max() == 0


def test_frame_counts_and_row_limit():
    spec = _spec()
    assert spec['frames'] == [8, 8, 6, 6, 4, 4, 6, 6, 6]
    assert all(n <= 8 for n in spec['frames'])
    assert spec['columns'] == 8
    assert spec['rows'] == 9
    assert spec['rowNames'] == ['idle', 'running-right', 'running-left', 'waving',
                                'jumping', 'failed', 'waiting', 'running', 'review']


def test_used_cells_are_opaque_and_unused_cells_are_empty():
    counts = _spec()['frames']
    sheet = _sheet()
    for row, used in enumerate(counts):
        for col in range(8):
            alpha = sheet[row * CH:(row + 1) * CH, col * CW:(col + 1) * CW, 3]
            if col < used:
                assert alpha.max() > 127
            else:
                assert alpha.max() == 0


def test_atlas_idle_blinks_at_frame_6():
    # Same flaw as the frames2d blink test: the whole-cell mean diff against
    # cell 0 is 12.040 for cell 5 and 11.171 for cell 6, because a 2.5% scale
    # change moves the silhouette edge and those pixels dominate the mean.
    # The eye patch separates them: brightness cell5=132.91 cell6=127.43
    # cell7=133.82 cell0=140.20.
    sheet = _sheet().astype(int)
    cell = lambda c: sheet[0:CH, c * CW:(c + 1) * CW]
    eyes = json.loads(EYES.read_text(encoding='utf-8'))['eyes']

    def brightness(c):
        a = cell(c)
        return float(np.mean([a[int(cy - h):int(cy + h) + 1, int(cx - w):int(cx + w) + 1, :3].mean()
                             for cx, cy, w, h in eyes]))

    assert brightness(6) < brightness(5) - 3.0
    assert brightness(6) < brightness(7) - 3.0
    assert brightness(6) < brightness(0) - 3.0


def test_running_right_row_reuses_the_tool_track_frames():
    sheet = _sheet()
    for i in range(8):
        ref = np.asarray(Image.open(ROOT / 'pet' / 'huhu-carrot' / 'frames' / 'tool' /
                                    ('f%02d.png' % i)).convert('RGBA'))
        assert np.array_equal(sheet[CH:2 * CH, i * CW:(i + 1) * CW], ref)


def test_durations_within_engine_bounds():
    for data in _spec()['tracks'].values():
        assert all(16 <= v <= 5000 for v in data['durations'])
        if not data.get('loop', True):
            assert data['fallback'] == 'idle'
