"""把 淘金矿工小屋 工作台换肤成 utopia-workbench 的设计语言。

参考站: https://utopia-workbench-13888.app.workbuddy.host/
其设计令牌（从该页 CSS 里提取）：
  bg #FFF6EA / surface #FFFDF8 / surface-2 #FDF1E2 / sunken #F6E9D8
  ink #27352F · #5C6B63 · #93A099
  accent #FF6D24 (+ink #FFF6EA, soft rgba(255,109,36,.14))
  teal #27A973 · amber #E8A33D · danger #E84A3C · violet #8A7BE8
  side-bg #F7DC8B · side-line rgba(39,53,47,.16) · side-active rgba(255,255,255,.55)
  radius 16/10/24 · 999px 药丸
  shadow-1 0 1px 3px rgba(39,53,47,.06) · shadow-2 0 6px 20px rgba(39,53,47,.08)
  ease cubic-bezier(.16,1,.3,1) · 160/320/640ms
  font-num "Nunito","IBM Plex Mono","Bahnschrift","Consolas",ui-monospace
  font-body "Nunito","PingFang SC","Microsoft YaHei UI",...

做法：工作台 350 处引用全走 CSS 变量，所以主体是 **:root 重映射**；
再把 ~60 处硬编码的旧暖金色 rgba 直接换成橙色系同透明度；最后三处组件级调整
（body 背景 / 侧边栏底色与描边 / 侧边栏头描边）。
"""
import io
import re
import shutil
import sys

SRC = r"D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
BACKUP = r"D:/桌宠/淘金矿工小屋/_backup-pre-restyle.html"

# ---- 1) 变量重映射（旧值 -> utopia 值，键名不变，350 处 var() 引用零改动）----
ROOT_MAP = {
    # 基底 / 表面
    "--bg-deepest": "#F6E9D8",
    "--bg-dark": "#FDF1E2",
    "--bg-cave": "#FDF1E2",
    "--bg-panel": "#FFF6EA",
    "--bg-card": "#FFFDF8",
    "--bg-card-hover": "#FDF1E2",
    # 强调色族：暖金 -> 亮橙
    "--gold-bright": "#E85A12",
    "--gold": "#FF6D24",
    "--gold-dark": "#E85A12",
    "--gold-deep": "#C24E0E",
    # 文字：墨绿墨色系
    "--text-cream": "#27352F",
    "--text-warm": "#27352F",
    "--text-gold": "#E85A12",
    "--text-muted": "#5C6B63",
    "--text-dim": "#93A099",
    # 语义色
    "--color-success": "#27A973",
    "--color-danger": "#E84A3C",
    "--color-info": "#8A7BE8",
    "--color-warning": "#E8A33D",
    # 线
    "--line": "rgba(39, 53, 47, 0.10)",
    "--line-soft": "rgba(39, 53, 47, 0.06)",
    # 形状 / 阴影 / 动效
    "--radius": "16px",
    "--radius-sm": "10px",
    "--radius-lg": "24px",
    "--shadow": "0 1px 3px rgba(39, 53, 47, 0.06), 0 1px 2px rgba(39, 53, 47, 0.04)",
    # 字体
    "--font-base": ('"Nunito", "PingFang SC", "Microsoft YaHei UI", '
                    '"Hiragino Sans GB", "Microsoft YaHei", sans-serif'),
    "--font-mono": '"IBM Plex Mono", "Bahnschrift", "Consolas", ui-monospace, monospace',
}

# 新增令牌（utopia 有、工作台没有的）
EXTRA_TOKENS = """
      /* ===== utopia 设计令牌 ===== */
      --bg: #FFF6EA;
      --surface: #FFFDF8;
      --surface-2: #FDF1E2;
      --sunken: #F6E9D8;
      --ink: #27352F;
      --ink-2: #5C6B63;
      --ink-3: #93A099;
      --accent: #FF6D24;
      --accent-ink: #FFF6EA;
      --accent-soft: rgba(255, 109, 36, 0.14);
      --accent-deep: #E85A12;
      --teal: #27A973;
      --amber: #E8A33D;
      --violet: #8A7BE8;
      --ok: #27A973;
      --side-bg: #F7DC8B;
      --side-ink: #27352F;
      --side-line: rgba(39, 53, 47, 0.16);
      --side-active: rgba(255, 255, 255, 0.55);
      --radius-lg2: 24px;
      --shadow-1: 0 1px 3px rgba(39, 53, 47, 0.06), 0 1px 2px rgba(39, 53, 47, 0.04);
      --shadow-2: 0 6px 20px rgba(39, 53, 47, 0.08), 0 2px 6px rgba(39, 53, 47, 0.04);
      --ease: cubic-bezier(.16, 1, .3, 1);
      --dur-fast: 160ms;
      --dur: 320ms;
      --dur-slow: 640ms;
      --font-num: "Nunito", "IBM Plex Mono", "Bahnschrift", "Consolas", ui-monospace, monospace;
      --font-display: "Fredoka", "Baloo 2", "Microsoft YaHei UI", "PingFang SC", "Microsoft YaHei", sans-serif;
"""

