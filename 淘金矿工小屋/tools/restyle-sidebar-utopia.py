"""第二阶段：侧边栏按 utopia-workbench 的**精确数值**重写。

源: D:/桌宠/乌托邦工作台-分享版(1)/乌托邦工作台/index.html
差异声明：导航图标与顶部吉祥物不用源里的卜卜/五球美术（StayReal 版权），
改用本工程 16 只宠物里挑 10 只的 idle 首帧（icons/<key>.png，44x48）。

逐项对齐的源数值：
  .side        265px / padding 0 14px 14px / bg side-bg / border-right side-line
  .side-stripe 6px，margin 0 -14px 14px，bg accent，opacity .95
  .brand-s     flex column center，gap 10px，padding 4px 6px 0
  .bubu-img    height 52px，drop-shadow(0 6px 14px rgba(255,109,36,.22))
  .t1          14px / 600 / side-ink；.t2  font-num 9.5px / .2em / side-ink-3 / uppercase
  .nav         column gap 3px margin-top 24px
  .nav-label   font-num 10px / .22em / side-ink-3 / uppercase / padding 0 12px
  .nav-item    padding 10px 12px / radius 10px / 14px 400 / side-ink-2 / gap 10px
  .wq-icon     20x20 object-fit contain；hover scale(1.14) rotate(-4deg)
  selected     bg side-active(白 .55) + inset 3px 0 0 accent + side-ink 500
  .side-foot   column gap 9px / border-top side-line / padding-top 12px
  .sync-pill   bg 白 .55 / border rgba(39,53,47,.14) / side-ink
  .btn-sm      min-height 30px / padding 0 11px / 12px
"""
import base64
import io
import re

SRC = r"D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
ICONS = r"D:/桌宠/淘金矿工小屋/icons"

NEW_CSS = """.sidebar {
      width: 265px;
      background: var(--side-bg);
      border-right: 1px solid var(--side-line);
      display: flex; flex-direction: column; overflow: hidden;
      flex-shrink: 0; padding: 0 14px 14px;
      color: var(--side-ink);
    }
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

KEEP_FROM = ".sidebar-nav::-webkit-scrollbar"


def b64(path):
    return "data:image/png;base64," + base64.b64encode(io.open(path, "rb").read()).decode()


def main() -> None:
    html = io.open(SRC, encoding="utf-8").read()

    # ---- 1) CSS：从 .sidebar { 起到保留的 scrollbar 规则前，整段重写
    start = html.find(".sidebar {")
    assert start > 0, "找不到 .sidebar {"
    end = html.find(KEEP_FROM, start)
    assert end > start, "找不到保留锚点 " + KEEP_FROM
    html = html[:start] + NEW_CSS + "\n    " + html[end:]
    print("CSS 重写完成（对齐 utopia 精确数值）")

    # ---- 2) HTML：侧边栏整块替换（品牌区 + 顶条 + 底部三药丸 + 矿工卡）
    m = re.search(r"<aside[^>]*id=\"sidebar\">[\s\S]*?</aside>", html)
    assert m, "找不到 <aside id=sidebar>"
    mascot = b64(r"D:/桌宠/assets/derived/base.huhu.png")
    new_side = """<aside data-page-node-id="9fXKyCrMQl5BYiJrf3GuZr" class="sidebar" id="sidebar">
      <div class="side-stripe"></div>
      <div data-page-node-id="v0zoF7R1PodyS42h1PIpcE" class="brand-s">
        <img data-page-node-id="UWooamDAjxPmJYbHmn7PHN" class="sidebar-mascot" src="{mascot}" alt="淘金矿工小屋">
        <div class="brand-tt">
          <div data-page-node-id="UWooamDAjxPmJYbHmn7PHN" class="sidebar-logo"><!--pnid:TDGF71ZVH2y7M7dw6wd86U-->淘金矿工小屋</div>
          <div data-page-node-id="Dc5rfcz8xExQltznMHWg67" class="sidebar-subtitle"><!--pnid:1JWd7zqj410OQKY0hLEkcJ-->GOLDMINER HUT</div>
        </div>
      </div>
      <nav data-page-node-id="x8ROGVEnASRzd3oWeqR5Bj" aria-label="模块导航" class="sidebar-nav" id="sidebarNav" role="tablist">
        <p class="nav-label">Workspace</p>
      </nav>
      <div data-page-node-id="jEup80Y7DlyztKFyBLjuUs" class="sidebar-bottom">
        <div class="miner-row">
          <div class="miner-avatar">🧑‍🌾</div>
          <div class="miner-info">
            <div class="miner-name">矿工老铁</div>
            <div class="miner-level" id="minerLevel">Lv.1 见习矿工</div>
          </div>
        </div>
        <div class="foot-row">
          <div class="side-pill" id="syncPill"><span class="dot" id="syncDot"></span><span id="syncText">本地模式</span></div>
          <button class="side-pill" onclick="exportWorkbenchData()">导出备份</button>
        </div>
        <button class="side-pill" onclick="importWorkbenchData()">导入恢复</button>
      </div>
    </aside>""".replace("{mascot}", mascot)
    html = html[:m.start()] + new_side + html[m.end():]
    print("侧边栏 HTML 已按 utopia 结构重写")

    # ---- 3) renderSidebar：图标改用宠物头像 <img class="nav-ico">
    old_render = """<span class="nav-icon" style="background:${tint}">${item.icon}</span>"""
    new_render = """<img class="nav-ico" src="${NAV_ICOS['${item.key}'] || ''}" alt="">"""
    assert old_render in html, "找不到 renderSidebar 的图标片段"
    html = html.replace(old_render, new_render, 1)

    icos = ",".join(
        "'%s': '%s'" % (k, b64(ICONS + "/" + k + ".png")) for k in
        ['dashboard', 'diet', 'exercise', 'accounting', 'pet-yard', 'shop',
         'inventory', 'cabin', 'achievement', 'jianghu'])
    anchor = "  const NAV_TINTS = "
    assert anchor in html, "找不到 NAV_TINTS"
    html = html.replace(anchor,
        "  const NAV_ICOS = {" + icos + "};\n" + anchor, 1)
    print("renderSidebar 已改为宠物头像图标（10 枚 base64）")

    io.open(SRC, "w", encoding="utf-8", newline="").write(html)
    print("written ->", SRC)


if __name__ == "__main__":
    main()
