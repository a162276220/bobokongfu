"""Draw the 「墩墩」 base image, then build the pet from its recipe.

Identity (role image): near-circular plush body whose leaf crown is WIDER
than the body and takes ~40% of the total height -- the reference's type
skeleton, redrawn from scratch (no tracing, no watermark/logo).
Material (texture image): measured plush palette + felt fibre grain, fuzzy
outline collar, matte shading.
Face: original big oval eyes + open half-moon smile (NOT the reference's
white-eye/blue-iris face) -- the open smile is the type's signature look.
Crown: pointed leaves fanning out from the top, wider than the body
(P7-type skeleton), drawn as rotated leaf layers with a midrib.

This file is now only the base-art producer: the frame, atlas, manifest and
preview work lives in pets/dundun-office.json and is built by petkit, so a pet
with a photographed base image needs no script at all. Every other pet in
`pets/` is built by `python tools/build_pet.py`.
"""

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from transforms import CANVAS_H, CANVAS_W  # noqa: E402
from petkit.build import build  # noqa: E402

PET_ID = 'dundun-office'
PET_DIR = ROOT / 'pet' / PET_ID
BASE_OUT = ROOT / 'assets' / 'derived' / 'base.dundun.png'

SS = 2                       # supersample factor for drawing
W, H = CANVAS_W * SS, CANVAS_H * SS

# --- palette (measured from 素材图/材质.jpg, matched to the photo's own ---
# --- exposure: photo plush mean RGB (196,117,68) vs v1's (208,118,52)) ---
BODY_MID = (200, 112, 52)
BODY_LIGHT = (234, 136, 72)
BODY_DARK = (158, 78, 18)
BELLY = (244, 170, 110)
LEAF_MID = (144, 190, 80)
LEAF_LIGHT = (168, 212, 98)
LEAF_DARK = (108, 150, 54)
EYE = (62, 36, 22, 255)
SPEC = (255, 244, 232, 230)
BLUSH = (255, 148, 112, 150)
MOUTH = (74, 40, 24, 235)

# --- geometry (canvas space, 192x208) --------------------------------------
BODY_CX, BODY_CY = 96.0, 144.0
BODY_RX, BODY_RY = 60.0, 58.0          # near-circular, bottom edge on y=202
LOWER_RY = 24.0                         # slight fattening near the bottom
EYES = [(79.0, 138.0, 15.0, 19.0), (113.0, 138.0, 15.0, 19.0)]  # canvas space


def _e(v):
    """canvas units -> supersample units"""
    return v * SS


def _blob(draw, cx, cy, rx, ry, fill):
    draw.ellipse([_e(cx - rx), _e(cy - ry), _e(cx + rx), _e(cy + ry)], fill=fill)


