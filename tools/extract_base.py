from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source' / 'carrot.png'
OUT = ROOT / 'assets' / 'derived'

CANVAS_W, CANVAS_H = 192, 208
BASELINE_Y = 200
TARGET_H = 168
MAX_W = 176
# Both thresholds were measured on this source image, not guessed.
# H>=58 on green: at H>=40 the background grass alone is 32763 px and merges
# with the character into one component, so max(components) would return the
# grass. At H>=58 grass drops to 840 px while 84% of the leaf pixels survive.
# V>=60 on orange: the ball's bottom sits in shadow where V falls to 67-78,
# and V>=90 clips it off, leaving a notch in the silhouette. V>=60 recovers
# that edge; the wooden sticks and brick box stay separate components.
ORANGE = (5, 30, 90, 60)
LEAF = (58, 95, 80, 80)
DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))

# Coordinate convention: bbox tuples are always (x0, y0, x1, y1).


def hsv(rgb):
    img = Image.fromarray(rgb, 'RGB').convert('HSV')
    return np.stack([np.asarray(c) for c in img.split()], axis=-1)


def segment_mask(rgb):
    hsv_ = hsv(rgb)
    h, s, v = hsv_[..., 0], hsv_[..., 1], hsv_[..., 2]
    orange = (h >= ORANGE[0]) & (h <= ORANGE[1]) & (s >= ORANGE[2]) & (v >= ORANGE[3])
    leaf = (h >= LEAF[0]) & (h <= LEAF[1]) & (s >= LEAF[2]) & (v >= LEAF[3])
    return (orange | leaf).astype(np.uint8) * 255


def denoise(mask, radius=3):
    img = Image.fromarray(mask, 'L').filter(ImageFilter.MedianFilter(radius * 2 + 1))
    return np.asarray(img.point(lambda p: 255 if p > 127 else 0))


def close_mask(mask, radius=3):
    # Morphological closing: dilate then erode. Bridges the thin dark seams
    # where the ball meets the grass blades, which leave the silhouette broken
    # and unfillable because they open onto the image border.
    img = Image.fromarray(mask, 'L').filter(ImageFilter.MaxFilter(radius * 2 + 1))
    img = img.filter(ImageFilter.MinFilter(radius * 2 + 1))
    return np.asarray(img.point(lambda p: 255 if p > 127 else 0))


