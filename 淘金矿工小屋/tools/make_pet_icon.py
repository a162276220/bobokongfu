#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 ImageGen 产出的棋盘格底图处理成透明底方形宠物图标。
用法: python make_pet_icon.py <src.png> <dst.png> [size]
"""
import sys, zlib, struct
from collections import deque

BG = [(253, 251, 251), (230, 228, 222)]   # 模型把“透明”画成的两种棋盘底色
TH = 55.0                                  # 颜色距离阈值


def read_png(path):
    b = open(path, 'rb').read()
    pos, idat = 8, b''
    w = h = bd = ct = 0
    while pos < len(b):
        ln = struct.unpack('>I', b[pos:pos + 4])[0]
        typ = b[pos + 4:pos + 8]
        data = b[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, _, _, _ = struct.unpack('>IIBBBBB', data)
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    bpp = {6: 4, 2: 3, 0: 1, 4: 2}[ct] * (bd // 8)
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                bb = prev[i]
                pp = a + bb - c
                pa, pb, pc = abs(pp - a), abs(pp - bb), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (bb if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line
        prev = line
    return w, h, ct, bytes(out)


def write_png(path, w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def main(src, dst, size=256):
    w, h, ct, px = read_png(src)
    assert ct in (2, 6), 'need RGB/RGBA png'
    has_alpha = (ct == 6)

    def is_bg(x, y):
        i = (y * w + x) * (4 if has_alpha else 3)
        if has_alpha and px[i + 3] < 16:
            return True
        r, g, b = px[i], px[i + 1], px[i + 2]
        best = 1e9
        for (br, bg_, bb) in BG:
            d = (r - br) ** 2 + (g - bg_) ** 2 + (b - bb) ** 2
            if d < best:
                best = d
        return best ** 0.5 < TH

    # 1) 从边界洪泛识别背景
    marked = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not marked[y * w + x] and is_bg(x, y):
                marked[y * w + x] = 1; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not marked[y * w + x] and is_bg(x, y):
                marked[y * w + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not marked[ny * w + nx] and is_bg(nx, ny):
                marked[ny * w + nx] = 1; q.append((nx, ny))

    # 2) 二值 alpha -> 3x3 均值软化边缘
    a0 = bytearray(0 if marked[i] else 255 for i in range(w * h))
    alpha = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            s = n = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        s += a0[ny * w + nx]; n += 1
            alpha[y * w + x] = s // n

    # 3) 包围盒 -> 正方形裁切
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        base = y * w
        for x in range(w):
            if alpha[base + x] > 24:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    side = int(max(maxx - minx + 1, maxy - miny + 1) * 1.12)
    cx, cy = (minx + maxx) // 2, (miny + maxy) // 2
    x0, y0 = cx - side // 2, cy - side // 2

    # 4) 裁切 + 去白边反混合，收集成浮点缓冲
    buf = [[0.0, 0.0, 0.0, 0.0] for _ in range(side * side)]
    for y in range(side):
        sy = y0 + y
        if not (0 <= sy < h):
            continue
        for x in range(side):
            sx = x0 + x
            if not (0 <= sx < w):
                continue
            si = (sy * w + sx) * (4 if has_alpha else 3)
            al = alpha[sy * w + sx]
            r, g, b = px[si], px[si + 1], px[si + 2]
            if 0 < al < 255:
                af = al / 255.0
                br, bg_, bb = BG[0]
                r = max(0, min(255, int((r - (1 - af) * br) / af)))
                g = max(0, min(255, int((g - (1 - af) * bg_) / af)))
                b = max(0, min(255, int((b - (1 - af) * bb) / af)))
            buf[y * side + x] = [r, g, b, al]

    # 5) 面积平均缩放（alpha 加权），输出 size x size
    box = side / size
    out = bytearray(size * size * 4)
    for oy in range(size):
        ya, yb = int(oy * box), max(int(oy * box) + 1, int((oy + 1) * box))
        for ox in range(size):
            xa, xb = int(ox * box), max(int(ox * box) + 1, int((ox + 1) * box))
            sa = sr = sg = sb = 0.0
            n = 0
            for yy in range(ya, min(yb, side)):
                row = yy * side
                for xx in range(xa, min(xb, side)):
                    r, g, b, al = buf[row + xx]
                    n += 1
                    sa += al; sr += r * al; sg += g * al; sb += b * al
            di = (oy * size + ox) * 4
            out[di + 3] = int(sa / n)
            if sa > 0:
                out[di] = min(255, int(sr / sa))
                out[di + 1] = min(255, int(sg / sa))
                out[di + 2] = min(255, int(sb / sa))

    write_png(dst, size, size, bytes(out))
    print(f'OK {dst} {size}x{size} bg_ratio={sum(marked)*100//(w*h)}% bbox={minx},{miny},{maxx},{maxy}')


if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0], a[1], int(a[2]) if len(a) > 2 else 256)
