"""把工作台左侧栏改成 utopia-workbench 的样式。

参考截图（utopia 侧边栏）要点：
  1. 顶部一只大吉祥物 + 粗标题 + 字距拉开的小标
  2. 一行字距拉开的小节标签（WORKSPACE）
  3. 导航项 = 圆形彩色图标 + 文案；激活态是**白色药丸**，不再用左侧竖条
  4. 底部：同步状态药丸 + 导出备份 / 导入恢复 三个药丸

素材用用户自己的 assets/derived/base.huhu.png（base64 内联，file:// 与 dist 都能用）。
同步状态用 location.protocol 判断（与同步层 online() 同一判据）；
导出/导入直接接现成的 exportWorkbenchData() / importWorkbenchData()。
"""
import base64
import io
import re
import shutil

SRC = r"D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
BACKUP = r"D:/桌宠/淘金矿工小屋/_backup-pre-sidebar.html"
MASCOT = r"D:/桌宠/assets/derived/base.huhu.png"

# 五色圆形图标（截图里 主页粉 / 任务进程橙红 / 健身黄 / 成长蓝 / 新媒体绿）
NAV_TINTS = [
    "rgba(255, 123, 172, 0.22)",   # 粉
    "rgba(255, 109, 77, 0.22)",    # 橙红
    "rgba(255, 197, 61, 0.30)",    # 黄
    "rgba(77, 159, 255, 0.20)",    # 蓝
    "rgba(63, 191, 111, 0.20)",    # 绿
]

NEW_SIDEBAR_CSS = """
    /* ===== 侧边栏（utopia 风格）===== */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--side-bg);
      border-right: 1px solid var(--side-line);
      display: flex; flex-direction: column; overflow: hidden;
      flex-shrink: 0; box-shadow: 3px 0 16px rgba(39, 53, 47, 0.06);
    }
    .sidebar-header {
      padding: 22px 16px 10px; text-align: center; border-bottom: none;
      background: transparent; flex-shrink: 0;
    }
    .sidebar-mascot {
      width: 122px; margin: 0 auto 4px; display: block;
      filter: drop-shadow(0 6px 14px rgba(39, 53, 47, 0.14));
    }
    .sidebar-logo {
      font-family: var(--font-display); font-size: 17px; color: var(--ink);
      letter-spacing: .4px; font-weight: 800; line-height: 1.3;
    }
    .sidebar-subtitle {
      font-size: 10px; letter-spacing: 3.5px; text-transform: uppercase;
      color: #8C6119; font-weight: 700; margin-top: 5px;
    }
    .sidebar-section {
      padding: 14px 20px 6px; font-size: 10px; letter-spacing: 3px;
      color: #8C6119; font-weight: 700; flex-shrink: 0;
    }
    .sidebar-nav { flex: 1; overflow-y: auto; padding: 0 10px 8px; }
    .nav-item {
      display: flex; align-items: center; gap: 11px; min-height: 46px; padding: 0 12px;
      color: var(--side-ink); cursor: pointer; font-size: 14.5px;
      border-radius: 999px; margin-bottom: 2px;
      transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .nav-item:hover { background: rgba(255, 255, 255, 0.45); }
    .nav-item.active {
      background: #FFFFFF; color: var(--ink); font-weight: 700;
      box-shadow: 0 2px 10px rgba(39, 53, 47, 0.12);
    }
    .nav-icon {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; font-size: 15px;
      transition: transform var(--dur-fast) var(--ease);
    }
    .nav-item:hover .nav-icon { transform: scale(1.08); }
    .nav-item.active .nav-icon { box-shadow: 0 0 0 2px #FFFFFF; }
    .sidebar-bottom {
      padding: 8px 12px calc(10px + env(safe-area-inset-bottom)); flex-shrink: 0;
      border-top: 1px solid var(--side-line);
      display: flex; flex-direction: column; gap: 6px;
    }
    .side-pill {
      display: flex; align-items: center; justify-content: center; gap: 7px;
      min-height: 36px; padding: 0 12px; border: none; cursor: pointer;
      background: rgba(255, 255, 255, 0.55); border-radius: 999px;
      font-family: var(--font-base); font-size: 12.5px; font-weight: 600;
      color: var(--side-ink); width: 100%;
      transition: background var(--dur-fast) var(--ease);
    }
    .side-pill:hover { background: rgba(255, 255, 255, 0.85); }
    .side-pill .dot {
      width: 7px; height: 7px; border-radius: 50%; background: var(--teal);
      flex-shrink: 0; box-shadow: 0 0 0 3px rgba(39, 169, 115, 0.18);
    }
    .miner-avatar { font-size: 22px; }
"""

