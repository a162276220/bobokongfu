"""第三阶段：把用户 utopia 工作台里现成的美术资源接进淘金矿工小屋侧边栏。

资源来源：用户自己的 D:/桌宠/乌托邦工作台-分享版(1)/乌托邦工作台/index.html 里的
ART 对象（base64 内联）。这里只做**搬运与接线**，不生成、不重绘。
版权沿用原作者标注：仅粉丝自用、🈲商用、版权属于 StayReal。

接线项：
  1. .side-bg 壁纸层（ART.sidebg，黄底降饱和版）——absolute 铺满侧栏，内容抬到 z-index:1
  2. 顶部吉祥物换成 ART.bubu（52px 高）
  3. 导航图标换成五球（ART.pink/red/yellow/blue/green），10 个导航项按 pink→red→yellow→
     blue→green 循环（utopia 只有 5 个模块各配一球，这里 10 项轮用同一套）
已降采样：bubu 104px 高、五球 40x40、sidebg 530 宽，7 张合计 53.9KB(base64)。
"""
import io
import json
import re

SRC = r"D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
ART_SMALL = r"D:/_art_small.json"

NEW_CSS = """.sidebar {
      width: 265px;
      background: var(--side-bg);
      border-right: 1px solid var(--side-line);
      display: flex; flex-direction: column; overflow: hidden;
      flex-shrink: 0; padding: 0 14px 14px;
      color: var(--side-ink);
      position: relative;
    }
    .side-bg {
      position: absolute; inset: 0; z-index: 0;
      background-size: cover; background-position: center; pointer-events: none;
    }
    .sidebar > *:not(.side-bg) { position: relative; z-index: 1; }
    .side-stripe {
      height: 6px; margin: 0 -14px 14px; flex: 0 0 6px;
      background: var(--accent); opacity: .95;
    }
    .brand-s {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 4px 6px 0;
    }
    .sidebar-mascot {
      height: 52px; width: auto;
      filter: drop-shadow(0 6px 14px rgba(255, 109, 36, 0.22));
    }
    .brand-tt { display: flex; flex-direction: column; gap: 1px; text-align: center; }
    .sidebar-logo {
      font-size: 14px; font-weight: 600; letter-spacing: .01em;
      line-height: 1.35; color: var(--side-ink);
    }
    .sidebar-subtitle {
      font-family: var(--font-num); font-size: 9.5px; letter-spacing: .2em;
      color: var(--side-ink-3); text-transform: uppercase;
    }
    .sidebar-nav {
      display: flex; flex-direction: column; gap: 3px; margin-top: 24px;
      flex: 1; min-height: 0; overflow-y: auto;
    }
    .nav-label {
      font-family: var(--font-num); font-size: 10px; letter-spacing: .22em;
      color: var(--side-ink-3); text-transform: uppercase; padding: 0 12px;
      margin: 2px 0 6px;
    }
    .nav-item {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 10px 12px; border-radius: 10px; border: 0; background: transparent;
      font-family: var(--font-base); font-size: 14px; font-weight: 400;
      color: var(--side-ink-2); cursor: pointer; text-align: left;
      transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
                  box-shadow var(--dur-fast) var(--ease);
    }
    .nav-ico {
      width: 20px; height: 20px; flex: 0 0 20px; object-fit: contain;
      transition: transform var(--dur) var(--ease);
    }
    .nav-item:hover { background: rgba(255, 255, 255, 0.4); color: var(--side-ink); }
    .nav-item:hover .nav-ico { transform: scale(1.14) rotate(-4deg); }
    .nav-item.active {
      background: var(--side-active); color: var(--side-ink); font-weight: 500;
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .nav-item.active .nav-ico { transform: scale(1.1); }
    .sidebar-bottom {
      display: flex; flex-direction: column; gap: 9px;
      border-top: 1px solid var(--side-line); padding-top: 12px;
    }
    .foot-row { display: flex; gap: 8px; align-items: stretch; }
    .foot-row > * { flex: 1; min-width: 0; }
    .side-pill {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 30px; padding: 0 11px; border-radius: 999px;
      border: 1px solid rgba(39, 53, 47, 0.14); background: rgba(255, 255, 255, 0.55);
      font-family: var(--font-base); font-size: 12px; font-weight: 600;
      color: var(--side-ink); cursor: pointer; white-space: nowrap; width: 100%;
      transition: background var(--dur-fast) var(--ease);
    }
    .side-pill:hover { background: rgba(255, 255, 255, 0.8); }
    .side-pill .dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3);
      flex-shrink: 0;
    }
    .miner-row { display: flex; align-items: center; gap: 8px; padding: 0 4px; }
    .sidebar-bottom .miner-avatar { font-size: 18px; line-height: 1; }
    .sidebar-bottom .miner-info { flex: 1; min-width: 0; }
    .sidebar-bottom .miner-name { font-size: 12.5px; color: var(--side-ink); font-weight: 600; }
    .sidebar-bottom .miner-level { font-size: 11px; color: var(--side-ink-3); }
    """

BALL_ORDER = ['pink', 'red', 'yellow', 'blue', 'green']


def main() -> None:
    art = json.load(io.open(ART_SMALL, encoding="utf-8"))
    html = io.open(SRC, encoding="utf-8").read()

    # ---- 1) CSS 整段重写（加 .side-bg 壁纸层与 z-index 抬升）
    start = html.find(".sidebar {")
    assert start > 0
    end = html.find(".sidebar-nav::-webkit-scrollbar", start)
    assert end > start
    html = html[:start] + NEW_CSS + "\n    " + html[end:]
    print("CSS 已重写（含 .side-bg 壁纸层）")

    # ---- 2) 侧边栏 HTML：插入壁纸层 + 吉祥物换 bubu
    m = re.search(r"(<aside[^>]*id=\"sidebar\">\n)", html)
    assert m, "找不到 <aside id=sidebar>"
    bg_div = ('      <div class="side-bg" aria-hidden="true" style="background-image:url('
              + art['sidebg'] + ')"></div>\n')
    html = html[:m.end()] + bg_div + html[m.end():]
    print("壁纸层已插入")

    # 吉祥物：把 data:huhu 换成 ART.bubu（按 data-page-node-id 定位那条 img）
    m2 = re.search(r"(<img[^>]*class=\"sidebar-mascot\"[^>]*src=\")(data:image/[^\"]+)(\")", html)
    assert m2, "找不到 sidebar-mascot"
    html = html[:m2.start(2)] + art['bubu'] + html[m2.end(2):]
    print("吉祥物已换为 ART.bubu")

    # ---- 3) 导航图标：NAV_ICOS(宠物头像) -> NAV_BALLS(五球，循环)
    m3 = re.search(r"const NAV_ICOS = \{[\s\S]*?\};", html)
    assert m3, "找不到 NAV_ICOS"
    balls = ",".join("'%s': '%s'" % (k, art[k]) for k in BALL_ORDER)
    html = html[:m3.start()] + "const NAV_BALLS = {" + balls + "};" + html[m3.end():]
    print("NAV_ICOS 已替换为 NAV_BALLS（五球）")

    old_render = """src="${NAV_ICOS[item.key] || ''}\""""
    new_render = """src="${NAV_BALLS[NAV_CONFIG.indexOf(item) % NAV_BALLS.length]}\""""
    assert old_render in html, "找不到 renderSidebar 图标片段"
    html = html.replace(old_render, new_render, 1)
    print("renderSidebar 已改为五球循环")

    io.open(SRC, "w", encoding="utf-8", newline="").write(html)
    print("written ->", SRC)


if __name__ == "__main__":
    main()
