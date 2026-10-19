# -*- coding: utf-8 -*-
"""第二期 utopia 移植：成长目标（growth）+ 新媒体工作台（media）
锚点全部 assert count==1，失败即停，不污染文件。
"""
import io, re, shutil, subprocess, sys

BASE = r"D:/桌宠/淘金矿工小屋"
SRC = BASE + "/淘金矿工小屋·自律工作台.html"
WX = BASE + "/wuxia-content.js"
NODE = r"C:/Users/HUAWEI/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
TMP_JS = BASE + "/_syntax_check.js"

h = io.open(SRC, encoding="utf-8").read()
orig_len = len(h)
shutil.copy(SRC, BASE + "/_backup-pre-phase2.html")
shutil.copy(WX, WX + ".bak-phase2")

# ---------- 1. 导航 ----------
nav_old = "    { key: 'planner',     name: '计划月历',     icon: '🗓️' },\n  ];"
nav_new = ("    { key: 'planner',     name: '计划月历',     icon: '🗓️' },\n"
           "    { key: 'growth',      name: '成长目标',     icon: '🌱' },\n"
           "    { key: 'media',       name: '新媒体工作台', icon: '📣' },\n  ];")
assert h.count(nav_old) == 1, "NAV_CONFIG 锚点未命中"
h = h.replace(nav_old, nav_new, 1)

# ---------- 2. 数据层 ----------
st_old = """      bodyBonusDate: null,
      lastActiveDate: todayStr(),"""
st_new = """      bodyBonusDate: null,
      /* ===== utopia 移植 · 第二期：成长目标 ===== */
      growth: [],
      growthBonusDate: null,
      /* ===== utopia 移植 · 第二期：新媒体工作台 ===== */
      media: { items: [], kpi: [] },
      mediaBonusDate: null,
      lastActiveDate: todayStr(),"""
assert h.count(st_old) == 1, "defaultState 锚点未命中"
h = h.replace(st_old, st_new, 1)

# ---------- 3. CSS ----------
css_end = h.find('</style>')
assert css_end > 0, "找不到 </style>"
CSS2 = """
  /* ============================================================
     utopia 移植 · 第二期：成长目标 / 新媒体工作台
     ============================================================ */
    .utp-card { background: var(--bg-card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 14px; box-shadow: var(--shadow); }
    .utp-card-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .utp-card-title { font-weight: 800; font-size: 15px; color: var(--text-cream); }
    .utp-note { font-size: 12px; color: var(--text-muted); }
    .utp-notice { display: flex; gap: 10px; align-items: flex-start; background: rgba(255,109,36,0.06); border: 1px solid rgba(255,109,36,0.18); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 13px; color: var(--text-warm); margin-bottom: 14px; line-height: 1.6; }
    .utp-notice b { color: var(--gold-bright); }
    .utp-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .utp-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 900px) { .utp-grid4, .utp-grid3 { grid-template-columns: repeat(2, 1fr); } }
    .utp-ring { display: flex; flex-direction: column; align-items: center; gap: 6px; background: var(--bg-panel); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: 12px 8px; }
    .utp-ring svg { display: block; }
    .utp-ring svg circle { fill: none; stroke-width: 7; }
    .utp-ring .tr { stroke: var(--line); }
    .utp-ring .fg { stroke: var(--gold); stroke-linecap: round; transition: stroke-dasharray .35s ease; }
    .utp-ring .pct { font-size: 15px; font-weight: 800; fill: var(--text-cream); }
    .utp-ring .lbl { font-size: 12.5px; font-weight: 700; color: var(--text-warm); }
    .utp-ring .sub { font-size: 11px; color: var(--text-muted); }
    .utp-rows { display: flex; flex-direction: column; gap: 8px; }
    .utp-row { display: flex; align-items: center; gap: 10px; background: var(--bg-panel); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: 10px 12px; }
    .utp-row .rt { flex: 1; min-width: 0; font-size: 13.5px; color: var(--text-warm); }
    .utp-row .rt .sub { display: block; font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }
    .utp-row.done .rt { text-decoration: line-through; color: var(--text-dim); }
    .utp-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(255,109,36,0.12); color: var(--gold-bright); font-weight: 700; white-space: nowrap; }
    .utp-tag.t-done { background: rgba(39,169,115,0.14); color: var(--color-success); }
    .utp-tag.t-pub  { background: rgba(39,169,115,0.14); color: var(--color-success); }
    .utp-tag.t-make { background: rgba(138,123,232,0.14); color: var(--color-info); }
    .utp-tag.t-adopt{ background: rgba(232,163,61,0.16); color: var(--color-warning); }
    .utp-tag.t-over { background: rgba(232,74,60,0.12); color: var(--color-danger); }
    .utp-act { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--bg-card); color: var(--text-warm); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; transition: all .15s ease; }
    .utp-act:hover { border-color: var(--gold); color: var(--gold-bright); background: rgba(255,109,36,0.06); }
    .utp-act.danger:hover { border-color: var(--color-danger); color: var(--color-danger); background: rgba(232,74,60,0.06); }
    .utp-form { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 14px; align-items: end; }
    .utp-form .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .utp-form .f.wide { grid-column: span 2; }
    .utp-form .f.full { grid-column: 1 / -1; }
    .utp-form input, .utp-form select, .utp-form textarea { border: 1px solid var(--line); background: var(--bg-card); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; color: var(--text-warm); font-family: inherit; width: 100%; box-sizing: border-box; }
    .utp-form input:focus, .utp-form select:focus, .utp-form textarea:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(255,109,36,0.12); }
    @media (max-width: 900px) { .utp-form { grid-template-columns: repeat(2, 1fr); } .utp-form .f.full { grid-column: 1 / -1; } }
    .utp-pipe { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    @media (max-width: 900px) { .utp-pipe { grid-template-columns: repeat(2, 1fr); } }
    .utp-lane { background: var(--bg-panel); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: 10px; min-height: 110px; display: flex; flex-direction: column; gap: 8px; }
    .utp-lane-head { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; font-weight: 800; color: var(--text-warm); padding: 0 2px 6px; border-bottom: 1px dashed var(--line); }
    .utp-lane-head .n { font-size: 11px; color: var(--text-dim); font-weight: 700; }
    .utp-item { background: var(--bg-card); border: 1px solid var(--line-soft); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; color: var(--text-warm); }
    .utp-item .it-t { font-weight: 700; line-height: 1.4; }
    .utp-item .it-m { display: flex; gap: 6px; margin-top: 5px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; }
    .utp-item .it-ops { display: flex; gap: 6px; margin-top: 7px; }
    .utp-item .it-ops .utp-act { padding: 2px 8px; font-size: 11px; }
    .utp-prog { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; display: flex; }
    .utp-prog i { display: block; height: 100%; }
    .utp-prog-legend { display: flex; gap: 12px; font-size: 11.5px; color: var(--text-muted); margin-top: 8px; flex-wrap: wrap; }
    .utp-prog-legend b { color: var(--text-warm); }
    .utp-plat { background: var(--bg-panel); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: 12px; }
    .utp-plat .ph { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .utp-plat .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .utp-plat .pn { font-weight: 800; font-size: 13.5px; color: var(--text-warm); }
    .utp-plat .pr { font-size: 11.5px; color: var(--gold-bright); font-weight: 700; margin-bottom: 6px; }
    .utp-plat .pd { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; }
    .utp-plat .pw { margin-top: 8px; font-size: 11.5px; color: var(--text-warm); font-weight: 700; }
    .utp-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
    @media (max-width: 900px) { .utp-kpi { grid-template-columns: repeat(2, 1fr); } }
    .utp-kpi .k { background: var(--bg-panel); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: 12px; text-align: center; }
    .utp-kpi .k .v { font-size: 20px; font-weight: 800; color: var(--text-cream); }
    .utp-kpi .k .v.ok { color: var(--color-success); }
    .utp-kpi .k .v.no { color: var(--color-danger); }
    .utp-kpi .k .l { font-size: 11.5px; color: var(--text-muted); margin-top: 3px; }
    .utp-filters { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .utp-fbtn { border: 1px solid var(--line); background: var(--bg-card); color: var(--text-muted); font-size: 12px; border-radius: 999px; padding: 4px 12px; cursor: pointer; font-weight: 700; transition: all .15s ease; }
    .utp-fbtn.on { background: var(--gold); border-color: var(--gold); color: #fff; }
    .utp-empty { text-align: center; color: var(--text-dim); font-size: 12.5px; padding: 18px 0; }
    .utp-demo-btn { border: 1px dashed var(--line); background: transparent; color: var(--text-dim); font-size: 11.5px; border-radius: 999px; padding: 3px 12px; cursor: pointer; }
    .utp-demo-btn:hover { color: var(--color-danger); border-color: var(--color-danger); }
"""
h = h[:css_end] + CSS2 + h[css_end:]