def _leaf(im, ax, ay, angle_deg, length, wd, fill, vein):
    """Paste one pointed leaf: base at (ax, ay) canvas units, tip along
    angle_deg (CCW from +x, image coords), length x wd; midrib drawn in."""
    L_len, L_wd = length * SS, wd * SS
    L = Image.new('RGBA', (int(L_len) + 8, int(L_wd) + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    mid = (L_wd + 8) / 2
    n = 48
    top = [(4 + t * L_len, mid - (L_wd / 2) * (math.sin(math.pi * t) ** 0.55))
           for t in (i / n for i in range(n + 1))]
    bot = [(4 + t * L_len, mid + (L_wd / 2) * (math.sin(math.pi * t) ** 0.55))
           for t in (i / n for i in range(n + 1))]
    d.polygon(top + bot[::-1], fill=fill)
    d.line([(2, mid), (L_len + 4, mid)], fill=vein, width=SS)
    L = L.rotate(angle_deg, expand=True, resample=Image.BICUBIC)
    th = math.radians(angle_deg)
    dx, dy = math.cos(th), -math.sin(th)          # image coords: CCW flips y
    px = int(ax * SS + dx * L_len / 2 - L.width / 2)
    py = int(ay * SS + dy * L_len / 2 - L.height / 2)
    im.alpha_composite(L, (px, py))


def draw_base():
    """Draw the character at SS resolution with plush shading, felt grain and
    a fuzzy outline collar; return the 192x208 RGBA base."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)

    # -- crown: pointed leaves fanning out from a small dark base cluster;
    #    spread ~128 px so it stays WIDER than the 120 px body (P7 type),
    #    tall enough to take ~1/3 of the total height
    for angle, length, wd, col in [
        (186, 62, 13, LEAF_DARK), (354, 62, 13, LEAF_DARK),
        (128, 54, 14, LEAF_MID), (52, 54, 14, LEAF_MID),
        (92, 60, 14, LEAF_LIGHT),
    ]:
        _leaf(im, 96.0, 82.0, angle, length, wd, col + (255,), LEAF_DARK + (255,))
    for cx, cy, rx, ry in [(80, 84, 15, 12), (112, 84, 15, 12), (96, 78, 19, 13)]:
        _blob(draw, cx, cy, rx, ry, LEAF_DARK + (255,))

    # -- body: main ellipse + lower pear bulge (bottom at y=202)
    _blob(draw, BODY_CX, BODY_CY, BODY_RX, BODY_RY, BODY_MID + (255,))
    _blob(draw, BODY_CX, BODY_CY + 26.0, BODY_RX - 6.0, LOWER_RY, BODY_MID + (255,))
    # (main bottom 202, bulge bottom 200 -- silhouette rests on the ellipse)

    # -- numpy shading pass over the whole silhouette
    arr = np.asarray(im).astype(np.float32)
    alpha = arr[:, :, 3]
    solid = alpha > 0
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    is_body = solid & (arr[:, :, 0] > arr[:, :, 1])          # orange pixels only
    is_leaf = solid & ~is_body

    # body: light from top-left, darker rim, soft belly patch
    nx = (xs / SS - BODY_CX) / BODY_RX
    ny = (ys / SS - BODY_CY) / BODY_RY
    light_dir = (nx * -0.55 + (ny + 0.25) * -0.35)
    mult = np.ones((H, W), np.float32)
    mult += 0.12 * np.clip(light_dir, 0, 1) * is_body
    edge = np.sqrt(nx * nx + ny * ny)
    mult -= 0.10 * np.clip((edge - 0.78) / 0.3, 0, 1) * is_body
    bx = (xs / SS - BODY_CX) / 40.0
    by = (ys / SS - 170.0) / 26.0
    belly = np.clip(1.0 - (bx * bx + by * by), 0, 1) ** 1.5 * is_body
    for c in range(3):
        arr[:, :, c] = np.where(is_body,
                                arr[:, :, c] * mult + belly * (BELLY[c] - arr[:, :, c]) * 0.28,
                                arr[:, :, c])
    # leaves: gentle top-light
    lmult = 1.0 + 0.12 * np.clip(((H - ys) / H - 0.78) * 4.0, 0, 1) * is_leaf \
        - 0.10 * np.clip((ys / SS - 78.0) / 20.0, 0, 1) * is_leaf
    for c in range(3):
        arr[:, :, c] = np.where(is_leaf, np.clip(arr[:, :, c] * lmult, 0, 255), arr[:, :, c])

    # -- felt fibre grain (multiplicative, silhouette-only): heavy, low-
    #    frequency fibres + a finer high-frequency speckle, so the surface
    #    reads as fabric under light rather than clean vinyl
    rng = np.random.default_rng(42)
    def _grain(sigma):
        n = rng.normal(1.0, sigma, (H, W)).astype(np.float32)
        return np.asarray(Image.fromarray((n * 127).astype(np.uint8))
                          .filter(ImageFilter.GaussianBlur(1)), np.float32) / 127.0
    grain = _grain(0.120) * _grain(0.095)    # rms ~15.5%, lands at photo's 6.4 after downsample
    for c in range(3):
        arr[:, :, c] = np.where(solid, np.clip(arr[:, :, c] * grain, 0, 255), arr[:, :, c])

    # -- fuzzy outline collar: roughen only existing alpha. Wider band
    #    (MinFilter 5) and deeper noise dips than v1, so the silhouette edge
    #    visibly fuzzes like plush instead of a clean cut
    a_img = Image.fromarray(alpha.astype(np.uint8))
    inner = np.asarray(a_img.filter(ImageFilter.MinFilter(5)), np.float32) / 255.0
    band = solid & (inner < 0.5)
    edge_noise = rng.normal(0.62, 0.20, (H, W)).astype(np.float32)
    edge_noise = np.clip(edge_noise, 0.28, 1.0)
    arr[:, :, 3] = np.where(band, alpha * edge_noise, alpha)

    # -- face (original): big oval eyes with glints, open half-moon smile,
    #    soft tongue, blush -- drawn after the grain so it stays crisp
    im = Image.fromarray(arr.astype(np.uint8))
    draw = ImageDraw.Draw(im)
    for ex, ey, ew, eh in EYES:
        draw.ellipse([_e(ex - ew / 2), _e(ey - eh / 2), _e(ex + ew / 2), _e(ey + eh / 2)],
                     fill=EYE)
        draw.ellipse([_e(ex - ew * 0.30), _e(ey - eh * 0.38),
                      _e(ex + ew * 0.05), _e(ey - eh * 0.05)], fill=SPEC)
    draw.pieslice([_e(76), _e(150), _e(116), _e(178)], 0, 180, fill=MOUTH)
    draw.ellipse([_e(88), _e(166), _e(104), _e(176)], fill=(214, 104, 84, 220))
    draw.ellipse([_e(48), _e(146), _e(64), _e(158)], fill=BLUSH)
    draw.ellipse([_e(128), _e(146), _e(144), _e(158)], fill=BLUSH)

    im = im.resize((CANVAS_W, CANVAS_H), Image.Resampling.LANCZOS)
    a = np.asarray(im).copy()
    a[a[:, :, 3] < 8, 3] = 0          # kill near-zero alpha specks from resampling
    return Image.fromarray(a)


def main():
    BASE_OUT.parent.mkdir(parents=True, exist_ok=True)
    base = draw_base()
    base.save(BASE_OUT)
    arr = np.asarray(base)
    ys, xs = np.where(arr[:, :, 3] > 0)
    print('base', BASE_OUT.name, base.size,
          'x', xs.min(), '..', xs.max(), 'y', ys.min(), '..', ys.max())

    spec, results = build(ROOT / 'pets' / (PET_ID + '.json'))
    sheet = results['sprite2d']['sheet']
    print('atlas', sheet, sheet.stat().st_size, 'bytes')
    print('frames', results['sprite2d']['frames'])
    print('page', results['previews']['dir'] / 'preview.html')


if __name__ == '__main__':
    main()