NEW_SIDEBAR_HTML = """<aside data-page-node-id="9fXKyCrMQl5BYiJrf3GuZr" class="sidebar" id="sidebar">
      <div data-page-node-id="v0zoF7R1PodyS42h1PIpcE" class="sidebar-header">
        <img data-page-node-id="UWooamDAjxPmJYbHmn7PHN" class="sidebar-mascot" src="{mascot}" alt="淘金矿工小屋吉祥物">
        <div data-page-node-id="UWooamDAjxPmJYbHmn7PHN" class="sidebar-logo"><!--pnid:TDGF71ZVH2y7M7dw6wd86U-->淘金矿工小屋</div>
        <div data-page-node-id="Dc5rfcz8xExQltznMHWg67" class="sidebar-subtitle"><!--pnid:1JWd7zqj410OQKY0hLEkcJ-->GOLDMINER HUT</div>
      </div>
      <div class="sidebar-section">WORKSPACE</div>
      <nav data-page-node-id="x8ROGVEnASRzd3oWeqR5Bj" class="sidebar-nav" id="sidebarNav"></nav>
      <div data-page-node-id="jEup80Y7DlyztKFyBLjuUs" class="sidebar-bottom">
        <div class="side-pill" id="syncPill"><span class="dot" id="syncDot"></span><span id="syncText">云端已同步</span></div>
        <button class="side-pill" onclick="exportWorkbenchData()">⬇ 导出备份</button>
        <button class="side-pill" onclick="importWorkbenchData()">⬆ 导入恢复</button>
      </div>
    </aside>"""

OLD_RENDER = """      html += `<div class="nav-item ${active}" onclick="navTo('${item.key}');closeSidebar();"><span class="nav-icon">${item.icon}</span><span class="nav-label">${item.name}</span>${badge}</div>`;"""

NEW_RENDER = """      const tint = NAV_TINTS[NAV_CONFIG.indexOf(item) % NAV_TINTS.length];
      html += `<div class="nav-item ${active}" onclick="navTo('${item.key}');closeSidebar();"><span class="nav-icon" style="background:${tint}">${item.icon}</span><span class="nav-label">${item.name}</span>${badge}</div>`;"""

SYNC_FN = """
  function updateSyncPill() {
    var t = document.getElementById('syncText'), d = document.getElementById('syncDot');
    if (!t) return;
    var online = location.protocol !== 'file:';   // 与同步层 online() 同一判据
    t.textContent = online ? '云端已同步' : '本地模式';
    if (d) d.style.background = online ? 'var(--teal)' : 'var(--amber)';
  }
  window.updateSyncPill = updateSyncPill;
"""


def main() -> None:
    html = io.open(SRC, encoding="utf-8").read()
    shutil.copyfile(SRC, BACKUP)
    print("backup ->", BACKUP)

    # 1) 侧边栏 HTML 整块替换
    m = re.search(r"<aside[^>]*id=\"sidebar\">[\s\S]*?</aside>", html)
    assert m, "找不到 <aside id=sidebar>"
    mascot = "data:image/png;base64," + base64.b64encode(io.open(MASCOT, "rb").read()).decode()
    new_html_block = NEW_SIDEBAR_HTML.replace("{mascot}", mascot)
    html = html[:m.start()] + new_html_block + html[m.end():]
    print("侧边栏 HTML 已替换（吉祥物 base64 %d 字符）" % len(mascot))

    # 2) CSS：整块换掉侧边栏相关规则
    css_swaps = [
        (re.compile(r"\.sidebar \{[\s\S]*?\n    \}"), NEW_SIDEBAR_CSS.split("/* ===== 侧边栏（utopia 风格）===== */\n")[1].rsplit(".miner-avatar", 1)[0].rstrip() + "\n    "),
    ]
    for pat, rep in css_swaps:
        html, n = pat.subn(lambda _mo: rep, html, count=1)
        print("CSS .sidebar 块替换:", "OK" if n else "未命中")

    # 3) renderSidebar：图标加彩色底
    assert OLD_RENDER in html, "找不到 renderSidebar 的模板块"
    html = html.replace(OLD_RENDER, NEW_RENDER, 1)
    print("renderSidebar 已改为彩色圆底图标")

    # 4) NAV_TINTS 常量 + 同步状态函数
    anchor = "  const PAGE_RENDERERS = {"
    assert anchor in html
    tints = "  const NAV_TINTS = [" + ", ".join('"%s"' % c for c in NAV_TINTS) + "];\n"
    html = html.replace(anchor, tints + anchor, 1)
    print("NAV_TINTS 已注入")

    # updateSyncPill 挂在 initApp 定义之前
    m2 = re.search(r"\n(  function initApp\(\) \{)", html)
    assert m2, "找不到 initApp"
    html = html[:m2.start()] + "\n" + SYNC_FN + "\n" + html[m2.start():]
    print("updateSyncPill 已注入")

    # initApp 里调用一次
    html, n = re.subn(r"(function initApp\(\) \{\n)", r"\1    updateSyncPill();\n", html, count=1)
    print("initApp 挂载 updateSyncPill:", "OK" if n else "未命中")

    io.open(SRC, "w", encoding="utf-8", newline="").write(html)
    print("written ->", SRC)


if __name__ == "__main__":
    main()