# ---------- 4. PAGE_RENDERERS + PAGE_TITLES ----------
rend_old = "    'planner':         () => renderPlanner(),\n  };"
rend_new = ("    'planner':         () => renderPlanner(),\n"
            "    'growth':          () => renderGrowth(),\n"
            "    'media':           () => renderMedia(),\n  };")
assert h.count(rend_old) == 1, "PAGE_RENDERERS 锚点未命中"
h = h.replace(rend_old, rend_new, 1)

title_old = "    'jianghu':'江湖·文字武侠', 'planner':'计划月历',\n  };"
title_new = "    'jianghu':'江湖·文字武侠', 'planner':'计划月历', 'growth':'成长目标', 'media':'新媒体工作台',\n  };"
assert h.count(title_old) == 1, "PAGE_TITLES 锚点未命中"
h = h.replace(title_old, title_new, 1)

# ---------- 5. 主 script 尾部注入模块 JS ----------
# 注意：原结构是 if (readyState==='loading') document.addEventListener(...); else initApp();
# 必须整段匹配，插在 else 分支之后
js_close = "document.addEventListener('DOMContentLoaded', initApp);\n  else initApp();"
assert h.count(js_close) == 1, "initApp 锚点未命中"
h = h.replace(js_close, js_close + "\n/* __PHASE2_JS__ */", 1)