def components(mask):
    fg = mask > 127
    hgt, wid = fg.shape
    seen = np.zeros_like(fg)
    out = []
    for y in range(hgt):
        for x in range(wid):
            if not fg[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            comp = []
            while stack:
                cy, cx = stack.pop()
                comp.append((cy, cx))
                for dy, dx in DIRS:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < hgt and 0 <= nx < wid and fg[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            out.append(comp)
    return out


def paint_component(mask, comp):
    out = np.zeros_like(mask)
    for y, x in comp:
        out[y, x] = 255
    return out


def border_seeds(hgt, wid):
    seeds = []
    for x in range(wid):
        seeds.append((0, x))
        seeds.append((hgt - 1, x))
    for y in range(hgt):
        seeds.append((y, 0))
        seeds.append((y, wid - 1))
    return seeds


def fill_holes(mask):
    # Flood the background from the image border through non-foreground pixels.
    # A non-foreground pixel the flood cannot reach is an interior hole (the
    # eye patches and the mouth) and must stay opaque, or the pet has no face.
    fg = mask > 127
    hgt, wid = fg.shape
    outside = np.zeros_like(fg)
    for y, x in border_seeds(hgt, wid):
        if fg[y, x] or outside[y, x]:
            continue
        stack = [(y, x)]
        outside[y, x] = True
        while stack:
            cy, cx = stack.pop()
            for dy, dx in DIRS:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < hgt and 0 <= nx < wid and not fg[ny, nx] and not outside[ny, nx]:
                    outside[ny, nx] = True
                    stack.append((ny, nx))
    return ((fg | ~outside).astype(np.uint8)) * 255


def soft_alpha(mask):
    return np.asarray(Image.fromarray(mask, 'L').filter(ImageFilter.GaussianBlur(1.2)))


def detect_eyes(rgb, mask, x0, y0, x1, y1):
    # Returns [[cx, cy, w, h], ...] in SOURCE image coordinates, sorted by cx.
    # The eye rings are bright blue: B beats R by 40 and beats G by 20, with
    # B>=90. Measured on this source that isolates exactly two blobs (1187 and
    # 1466 px). A bright-low-saturation rule instead matches a leaf specular
    # highlight and returns a wrong second eye. The sky is blue-dominant too
    # but lies outside the character mask, so the roi_mask gate keeps it out.
    sub = rgb[y0:y1, x0:x1]
    roi_mask = mask[y0:y1, x0:x1]
    r_, g_, b_ = (sub[..., 0].astype(int), sub[..., 1].astype(int),
                  sub[..., 2].astype(int))
    blue = (b_ > r_ + 40) & (b_ > g_ + 20) & (b_ >= 90) & (roi_mask > 127)
    bmask = denoise((blue.astype(np.uint8) * 255), 1)
    # The eye rings sit at about 60% of the character height, so 0.55 rejects
    # them. This filter is only a backstop: the tongue is pink, never
    # blue-dominant, so it cannot reach this list anyway.
    limit = int((y1 - y0) * 0.75)
    cands = []
    for comp in components(bmask):
        pts = np.array(comp)
        n = len(pts)
        if n < 25 or n > 5000:
            continue
        cy = float(pts[:, 0].mean())
        if cy >= limit:
            continue
        cands.append((n, float(pts[:, 1].mean()), cy,
                      int(pts[:, 1].max() - pts[:, 1].min() + 1),
                      int(pts[:, 0].max() - pts[:, 0].min() + 1)))
    cands.sort(reverse=True)
    return [[x0 + c[1], y0 + c[2], float(c[3]), float(c[4])]
            for c in sorted(cands[:2], key=lambda c: c[1])]


def place_on_canvas(rgb, alpha):
    ys, xs = np.where(alpha > 127)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    ch, cw = y1 - y0, x1 - x0
    scale = min(TARGET_H / ch, MAX_W / cw)
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    resample = Image.Resampling.LANCZOS
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], 'RGB').resize((nw, nh), resample)
    crop_a = Image.fromarray(alpha[y0:y1, x0:x1], 'L').resize((nw, nh), resample)
    crop = Image.merge('RGBA', (*crop_rgb.split(), crop_a))
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ox, oy = (CANVAS_W - nw) // 2, BASELINE_Y - nh
    canvas.alpha_composite(crop, (ox, oy))
    arr = np.asarray(canvas).copy()
    arr[arr[:, :, 3] == 0, :3] = 0
    geo = {'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'ox': ox, 'oy': oy, 'nw': nw, 'nh': nh}
    return Image.fromarray(arr, 'RGBA'), geo


def map_eyes(eyes, geo):
    # Convert source-space eye boxes to 192x208 canvas coordinates.
    ch = geo['y1'] - geo['y0']
    cw = geo['x1'] - geo['x0']
    kx, ky = geo['nw'] / cw, geo['nh'] / ch
    out = []
    for cx, cy, w, h in eyes:
        out.append([round(geo['ox'] + (cx - geo['x0']) * kx, 2),
                    round(geo['oy'] + (cy - geo['y0']) * ky, 2),
                    round(w * kx, 2), round(h * ky, 2)])
    return out


def checkered(rgba, tile=12):
    bg = Image.new('RGB', rgba.size, (235, 235, 235))
    draw = ImageDraw.Draw(bg)
    for y in range(0, rgba.height, tile):
        for x in range(0, rgba.width, tile):
            if ((x // tile) + (y // tile)) % 2 == 0:
                draw.rectangle([x, y, x + tile - 1, y + tile - 1], fill=(168, 168, 168))
    bg.paste(rgba, (0, 0), rgba)
    return bg


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rgb = np.asarray(Image.open(SRC).convert('RGB'))
    raw = segment_mask(rgb)
    denoised = close_mask(denoise(raw), 3)
    cleaned = fill_holes(paint_component(denoised, max(components(denoised), key=len)))
    canvas, geo = place_on_canvas(rgb, soft_alpha(cleaned))
    canvas.save(OUT / 'base.huhu.png')
    checkered(canvas).save(OUT / 'preview-transparent.png')
    eyes = map_eyes(
        detect_eyes(rgb, cleaned, geo['x0'], geo['y0'], geo['x1'], geo['y1']), geo)
    (OUT / 'eye-regions.json').write_text(
        json.dumps({'eyes': eyes, 'calibrated_at': date.today().isoformat()},
                   ensure_ascii=False, indent=2) + chr(10), encoding='utf-8')
    print('geo', geo)
    print('foreground_px', int((np.asarray(canvas)[:, :, 3] > 127).sum()))
    print('eyes', eyes)
    assert len(eyes) == 2, '需要标出恰好两只眼，请调整 detect_eyes 的阈值'


if __name__ == '__main__':
    main()
