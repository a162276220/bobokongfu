import io

p = r"D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
h = io.open(p, encoding="utf-8").read()

old_w = "const wLine = pts.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yw(r.weight || 0).toFixed(1)).join(' ');"
new_w = "const wLine = pts.map((r, i) => X(i).toFixed(1) + ',' + Yw(r.weight || 0).toFixed(1)).join(' ');"
old_b = "const bLine = bfPts.map((o, i) => (i ? 'L' : 'M') + X(o.i).toFixed(1) + ',' + Yb(o.v).toFixed(1)).join(' ');"
new_b = "const bLine = bfPts.map((o, i) => X(o.i).toFixed(1) + ',' + Yb(o.v).toFixed(1)).join(' ');"

assert old_w in h, "wLine 未命中"
h = h.replace(old_w, new_w, 1)
assert old_b in h, "bLine 未命中"
h = h.replace(old_b, new_b, 1)

io.open(p, "w", encoding="utf-8", newline="").write(h)
print("polyline points 已修正（去掉 M/L 路径前缀，改用纯 points 语法）")