JS2 = r"""
  /* ============================================================
     utopia 移植 · 第二期
     D. 成长目标（四条曲线 + 目标清单 + 能力资产盘点）
     E. 新媒体工作台（每日流水线 + 四平台矩阵 + 初稿库 + 月度绩效）
     ============================================================ */
  const GROW_DIRS = ['本职进阶', '自媒体打造', '自由剪辑', '自由教练'];
  const GROW_MAIN = '稳住本职 → 扩宽能力 → 把爱好变成被动收入';
  const MEDIA_PLATFORMS = [
    { n: '抖音官方号', role: '留资信息流', color: '#E85A12', desc: '机构实力与课程价值，稳定输出转化内容', hook: "钩子：家长关心的问题 + 专业解法" },
    { n: '抖音个人号', role: '蹭热点破圈', color: '#E84A3C', desc: '情绪向、热点混剪，负责拉新破圈', hook: "钩子：前 3 秒上冲突或名场面" },
    { n: '视频号',     role: '维护老客户', color: '#27A973', desc: '课程内容与活动回顾，服务已成交家庭', hook: "钩子：本周学了什么 + 家庭作业" },
    { n: '小红书',     role: '图文为主',   color: '#8A7BE8', desc: '家长决策向清单体，做搜索沉淀', hook: "钩子：清单体标题 + 首图信息密度" },
  ];
  const MEDIA_STAGES = [
    { k: '待采用', t: '① 选题检索', d: '入库 3 天未采用自动清除' },
    { k: '已采用', t: '② 完成洗稿', d: '确定采用，进入制作排期' },
    { k: '制作中', t: '③ 分平台制作', d: '剪片 / 图文制作' },
    { k: '已发布', t: '④ 当日已发布', d: '发布后从初稿库移除' },
  ];
  let _mediaFilter = '全部';

  function utpEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function utpMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function utpWeekRange() {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const end = new Date(base); end.setDate(base.getDate() + 7);
    return [base, end];
  }
  function utpRing(pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    const C = 2 * Math.PI * 26, off = C * (1 - p / 100);
    return '<svg width="64" height="64" viewBox="0 0 64 64">' +
      '<circle class="tr" cx="32" cy="32" r="26"></circle>' +
      '<circle class="fg" cx="32" cy="32" r="26" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
      '<text class="pct" x="32" y="36" text-anchor="middle">' + p + '%</text></svg>';
  }

  /* ---------------- D. 成长目标 ---------------- */
  function renderGrowth() {
    const s = getState();
    const goals = s.growth || [];
    const today = todayStr();
    const dirs = GROW_DIRS.map(function (d) {
      const arr = goals.filter(function (g) { return (g.dir || '其他') === d; });
      const pct = arr.length ? arr.reduce(function (a, g) { return a + Math.max(0, Math.min(100, g.pct || 0)); }, 0) / arr.length : 0;
      return { dir: d, pct: Math.round(pct), items: arr.length, done: arr.filter(function (g) { return g.done; }).length };
    });
    const open = goals.filter(function (g) { return !g.done; });
    const overall = (open.length ? open : goals).length ?
      Math.round((open.length ? open : goals).reduce(function (a, g) { return a + (g.pct || 0); }, 0) / (open.length ? open : goals).length) : 0;

    const rings = dirs.map(function (d) {
      return '<div class="utp-ring">' + utpRing(d.pct) +
        '<div class="lbl">' + d.dir + '</div>' +
        '<div class="sub">' + d.done + '/' + d.items + ' 项完成</div></div>';
    }).join('');

    const rows = goals.slice().sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) || ((a.due || '9999') > (b.due || '9999') ? 1 : -1); }).map(function (g) {
      const over = !g.done && g.due && g.due < today;
      const tag = g.done ? '<span class="utp-tag t-done">已完成</span>' : (over ? '<span class="utp-tag t-over">逾期</span>' : '<span class="utp-tag">' + utpEsc(g.dir || '其他') + '</span>');
      const sub = [g.due ? '截止 ' + g.due : '', g.action ? '本月：' + utpEsc(g.action) : ''].filter(Boolean).join(' · ');
      return '<div class="utp-row' + (g.done ? ' done' : '') + '">' + tag +
        '<div class="rt">' + utpEsc(g.name) + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>' +
        '<div style="min-width:70px;text-align:right;font-size:12px;font-weight:800;color:var(--text-warm)">' + Math.max(0, Math.min(100, g.pct || 0)) + '%</div>' +
        '<button class="utp-act" onclick="utpGrowPct(\'' + g.id + '\')">+10%</button>' +
        '<button class="utp-act" onclick="utpGrowDone(\'' + g.id + '\')">' + (g.done ? '↺ 重开' : '✓ 完成') + '</button>' +
        '<button class="utp-act danger" onclick="utpGrowDel(\'' + g.id + '\')">✕</button></div>';
    }).join('') || '<div class="utp-empty">还没有目标，先在下面加一条</div>';

    return '<div class="module-header"><div class="mh-icon">🌱</div>' +
      '<div><div class="mh-title">成长目标</div><div class="mh-desc">四条曲线 · 把「会什么」沉淀成可交付的资产</div></div>' +
      '<div class="mh-spacer"></div>' +
      '<div class="header-coin-display"><span class="coin-icon">🌱</span><span class="coin-amount">' + open.length + '</span></div></div>' +
      '<div class="utp-notice">🧭 主线：<b>' + GROW_MAIN + '</b>。' +
      '四条曲线共用一套内容资产：本职保现金流、自媒体做流量、剪辑出产能、教练做交付。整体进度 <b>' + overall + '%</b>。</div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">📈 四条曲线进度</span>' +
      '<span class="utp-note">按方向聚合，取该方向目标进度的均值</span></div>' +
      '<div class="utp-grid4">' + rings + '</div></div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">🎯 目标清单</span>' +
      '<span class="utp-note">' + goals.length + ' 条 · 未完成 ' + open.length + ' 条</span></div>' +
      '<div class="utp-form">' +
      '<div class="f"><label>方向</label><select id="gDir">' + GROW_DIRS.map(function (d) { return '<option>' + d + '</option>'; }).join('') + '</select></div>' +
      '<div class="f wide"><label>目标</label><input id="gName" placeholder="如：拿到 3 个长期客户"></div>' +
      '<div class="f"><label>进度（%）</label><input id="gPct" type="number" min="0" max="100" step="1" placeholder="20"></div>' +
      '<div class="f"><label>截止日期</label><input id="gDue" type="date"></div>' +
      '<div class="f"><label>&nbsp;</label><button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="utpGrowAdd()">＋ 添加目标</button></div>' +
      '<div class="f full"><label>本月行动</label><input id="gAct" placeholder="如：做 3 条样片 + 挂 2 个接单渠道"></div>' +
      '</div><div class="utp-rows">' + rows + '</div></div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">🧰 能力资产盘点</span>' +
      '<span class="utp-note">每条曲线沉淀出的可交付产品</span></div>' +
      '<div class="utp-grid3">' +
      '<div class="utp-plat"><div class="pn">📄 内容资产</div><div class="pd">选题库 / 初稿库 / 成片与图文模板，一条内容四个平台复用，产能复利。</div></div>' +
      '<div class="utp-plat"><div class="pn">🧩 技能资产</div><div class="pd">剪辑模板、话术库、排课体系——可单独售卖的交付件，从时间换钱转向产品换钱。</div></div>' +
      '<div class="utp-plat"><div class="pn">👥 信任资产</div><div class="pd">私域社群、老客户复购与转介绍，留资 → 成交 → 转介绍的最短闭环。</div></div>' +
      '</div></div>';
  }
  function utpGrowAdd() {
    const name = (document.getElementById('gName') && document.getElementById('gName').value || '').trim();
    if (!name) { showToast('先写一条目标', 'warning'); return; }
    const s = getState();
    s.growth = s.growth || [];
    s.growth.push({
      id: 'gr_' + Date.now(),
      dir: (document.getElementById('gDir') && document.getElementById('gDir').value) || '本职进阶',
      name: name,
      pct: Math.max(0, Math.min(100, parseInt((document.getElementById('gPct') && document.getElementById('gPct').value) || '0', 10) || 0)),
      due: (document.getElementById('gDue') && document.getElementById('gDue').value) || '',
      action: (document.getElementById('gAct') && document.getElementById('gAct').value) || '',
      done: false, createdAt: new Date().toISOString(), demo: false,
    });
    saveState();
    const h = awardDailyHours('growth', '成长目标');
    if (h) showToast('⚔️ 今日首次维护成长目标， +' + h + ' 个修炼时辰', 'info');
    renderGrowth();
  }
  function utpGrowPct(id) {
    const s = getState(); const g = (s.growth || []).find(function (x) { return x.id === id; });
    if (!g) return;
    g.pct = Math.min(100, (g.pct || 0) + 10);
    if (g.pct >= 100) g.done = true;
    saveState();
    if (g.pct >= 100 && !g._toasted) { g._toasted = 1; addCoins(3, '目标完成 ' + g.name); showToast('🎉 目标完成「' + g.name + '」 +3 金币', 'success'); }
    renderGrowth();
  }
  function utpGrowDone(id) {
    const s = getState(); const g = (s.growth || []).find(function (x) { return x.id === id; });
    if (!g) return;
    g.done = !g.done;
    if (g.done) { g.pct = 100; addCoins(3, '目标完成 ' + g.name); const hh = awardDailyHours('growth', '成长目标'); showToast('🎉 目标完成 +3 金币' + (hh ? ' + ' + hh + ' 时辰' : ''), 'success'); }
    saveState(); renderGrowth();
  }
  function utpGrowDel(id) {
    const s = getState();
    s.growth = (s.growth || []).filter(function (x) { return x.id !== id; });
    saveState(); renderGrowth();
  }
  function clearGrowthDemo() {
    const s = getState();
    const n = (s.growth || []).filter(function (g) { return g.demo; }).length;
    s.growth = (s.growth || []).filter(function (g) { return !g.demo; });
    saveState(); renderGrowth();
    if (n) showToast('已清空 ' + n + ' 条示例目标', 'info');
  }

  /* ---------------- E. 新媒体工作台 ---------------- */
  function mediaItems(s) { return (s.media && s.media.items) || []; }
  function renderMedia() {
    utpCleanStaleTopics();
    const s = getState();
    const items = mediaItems(s);
    const today = todayStr();
    const [wkStart, wkEnd] = utpWeekRange();
    const wkIso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const wkS = wkIso(wkStart), wkE = wkIso(new Date(wkEnd));

    /* 流水线：待采用/已采用/制作中/已发布 四道 */
    const lanes = MEDIA_STAGES.map(function (st) {
      const arr = items.filter(function (i) { return i.stage === st.k; }).sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
      const cards = arr.map(function (i) {
        var isPub = st.k === '已发布';
        var over = !isPub && i.date && i.date < today;
        var plat = MEDIA_PLATFORMS.filter(function (x) { return x.n === i.plat; })[0] || { color: 'var(--text-muted)' };
        var meta = '<span style="color:' + plat.color + '">' + utpEsc(i.plat) + '</span>';
        if (i.pub) meta += '<span>计划 ' + i.pub + '</span>';
        if (over) meta += '<span style="color:var(--color-danger)">逾期</span>';
        if (i.src) meta += '<span>' + utpEsc(i.src) + '</span>';
        var ops = '';
        if (isPub) {
          ops += '<button class="utp-act" onclick="utpMediaUndoPub(\'' + i.id + '\')">↺ 退回重做</button>';
        } else {
          var ni = MEDIA_STAGES.findIndex(function (x) { return x.k === i.stage; });
          var nxt = ni >= 0 && MEDIA_STAGES[ni + 1] ? MEDIA_STAGES[ni + 1].t.replace(/^[①②③④]\s*/, '') : '';
          ops += '<button class="utp-act" onclick="utpMediaAdvance(\'' + i.id + '\')">▸ ' + nxt + '</button>';
        }
        ops += '<button class="utp-act danger" onclick="utpMediaDel(\'' + i.id + '\')">✕</button>';
        var html = '<div class="utp-item"><div class="it-t">' + utpEsc(i.title) + '</div>';
        html += '<div class="it-m">' + meta + '</div>';
        if (i.note) html += '<div class="it-m"><span>📝 ' + utpEsc(i.note) + '</span></div>';
        html += '<div class="it-ops">' + ops + '</div></div>';
        return html;
      }).join('');
      return '<div class="utp-lane"><div class="utp-lane-head"><span>' + st.t + '</span><span class="n">' + arr.length + '</span></div>' +
        (cards || '<div class="utp-empty" style="padding:14px 0">暂无</div>') + '</div>';
    }).join('');

    /* 进度条 */
    const segs = MEDIA_STAGES.map(function (st, i) {
      const n = items.filter(function (x) { return x.stage === st.k; }).length;
      const colors = ['var(--color-warning)', '#E8A33D', 'var(--color-info)', 'var(--color-success)'];
      return n ? '<i style="width:' + (n / Math.max(1, items.length) * 100) + '%;background:' + colors[i] + '"></i>' : '';
    }).join('');
    const legend = MEDIA_STAGES.map(function (st, i) {
      const n = items.filter(function (x) { return x.stage === st.k; }).length;
      const colors = ['var(--color-warning)', '#E8A33D', 'var(--color-info)', 'var(--color-success)'];
      return '<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + colors[i] + ';margin-right:4px"></i>' + st.t.replace(/^[①②③④]\s*/, '') + ' <b>' + n + '</b></span>';
    }).join('');

    /* 四平台矩阵 */
    const plats = MEDIA_PLATFORMS.map(function (p) {
      const wk = items.filter(function (i) { return i.plat === p.n && i.stage === '已发布' && i.pub >= wkS && i.pub <= wkE; }).length;
      const open = items.filter(function (i) { return i.plat === p.n && i.stage !== '已发布'; }).length;
      return '<div class="utp-plat"><div class="ph"><span class="dot" style="background:' + p.color + '"></span><span class="pn">' + p.n + '</span></div>' +
        '<div class="pr">' + p.role + '</div><div class="pd">' + p.desc + '<br>' + p.hook + '</div>' +
        '<div class="pw">本周已发 ' + wk + ' 条 · 在途 ' + open + ' 条</div></div>';
    }).join('');

    /* 初稿库（非已发布，带过滤） */
    const drafts = items.filter(function (i) { return i.stage !== '已发布'; })
      .filter(function (i) { return _mediaFilter === '全部' || i.stage === _mediaFilter; })
      .sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    const draftRows = drafts.map(function (i) {
      const stageTag = { '待采用': '', '已采用': 't-adopt', '制作中': 't-make' }[i.stage] || '';
      return '<div class="utp-row"><span class="utp-tag ' + stageTag + '">' + i.stage + '</span>' +
        '<div class="rt">' + utpEsc(i.title) + '<span class="sub">' + utpEsc(i.plat) + (i.pub ? ' · 计划 ' + i.pub : '') + (i.src ? ' · ' + utpEsc(i.src) : '') + '</span></div>' +
        (i.stage !== '已发布' ? '<button class="utp-act" onclick="utpMediaAdvance(\'' + i.id + '\')">▸ 推进</button>' : '') +
        '<button class="utp-act danger" onclick="utpMediaDel(\'' + i.id + '\')">✕</button></div>';
    }).join('') || '<div class="utp-empty">这个状态下没有初稿</div>';
    const fbtns = ['待采用', '已采用', '制作中', '全部'].map(function (f) {
      return '<button class="utp-fbtn' + (_mediaFilter === f ? ' on' : '') + '" onclick="utpMediaFilter(\'' + f + '\')">' + f + '</button>';
    }).join('');

    /* 月度绩效 */
    const km = utpMonth();
    const kpiRec = ((s.media && s.media.kpi) || []).find(function (k) { return k.month === km; });
    const lyT = kpiRec && kpiRec.lyT || 0, lyA = kpiRec && kpiRec.lyA || 0;
    const zfT = kpiRec && kpiRec.zfT || 0, zfA = kpiRec && kpiRec.zfA || 0;
    const kpiCards = [
      { l: '留资目标', v: lyT || '—' },
      { l: '留资实际', v: lyA || '—', c: (kpiRec && lyT && lyA >= lyT) ? 'ok' : (kpiRec ? 'no' : '') },
      { l: '增粉目标', v: zfT || '—' },
      { l: '增粉实际', v: zfA || '—', c: (kpiRec && zfT && zfA >= zfT) ? 'ok' : (kpiRec ? 'no' : '') },
    ].map(function (k) { return '<div class="k"><div class="v ' + (k.c || '') + '">' + k.v + '</div><div class="l">' + k.l + '</div></div>'; }).join('');
    const hist = ((s.media && s.media.kpi) || []).filter(function (k) { return k.month !== km; })
      .sort(function (a, b) { return a.month < b.month ? 1 : -1; }).map(function (k) {
        const okL = k.lyT && k.lyA >= k.lyT, okZ = k.zfT && k.zfA >= k.zfT;
        return '<div class="utp-row"><span class="utp-tag">' + k.month + '</span>' +
          '<div class="rt">留资 ' + (k.lyA || 0) + '/' + (k.lyT || 0) + (okL ? ' ✅' : '') + ' · 增粉 ' + (k.zfA || 0) + '/' + (k.zfT || 0) + (okZ ? ' ✅' : '') +
          (k.mark ? '<span class="sub">' + utpEsc(k.mark) + '</span>' : '') + '</div>' +
          '<button class="utp-act danger" onclick="utpKpiDel(\'' + k.month + '\')">✕</button></div>';
      }).join('') || '<div class="utp-empty">暂无历史月份</div>';
    const kpiVal = function (id, v) { return v ? ' value="' + utpEsc(String(v)) + '"' : ''; };

    const hasDemo = items.some(function (i) { return i.demo; });

    return '<div class="module-header"><div class="mh-icon">📣</div>' +
      '<div><div class="mh-title">新媒体工作台</div><div class="mh-desc">每日流水线：选题 → 洗稿 → 制作 → 发布</div></div>' +
      '<div class="mh-spacer"></div>' +
      (hasDemo ? '<button class="utp-demo-btn" onclick="clearMediaDemo()">清空示例</button>' : '') +
      '<div class="header-coin-display"><span class="coin-icon">📣</span><span class="coin-amount">' + items.length + '</span></div></div>' +
      '<div class="utp-notice">⏰ 阶段定义：<b>待采用＝检索选题</b>（3 天未采用自动清除）→ <b>已采用＝完成洗稿</b> → <b>制作中＝分平台制作</b> → <b>发布后＝当日已发布</b>（从初稿库移除）。同一选题，四种打法：四个平台按各自钩子分发。</div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">🏭 每日流水线</span><span class="utp-note">选题池 ' + items.length + ' 条</span></div>' +
      '<div class="utp-prog">' + segs + '</div><div class="utp-prog-legend">' + legend + '</div>' +
      '<div style="height:12px"></div><div class="utp-pipe">' + lanes + '</div></div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">📡 四平台矩阵</span><span class="utp-note">同一选题，四种打法 · 本周口径</span></div>' +
      '<div class="utp-grid4">' + plats + '</div></div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">✍️ 新增选题</span><span class="utp-note">直接进选题池</span></div>' +
      '<div class="utp-form">' +
      '<div class="f"><label>日期</label><input id="wDate" type="date" value="' + today + '"></div>' +
      '<div class="f"><label>平台</label><select id="wPlat">' + MEDIA_PLATFORMS.map(function (p) { return '<option>' + p.n + '</option>'; }).join('') + '</select></div>' +
      '<div class="f wide"><label>选题标题</label><input id="wTitle" placeholder="如：少儿课程入门 3 个动作看懂规则"></div>' +
      '<div class="f"><label>计划发布</label><input id="wPub" type="date"></div>' +
      '<div class="f full"><label>热点来源（可选）</label><input id="wSrc" placeholder="如：热点检索 · 榜单第 3"></div>' +
      '<div class="f full"><label>文案要点（可选）</label><input id="wNote" placeholder="钩子 + 结构 + 结尾 CTA"></div>' +
      '<div class="f"><label>&nbsp;</label><button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="utpMediaAdd()">＋ 加入选题池</button></div>' +
      '</div></div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">📥 初稿库</span><span class="utp-note">发布后自动移除 · 待采用 3 天未采用清除</span></div>' +
      '<div class="utp-filters">' + fbtns + '</div><div class="utp-rows">' + draftRows + '</div></div>' +
      '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">📊 本月绩效（' + km + '）</span><span class="utp-note">每月 5-10 号更新 · 留资 + 增粉</span></div>' +
      '<div class="utp-kpi">' + kpiCards + '</div>' +
      '<div class="utp-form">' +
      '<div class="f"><label>月份</label><input id="kMonth" type="month" value="' + km + '" onchange="utpKpiPrefill()"></div>' +
      '<div class="f"><label>留资目标</label><input id="kLyT" type="number" min="0" step="1" placeholder="如 50"' + kpiVal('kLyT', kpiRec && kpiRec.lyT) + '></div>' +
      '<div class="f"><label>留资实际</label><input id="kLyA" type="number" min="0" step="1" placeholder="如 32"' + kpiVal('kLyA', kpiRec && kpiRec.lyA) + '></div>' +
      '<div class="f"><label>增粉目标</label><input id="kZfT" type="number" min="0" step="1" placeholder="如 1000"' + kpiVal('kZfT', kpiRec && kpiRec.zfT) + '></div>' +
      '<div class="f"><label>增粉实际</label><input id="kZfA" type="number" min="0" step="1" placeholder="如 640"' + kpiVal('kZfA', kpiRec && kpiRec.zfA) + '></div>' +
      '<div class="f"><label>&nbsp;</label><button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="utpKpiSave()">💾 保存本月绩效</button></div>' +
      '<div class="f full"><label>备注（可选）</label><input id="kMark" type="text" placeholder="如：信息流 A 素材跑量最好"' + kpiVal('kMark', kpiRec && kpiRec.mark) + '></div>' +
      '</div><div class="utp-rows">' + hist + '</div></div>';
  }
  function utpMediaFilter(f) { _mediaFilter = f; renderMedia(); }
  function utpMediaAdd() {
    const title = (document.getElementById('wTitle') && document.getElementById('wTitle').value || '').trim();
    if (!title) { showToast('先写个选题标题', 'warning'); return; }
    const s = getState();
    s.media = s.media || { items: [], kpi: [] };
    s.media.items = s.media.items || [];
    s.media.items.push({
      id: 'md_' + Date.now(),
      date: (document.getElementById('wDate') && document.getElementById('wDate').value) || todayStr(),
      plat: (document.getElementById('wPlat') && document.getElementById('wPlat').value) || '抖音官方号',
      title: title,
      pub: (document.getElementById('wPub') && document.getElementById('wPub').value) || '',
      src: (document.getElementById('wSrc') && document.getElementById('wSrc').value) || '',
      note: (document.getElementById('wNote') && document.getElementById('wNote').value) || '',
      stage: '待采用',
      createdAt: new Date().toISOString(), demo: false,
    });
    saveState();
    const hh = awardDailyHours('media', '新媒体工作台');
    if (hh) showToast('⚔️ 今日首次运营新媒体， +' + hh + ' 个修炼时辰', 'info');
    renderMedia();
  }
  function utpMediaAdvance(id) {
    const s = getState();
    const i = mediaItems(s).find(function (x) { return x.id === id; });
    if (!i) return;
    const idx = MEDIA_STAGES.findIndex(function (x) { return x.k === i.stage; });
    const next = MEDIA_STAGES[idx + 1];
    if (!next) return;
    i.stage = next.k;
    if (next.k === '已发布') i.pub = i.pub || todayStr();
    saveState();
    if (next.k === '已发布') {
      addCoins(2, '内容发布 ' + i.title);
      const hh = awardDailyHours('media', '新媒体工作台');
      showToast('🚀 已发布「' + i.title + '」 +2 金币' + (hh ? ' + ' + hh + ' 时辰' : ''), 'success');
    }
    renderMedia();
  }
  function utpMediaUndoPub(id) {
    const s = getState();
    const i = mediaItems(s).find(function (x) { return x.id === id; });
    if (!i) return;
    i.stage = '制作中';
    saveState(); renderMedia();
  }
  function utpMediaDel(id) {
    const s = getState();
    s.media.items = mediaItems(s).filter(function (x) { return x.id !== id; });
    saveState(); renderMedia();
  }
  function clearMediaDemo() {
    const s = getState();
    const n = mediaItems(s).filter(function (i) { return i.demo; }).length;
    s.media.items = mediaItems(s).filter(function (i) { return !i.demo; });
    saveState(); renderMedia();
    if (n) showToast('已清空 ' + n + ' 条示例选题', 'info');
  }
  function utpKpiPrefill() {
    const s = getState();
    const m = (document.getElementById('kMonth') && document.getElementById('kMonth').value) || utpMonth();
    const rec = ((s.media && s.media.kpi) || []).find(function (k) { return k.month === m; });
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = rec && rec[id === 'kLyT' ? 'lyT' : id === 'kLyA' ? 'lyA' : id === 'kZfT' ? 'zfT' : id === 'kZfA' ? 'zfA' : 'mark'] ? String(rec[id === 'kLyT' ? 'lyT' : id === 'kLyA' ? 'lyA' : id === 'kZfT' ? 'zfT' : id === 'kZfA' ? 'zfA' : 'mark']) : ''; };
    set('kLyT', null); set('kLyA', null); set('kZfT', null); set('kZfA', null); set('kMark', null);
  }
  function utpKpiSave() {
    const s = getState();
    s.media = s.media || { items: [], kpi: [] };
    s.media.kpi = s.media.kpi || [];
    const month = (document.getElementById('kMonth') && document.getElementById('kMonth').value) || utpMonth();
    const rec = s.media.kpi.find(function (k) { return k.month === month; });
    const data = {
      month: month,
      lyT: parseInt((document.getElementById('kLyT') && document.getElementById('kLyT').value) || '0', 10) || 0,
      lyA: parseInt((document.getElementById('kLyA') && document.getElementById('kLyA').value) || '0', 10) || 0,
      zfT: parseInt((document.getElementById('kZfT') && document.getElementById('kZfT').value) || '0', 10) || 0,
      zfA: parseInt((document.getElementById('kZfA') && document.getElementById('kZfA').value) || '0', 10) || 0,
      mark: (document.getElementById('kMark') && document.getElementById('kMark').value) || '',
    };
    if (rec) Object.assign(rec, data); else s.media.kpi.push(data);
    saveState(); renderMedia();
    showToast('已保存 ' + month + ' 绩效', 'success');
  }
  function utpKpiDel(month) {
    const s = getState();
    s.media.kpi = ((s.media && s.media.kpi) || []).filter(function (k) { return k.month !== month; });
    saveState(); renderMedia();
  }

  /* 待采用 3 天未采用自动清除（每次进入页面时执行） */
  function utpCleanStaleTopics() {
    const s = getState();
    const today = todayStr();
    const before = (s.media && s.media.items) || [];
    const kept = before.filter(function (i) {
      if (i.stage !== '待采用' || !i.date) return true;
      return i.date >= today || (function (d) { const n = new Date(), t = new Date(d + 'T00:00:00'); return (n - t) / 86400000 <= 3; })(i.date);
    });
    if (kept.length !== before.length) {
      s.media.items = kept; saveState();
      showToast('已自动清除 ' + (before.length - kept.length) + ' 条超 3 天未采用的选题', 'info');
    }
  }
  window.renderGrowth = renderGrowth; window.renderMedia = renderMedia;
  window.utpGrowAdd = utpGrowAdd; window.utpGrowPct = utpGrowPct; window.utpGrowDone = utpGrowDone; window.utpGrowDel = utpGrowDel;
  window.clearGrowthDemo = clearGrowthDemo;
  window.utpMediaFilter = utpMediaFilter; window.utpMediaAdd = utpMediaAdd; window.utpMediaAdvance = utpMediaAdvance;
  window.utpMediaUndoPub = utpMediaUndoPub; window.utpMediaDel = utpMediaDel; window.clearMediaDemo = clearMediaDemo;
  window.utpKpiPrefill = utpKpiPrefill; window.utpKpiSave = utpKpiSave; window.utpKpiDel = utpKpiDel;

  /* 示例数据（空库且未看过时自动播种，和第一期一致；只含 demo 标记，可一键清空） */
  (function seedPhase2Demo() {
    function run() {
      try {
        const s = getState();
        if (localStorage.getItem('gmh_p2_demo_shown')) return;
        const hasGrow = (s.growth || []).length > 0;
        const hasMedia = ((s.media && s.media.items) || []).length > 0;
        if (hasGrow || hasMedia) { localStorage.setItem('gmh_p2_demo_shown', '1'); return; }
        const iso = function (off) { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
        s.growth = [
          { id: 'gr_d1', dir: '本职进阶', name: 'Q4 项目准时交付率 100%', pct: 40, due: iso(45), action: '本月完成 2 个里程碑', done: false, demo: true, createdAt: '' },
          { id: 'gr_d2', dir: '自媒体打造', name: '小红书稳定日更 21 天', pct: 65, due: iso(20), action: '本周发 5 条清单体', done: false, demo: true, createdAt: '' },
          { id: 'gr_d3', dir: '自由剪辑', name: '剪辑模板库做到 10 套', pct: 30, due: iso(60), action: '打磨 2 套付费模板', done: false, demo: true, createdAt: '' },
          { id: 'gr_d4', dir: '自由教练', name: '拿到 3 个长期客户', pct: 10, due: iso(90), action: '做 3 条样片 + 挂 2 个接单渠道', done: false, demo: true, createdAt: '' },
        ];
        s.media = s.media || { items: [], kpi: [] };
        s.media.items = [
          { id: 'md_d1', date: iso(-1), plat: '抖音官方号', title: '家长最关心的 5 个问题（专业解法版）', pub: iso(1), src: '家长群高频提问', note: '钩子：你问得最多的 5 个问题', stage: '待采用', demo: true, createdAt: '' },
          { id: 'md_d2', date: iso(0), plat: '小红书', title: '新手避坑清单：第一节课别犯的 3 个错', pub: iso(2), src: '搜索热词', note: '清单体 + 首图大字', stage: '已采用', demo: true, createdAt: '' },
          { id: 'md_d3', date: iso(0), plat: '抖音个人号', title: '学员名场面混剪（热点 BGM 版）', pub: iso(1), src: '本周热点榜第 3', note: '前 3 秒上冲突', stage: '制作中', demo: true, createdAt: '' },
          { id: 'md_d4', date: iso(-2), plat: '视频号', title: '本周课程回顾 + 家庭作业', pub: iso(-1), src: '常态栏目', note: '', stage: '已发布', demo: true, createdAt: '' },
        ];
        s.media.kpi = [
          { month: utpMonth(), lyT: 50, lyA: 32, zfT: 1000, zfA: 640, mark: '信息流 A 素材跑量最好', demo: true },
        ];
        saveState();
        localStorage.setItem('gmh_p2_demo_shown', '1');
        if (window.currentPage === 'growth' || window.currentPage === 'media') navTo(window.currentPage);
      } catch (e) { /* 静默 */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  })();
"""
h = h.replace("/* __PHASE2_JS__ */", JS2, 1)

