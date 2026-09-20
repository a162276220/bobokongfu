from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

CANVAS_W, CANVAS_H = 192, 208
PIVOT = (96, 208)
SS = 2
BLINK_FILL = (28, 20, 16, 235)


def _zeroed_transparency(im):
    arr = np.asarray(im).copy()
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, 'RGBA')


def _inverse_affine(scale_x, scale_y, rotate_deg, pivot, offset):
    th = math.radians(rotate_deg)
    cos, sin = math.cos(th), math.sin(th)
    forward = np.array([[scale_x * cos, -scale_x * sin],
                        [scale_y * sin, scale_y * cos]])
    inv = np.linalg.inv(forward)
    piv = np.array(pivot, dtype=float)
    off = np.array(offset, dtype=float)
    const = piv - inv @ (piv + off)
    return (float(inv[0, 0]), float(inv[0, 1]), float(const[0]),
            float(inv[1, 0]), float(inv[1, 1]), float(const[1]))


def transform(base, scale=1.0, dx=0.0, dy=0.0, rotate_deg=0.0,
              squash_x=1.0, squash_y=1.0):
    w2, h2 = CANVAS_W * SS, CANVAS_H * SS
    up = base.convert('RGBA').resize((w2, h2), Image.Resampling.LANCZOS)
    matrix = _inverse_affine(scale * squash_x, scale * squash_y, rotate_deg,
                             (w2 / 2.0, h2), (dx * SS, dy * SS))
    # Image.transform with AFFINE only accepts NEAREST, BILINEAR or BICUBIC;
    # LANCZOS raises ValueError. BICUBIC keeps the silhouette smooth.
    out = up.transform((w2, h2), Image.AFFINE, matrix,
                       resample=Image.Resampling.BICUBIC)
    return _zeroed_transparency(out.resize((CANVAS_W, CANVAS_H), Image.Resampling.LANCZOS))


def paint_blink(base, eyes, t):
    if t <= 0:
        return base.convert('RGBA').copy()
    im = base.convert('RGBA').copy()
    draw = ImageDraw.Draw(im)
    width = max(2, int(round(2.2 * SS / 2.0 + 1)))
    for cx, cy, w, h in eyes:
        half = max(1.0, w * 0.42 * t)
        dip = h * 0.30 * t
        steps = 8
        points = []
        # The arc is centred on cy: both endpoints sit at cy - dip and the
        # middle passes through (cx, cy), so the closed lid reads as a droop
        # across the eye instead of a line along its lower edge.
        for i in range(steps + 1):
            u = i / steps
            points.append((cx - half + 2.0 * half * u,
                           (cy - dip) + dip * 4.0 * u * (1.0 - u)))
        draw.line(points, fill=BLINK_FILL, width=width, joint='curve')
    return im