# ---- 2) 硬编码色值替换（正则，保透明度）----
RGB_MAP = [
    # 暖金色 tint 家族 -> 橙色 tint 家族
    (r"rgba\(\s*184\s*,\s*137\s*,\s*59\s*,", "rgba(255, 109, 36,"),
    (r"rgba\(\s*218\s*,\s*165\s*,\s*32\s*,", "rgba(232, 90, 18,"),
    (r"rgba\(\s*255\s*,\s*215\s*,\s*0\s*,", "rgba(255, 109, 36,"),
    # 暖棕阴影 -> 墨绿阴影
    (r"rgba\(\s*110\s*,\s*94\s*,\s*66\s*,", "rgba(39, 53, 47,"),
    (r"rgba\(\s*60\s*,\s*48\s*,\s*30\s*,", "rgba(39, 53, 47,"),
    (r"rgba\(\s*94\s*,\s*86\s*,\s*64\s*,", "rgba(39, 53, 47,"),
    # 语义色 tint
    (r"rgba\(\s*124\s*,\s*154\s*,\s*110\s*,", "rgba(39, 169, 115,"),
    (r"rgba\(\s*194\s*,\s*132\s*,\s*110\s*,", "rgba(232, 74, 60,"),
    (r"rgba\(\s*138\s*,\s*160\s*,\s*168\s*,", "rgba(138, 123, 232,"),
]

HEX_MAP = {
    "#E9DFC9": "#F6E9D8", "#EDE3CC": "#FDF1E2", "#E7DCC0": "#FDF1E2",
    "#F4ECDB": "#FFF6EA", "#FBF6EA": "#FFFDF8", "#F7EFDD": "#FDF1E2",
    "#B8893B": "#E85A12", "#C9A24E": "#FF6D24", "#A87C32": "#E85A12",
    "#8C6A2A": "#C24E0E",
    "#6F665A": "#27352F", "#5E5640": "#27352F",
    "#A0927A": "#5C6B63", "#B8AC94": "#93A099",
    "#7C9A6E": "#27A973", "#9CB07C": "#4FC08A",
    "#C2846E": "#E84A3C", "#8AA0A8": "#8A7BE8", "#6E8C98": "#6F5FD1",
    "#C99A6E": "#FF8A4C", "#9C4A2A": "#C2410C",
    "#DDD2BC": "#E3DCD2", "#E8DECB": "#EAE4DA",
}

# ---- 3) 组件级调整（utopia 特有的三处）----
COMPONENT_PATCHES = [
    # body：奶油平底，不再叠渐变
    ("background: linear-gradient(160deg, var(--bg-dark), var(--bg-cave));",
     "background: var(--bg);"),
    # 侧边栏：暖黄实底 + 墨色细描边
    ("background: linear-gradient(180deg, var(--bg-cave), var(--bg-dark));\n      border-right: 1px solid var(--gold-deep);",
     "background: var(--side-bg);\n      border-right: 1px solid var(--side-line);"),
    # 侧边栏头：白纱压顶，描边换成墨色细线
    ("background: rgba(255, 109, 36, 0.10); flex-shrink: 0;",
     "background: rgba(255, 255, 255, 0.40); flex-shrink: 0;"),
]


def main() -> None:
    html = io.open(SRC, encoding="utf-8").read()
    shutil.copyfile(SRC, BACKUP)
    print("backup ->", BACKUP)

    # 1) :root 变量重映射（只在 :root 块内替换，避免误伤别处的同名注释）
    m = re.search(r":root\s*\{", html)
    assert m, "找不到 :root"
    end = html.find("}", m.start())
    root_block = html[m.start():end + 1]

    new_root = root_block
    replaced = 0
    for key, val in ROOT_MAP.items():
        pat = re.compile(r"(" + re.escape(key) + r"\s*:\s*)[^;]+;")
        new_root, n = pat.subn(lambda mo: mo.group(1) + val + ";", new_root)
        replaced += n
    # 把 :root 原有注释后的令牌区补上 utopia 新令牌
    new_root = new_root.rstrip()[:-1].rstrip() + "\n" + EXTRA_TOKENS + "    }"

    html = html[:m.start()] + new_root + html[end + 1:]
    print(f":root 重映射 {replaced} 个变量，新增 {EXTRA_TOKENS.count('--')} 个令牌")

    # 2) 硬编码色值
    total = 0
    for pat, rep in RGB_MAP:
        html, n = re.subn(pat, rep, html)
        total += n
    for old, new in HEX_MAP.items():
        n = html.count(old)
        html = html.replace(old, new)
        total += n
    print(f"硬编码色值替换 {total} 处")

    # 3) 组件级
    comp = 0
    for old, new in COMPONENT_PATCHES:
        if old in html:
            html = html.replace(old, new, 1)
            comp += 1
        else:
            print("  ! 组件补丁未命中:", old[:48].replace("\n", "\\n"))
    print(f"组件级调整 {comp}/{len(COMPONENT_PATCHES)}")

    io.open(SRC, "w", encoding="utf-8", newline="").write(html)
    print("written ->", SRC, len(html), "bytes")


if __name__ == "__main__":
    sys.exit(main())