# ---------- 6. wuxia-content.js 时辰映射 ----------
wx = io.open(WX, encoding="utf-8").read()
wx_old = "    todo: 2, planner: 2, body: 1\n  };"
wx_new = "    todo: 2, planner: 2, body: 1, growth: 2, media: 2\n  };"
assert wx.count(wx_old) == 1, "TASK_HOURS 锚点未命中"
wx = wx.replace(wx_old, wx_new, 1)
io.open(WX, "w", encoding="utf-8", newline="").write(wx)

io.open(SRC, "w", encoding="utf-8", newline="").write(h)
print("补丁完成：%d -> %d 字节 (+%d)" % (orig_len, len(h), len(h) - orig_len))

# ---------- 7. 语法自检：浏览器视角逐块检查（修复 findall 漏抽主块的假象）----------
# 逐一定位 <script ...> 的开标签 > 与对应 </script>，抽出每块真实代码 node --check。
def extract_scripts(html):
    blocks, pos = [], 0
    while True:
        s = html.find('<script', pos)
        if s < 0:
            break
        gt = html.find('>', s)
        if gt < 0:
            break
        tag = html[s:gt + 1]
        if 'src=' in tag:            # 外链脚本，跳过
            pos = gt + 1
            continue
        e = html.find('</script>', gt)
        if e < 0:
            break
        blocks.append(html[gt + 1:e])
        pos = e + len('</script>')
    return blocks

failed = False
for bi, code in enumerate(extract_scripts(h), 1):
    if not code.strip():
        continue
    io.open(TMP_JS, "w", encoding="utf-8", newline="").write(code)
    r = subprocess.run([NODE, "--check", TMP_JS], capture_output=True, text=True)
    if r.returncode != 0:
        print("!! script 块 #%d（%d 字节）语法错误：" % (bi, len(code)))
        print(r.stderr[:2000])
        failed = True
        break
    else:
        print("  script 块 #%d 通过（%d 字节）" % (bi, len(code)))
if failed:
    import os
    if os.path.exists(TMP_JS):
        os.remove(TMP_JS)
    sys.exit(1)
import os
if os.path.exists(TMP_JS):
    os.remove(TMP_JS)
print("✅ 全部 script 块 node --check 通过（浏览器视角逐块）")
