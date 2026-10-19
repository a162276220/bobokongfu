# -*- coding: utf-8 -*-
"""
淘金矿工小屋 · utopia 移植 第四期：任务进程总览（凑齐五模块）

做法：**增强现有 planner（计划月历）**，不新造第二个日历页。
参考 utopia panel-visual 的差异化能力，落三件事：
  A. 日历异源叠加：28 天日程窗上同时标出 计划 / 待办截止 / 成长截止 / 经期 / 新媒体在制，
     并给图例开关（默认全开，点击切换）。
  B. 当日全集：点某天，下方新增「当日任务进程」——把该日期的
     计划 + 待办 + 成长目标 + 在制选题/经期 聚合成 4 栏。
  C. 拖拽分诊：待办四象限支持把条目拖到别的格子直接改象限。

改动 5 处锚点（全部 assert count==1，失败即停）：
  1) CSS     : 第三期 CSS 后追加 .p4-* 段
  2) default : defaultState 增加 lay（图例开关）
  3) block   : 整体替换 calCell + renderPlanner
  4) todoRow : 增加拖拽属性
  5) quadCell: 增加放置区

改前自动备份：_backup-pre-phase4.html
运行： python tools/add-utopia-phase4.py
"""
import io
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
BAK = os.path.join(ROOT, '_backup-pre-phase4.html')


def die(msg):
    print('[FAIL] ' + msg)
    sys.exit(1)


def must(h, anchor, name):
    n = h.count(anchor)
    if n != 1:
        die('锚点「%s」出现 %d 次（应为 1）' % (name, n))
    return anchor


h = io.open(HTML, encoding='utf-8').read()
orig = len(h)
shutil.copyfile(HTML, BAK)
print('[OK] 备份 -> %s (%d 字节)' % (os.path.basename(BAK), os.path.getsize(BAK)))

# ============================================================
# 1. CSS
# ============================================================
css_anchor = must(h, """    @media (max-width: 900px) { .rv-two { grid-template-columns: 1fr; } .rv-mnav { width: 100%; } }
""", 'css-rv-tail')

CSS4 = """
  /* ============================================================
     utopia 移植 · 第四期：任务进程总览（异源叠加日历 + 当日全集）
     ============================================================ */
    .p4-legend { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin: 0 0 10px; padding: 9px 12px; background: var(--sunken); border-radius: var(--radius-sm); }
    .p4-lg { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-2); cursor: pointer; user-select: none; }
    .p4-lg i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
    .p4-lg.off { opacity: .38; text-decoration: line-through; }
    .p4-mk { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin: 2px 1.5px 0; }
    .p4-days { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .p4-col { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 9px 10px; min-height: 66px; }
    .p4-col-h { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--ink-3); margin-bottom: 6px; font-weight: 700; }
    .p4-li { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: var(--text-cream); padding: 3px 0; line-height: 1.45; }
    .p4-li .s { color: var(--ink-3); font-size: 11px; }
    .p4-li.done { color: var(--ink-3); text-decoration: line-through; }
    .p4-li.over { color: var(--color-danger); }
    .p4-li .chk { cursor: pointer; flex: none; width: 14px; height: 14px; border: 1px solid var(--line); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; margin-top: 1px; }
    .p4-none { font-size: 12px; color: var(--ink-3); padding: 3px 0; }
    .p4-drop { outline: 2px dashed var(--gold) !important; outline-offset: -2px; }
    .p4-drag { opacity: .45; }
    .todo-item[draggable="true"] { cursor: grab; }
    @media (max-width: 900px) { .p4-days { grid-template-columns: 1fr 1fr; } }
"""
h = h.replace(css_anchor, css_anchor + CSS4, 1)
print('[OK] 1/5 CSS .p4-* 段已插入')

# ============================================================
# 2. defaultState：lay
# ============================================================
lay_anchor = must(h, """      /* ===== utopia 移植：计划月历 ===== */
      plans: [],
      planBonusDate: null,
""", 'defaultState-plans')
h = h.replace(lay_anchor, """      /* ===== utopia 移植：计划月历 ===== */
      plans: [],
      planBonusDate: null,
      /* ===== utopia 移植 · 第四期：任务进程总览（异源图例开关） ===== */
      lay: null,
""", 1)
print('[OK] 2/5 defaultState 增加 lay')

# ============================================================
# 3. 整体替换 calCell + renderPlanner
# ============================================================
OLD_START = must(h, """  function calCell(d, plans, sel, today) {
    const iso = d.iso;
    const items = plans.filter(p => p.date === iso);
    const cls = ['cal-cell'];
    if (iso === today) cls.push('today');
    if (iso === sel) cls.push('sel');
    if (d.dim) cls.push('dim');
    return `
      <div class="${cls.join(' ')}" onclick="pickPlanDate('${iso}')">
        <span class="cal-day">${d.day}</span>
        ${items.length ? '<span class="cal-count">' + items.length + '</span>' : ''}
        ${items.slice(0, 2).map(p => '<span class="cal-dot ' + (p.done ? 'ok' : '') + '" style="background:' + (PLAN_CATS.indexOf(p.cat) % 5 | 0 ? 'var(--accent)' : 'var(--accent)') + '"></span>').join('')}
      </div>`;
  }
""", 'calCell-original')

i = h.find(OLD_START)
j = h.find('  window.init_planner', i)
if j < 0:
    die('找不到 renderPlanner 结束锚点')

NEW_BLOCK = r"""  /* ---- 第四期：异源叠加（计划 / 待办 / 成长 / 经期 / 在制内容） ---- */
  const P4_LAYERS = [
    { k: 'plan',   n: '计划',     c: '#FF6D24' },
    { k: 'todo',   n: '待办截止', c: '#E84A3C' },
    { k: 'grow',   n: '成长截止', c: '#E8A33D' },
    { k: 'period', n: '经期',     c: '#C2456B' },
    { k: 'media',  n: '在制内容', c: '#8A7BE8' },
  ];
  function p4On(s, k) { return !(s.lay && s.lay[k] === false); }
  function p4Toggle(k) {
    const s = getState();
    s.lay = s.lay || {};
    s.lay[k] = !p4On(s, k);
    saveState(); renderPlanner();
  }
  function p4Counts(s, iso, today) {
    const c = { plan: 0, todo: 0, grow: 0, period: 0, media: 0 };
    if (p4On(s, 'plan')) c.plan = (s.plans || []).filter(function (p) { return p.date === iso; }).length;
    if (p4On(s, 'todo')) c.todo = (s.todos || []).filter(function (t) { return t.due === iso; }).length;
    if (p4On(s, 'grow')) c.grow = (s.growth || []).filter(function (g) { return g.due === iso; }).length;
    if (p4On(s, 'media')) c.media = ((s.media && s.media.items) || []).filter(function (x) { return x.pub === iso && x.stage !== '已发布'; }).length;
    if (p4On(s, 'period')) {
      const b = s.body || {};
      c.period = (b.records || []).some(function (r) { return r.date === iso && r.periodDay; }) ? 1 : 0;
    }
    return c;
  }
  /* 某日跨模块全集 */
  function p4DayItems(s, iso, today) {
    const out = [];
    if (p4On(s, 'plan')) {
      (s.plans || []).filter(function (p) { return p.date === iso; }).forEach(function (p) {
        out.push({ k: 'plan', text: p.text, done: !!p.done, over: !p.done && iso < today, id: p.id, kind: 'plan', sub: p.cat + (p.span && p.span !== '单日' ? ' · ' + p.span : '') });
      });
    }
    if (p4On(s, 'todo')) {
      (s.todos || []).filter(function (t) { return t.due === iso; }).forEach(function (t) {
        const q = QUADRANTS[t.q - 1];
        out.push({ k: 'todo', text: t.text, done: !!t.done, over: !t.done && iso < today, id: t.id, kind: 'todo', sub: '四象限 · ' + (q ? q.name : '') });
      });
    }
    if (p4On(s, 'grow')) {
      (s.growth || []).filter(function (g) { return g.due === iso; }).forEach(function (g) {
        out.push({ k: 'grow', text: g.name, done: !!g.done, over: !g.done && iso < today, id: g.id, kind: 'grow', sub: (g.dir || '') + ' · ' + (g.pct || 0) + '%' });
      });
    }
    if (p4On(s, 'media')) {
      ((s.media && s.media.items) || []).filter(function (x) { return x.pub === iso && x.stage !== '已发布'; }).forEach(function (x) {
        out.push({ k: 'media', text: x.title, done: false, over: iso < today, id: x.id, kind: 'media', sub: x.stage + ' · ' + x.plat });
      });
    }
    if (p4On(s, 'period')) {
      const b = s.body || {};
      const recs = (b.records || []).filter(function (r) { return r.date === iso && r.periodDay; });
      if (recs.length) out.push({ k: 'period', text: '经期记录', done: true, over: false, id: 'pd_' + iso, kind: 'period', sub: (recs[0].weight ? recs[0].weight + ' 斤' : '') });
    }
    return out;
  }

  function calCell(d, plans, sel, today) {
    const iso = d.iso;
    const s = getState();
    const c = p4Counts(s, iso, today);
    const total = c.plan + c.todo + c.grow + c.period + c.media;
    const cls = ['cal-cell'];
    if (iso === today) cls.push('today');
    if (iso === sel) cls.push('sel');
    if (d.dim) cls.push('dim');
    let dots = '';
    P4_LAYERS.forEach(function (L) {
      const n = c[L.k] || 0;
      if (n) for (let q = 0; q < Math.min(n, 2); q++) dots += '<span class="p4-mk" style="background:' + L.c + '"></span>';
    });
    return `
      <div class="${cls.join(' ')}" onclick="pickPlanDate('${iso}')">
        <span class="cal-day">${d.day}</span>
        ${total ? '<span class="cal-count">' + total + '</span>' : ''}
        <span class="cal-dots">${dots}</span>
      </div>`;
  }

  function renderPlanner() {
    const s = getState();
    const plans = s.plans || [];
    const today = todayStr();
    if (!_plannerSelDate) _plannerSelDate = today;
    const sel = _plannerSelDate;

    /* 四周日程窗：从本周周一开始，28 天 */
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const dow = (base.getDay() + 6) % 7;              // 周一=0
    base.setDate(base.getDate() - dow);
    const cells = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      cells.push({
        iso: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        day: d.getDate(), dim: i >= 14 ? true : false,
      });
    }

    const dayPlans = plans.filter(p => p.date === sel).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
    const overdue = plans.filter(p => !p.done && p.date < today);
    const archived = plans.filter(p => p.done).sort((a, b) => ((b.doneAt || '') < (a.doneAt || '') ? -1 : 1)).slice(0, 12);

    /* 第四期：图例 + 当日跨模块全集 */
    const selCounts = p4Counts(s, sel, today);
    const legend = P4_LAYERS.map(function (L) {
      const on = p4On(s, L.k);
      const n = selCounts[L.k] || 0;
      return '<span class="p4-lg' + (on ? '' : ' off') + '" onclick="p4Toggle(\'' + L.k + '\')" title="点一下切换显示">' +
        '<i style="background:' + L.c + '"></i>' + L.n + (n ? ' ' + n : '') + '</span>';
    }).join('');

    const dayAll = p4DayItems(s, sel, today);
    const groups = [
      { k: 'plan', t: '📆 计划' },
      { k: 'todo', t: '🎯 待办' },
      { k: 'grow', t: '🌱 成长' },
      { k: 'other', t: '📌 其他' },
    ];
    const dayCols = groups.map(function (G) {
      const arr = (G.k === 'other')
        ? dayAll.filter(function (x) { return x.k === 'media' || x.k === 'period'; })
        : dayAll.filter(function (x) { return x.k === G.k; });
      const body = arr.length ? arr.map(function (x) {
        const cls = 'p4-li' + (x.done ? ' done' : '') + (x.over ? ' over' : '');
        let chk = '<span class="chk"></span>';
        if (x.kind === 'plan' || x.kind === 'todo') {
          const fn = x.kind === 'plan' ? 'togglePlan' : 'toggleTodo';
          chk = '<span class="chk" onclick="event.stopPropagation();' + fn + '(\'' + x.id + '\')">' + (x.done ? '✓' : '') + '</span>';
        }
        return '<div class="' + cls + '">' + chk + '<span style="flex:1">' + x.text +
          (x.sub ? '<br><span class="s">' + x.sub + '</span>' : '') + '</span></div>';
      }).join('') : '<div class="p4-none">无</div>';
      return '<div class="p4-col"><div class="p4-col-h"><span>' + G.t + '</span><span>' + arr.length + '</span></div>' + body + '</div>';
    }).join('');

    return `
    <div class="module-header">
      <div class="mh-icon">🧭</div>
      <div><div class="mh-title">计划月历</div><div class="mh-desc">四周日程窗 · 计划 / 待办 / 成长 / 内容 异源叠加</div></div>
      <div class="mh-spacer"></div>
      <div class="header-coin-display"><span class="coin-icon">🗓️</span><span class="coin-amount">${plans.filter(p => !p.done).length}</span></div>
    </div>
    <div class="card">
      <div class="card-title"><span class="title-icon">📆</span>四周日程窗
        <span style="margin-left:auto"><button class="btn btn-outline btn-sm" onclick="pickPlanDate('${today}')">回到今天</button></span></div>
      <div class="p4-legend">${legend}</div>
      <div class="cal-head">${['一', '二', '三', '四', '五', '六', '日'].map(d => '<span>' + d + '</span>').join('')}</div>
      <div class="cal-grid">${cells.map(d => calCell(d, plans, sel, today)).join('')}</div>
      ${overdue.length ? '<div class="overdue-bar">⚠️ 有 ' + overdue.length + ' 条计划过了日期还没做完：<b style="color:var(--color-danger)">' + overdue.slice(0, 3).map(p => p.text).join('、') + '</b></div>' : ''}
    </div>
    <div class="card">
      <div class="card-title"><span class="title-icon">🧭</span>${sel} 任务进程
        <span style="margin-left:auto;font-size:13px;color:var(--ink-3)">共 ${dayAll.length} 项</span></div>
      <div class="p4-days">${dayCols}</div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title"><span class="title-icon">📝</span>加一条计划</div>
        <div class="form-group"><label class="form-label">日期</label>
          <input class="input" id="planDate" type="date" value="${sel}"></div>
        <div class="form-group"><label class="form-label">计划内容</label>
          <input class="input" id="planText" placeholder="这一天要做什么…" onkeydown="if(event.key==='Enter')addPlan()"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">归类</label>
            <select class="select" id="planCat">${PLAN_CATS.map(c => '<option>' + c + '</option>').join('')}</select></div>
          <div class="form-group"><label class="form-label">时间周期</label>
            <select class="select" id="planSpan">${PLAN_SPANS.map(c => '<option>' + c + '</option>').join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">备注（可选）</label>
          <input class="input" id="planNote" placeholder="补充说明"></div>
        <button class="btn btn-gold" style="width:100%" onclick="addPlan()">＋添加计划</button>
      </div>
      <div class="card">
        <div class="card-title"><span class="title-icon">📋</span>${sel} 的计划
          <span style="margin-left:auto;font-size:13px;color:var(--ink-3)">${dayPlans.length} 条</span></div>
        <div class="record-list">
          ${dayPlans.length ? dayPlans.map(planRow).join('') : emptyState('🗓️', '这一天还没排计划，左边加一条')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><span class="title-icon">🗄️</span>已完成归档
        <span style="margin-left:auto;font-size:13px;color:var(--ink-3)">${archived.length} 条</span></div>
      <div class="record-list">
        ${archived.length ? archived.map(planRow).join('') : emptyState('🗄️', '做完的计划会自动归到这里')}
      </div>
    </div>`;
  }

  /* ---- 第四期：四象限拖拽分诊 ---- */
  let _p4DragId = null;
  function p4DragStart(ev, id) {
    _p4DragId = id;
    try {
      ev.dataTransfer.setData('text/plain', id);
      ev.dataTransfer.effectAllowed = 'move';
    } catch (e) {}
    if (ev.target && ev.target.classList) ev.target.classList.add('p4-drag');
  }
  function p4DragEnd(ev) {
    if (ev.target && ev.target.classList) ev.target.classList.remove('p4-drag');
    Array.prototype.forEach.call(document.querySelectorAll('.p4-drop'), function (el) { el.classList.remove('p4-drop'); });
    _p4DragId = null;
  }
  function p4Allow(ev, q) {
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'move'; } catch (e) {}
    const cell = ev.currentTarget;
    if (cell && cell.classList) cell.classList.add('p4-drop');
  }
  function p4Leave(ev) {
    const cell = ev.currentTarget;
    if (cell && cell.classList) cell.classList.remove('p4-drop');
  }
  function p4DropOn(ev, q) {
    ev.preventDefault();
    Array.prototype.forEach.call(document.querySelectorAll('.p4-drop'), function (el) { el.classList.remove('p4-drop'); });
    let id = _p4DragId;
    try { id = id || ev.dataTransfer.getData('text/plain'); } catch (e) {}
    if (!id) return;
    const s = getState();
    const t = (s.todos || []).find(function (x) { return x.id === id; });
    if (!t) return;
    _p4DragId = null;
    if (t.q === q) return;
    t.q = q;
    saveState();
    renderDashboard();
    showToast('已移到「' + QUADRANTS[q - 1].name + '」', 'success');
  }
  window.p4Toggle = p4Toggle;
  window.p4DayItems = p4DayItems;
  window.p4DragStart = p4DragStart;
  window.p4DragEnd = p4DragEnd;
  window.p4Allow = p4Allow;
  window.p4Leave = p4Leave;
  window.p4DropOn = p4DropOn;

"""

h = h[:i] + NEW_BLOCK + h[j:]
print('[OK] 3/5 calCell + renderPlanner 已重写')

# ============================================================
# 4. todoRow 加拖拽属性
# ============================================================
todo_anchor = must(h, """        <div class="todo-item${t.done ? ' done' : ''}${isFocus ? ' is-focus' : ''}${over ? ' over' : ''}">
""", 'todoRow-open')
h = h.replace(todo_anchor, """        <div class="todo-item${t.done ? ' done' : ''}${isFocus ? ' is-focus' : ''}${over ? ' over' : ''}"
             draggable="${t.done ? 'false' : 'true'}"
             ondragstart="p4DragStart(event,'${t.id}')" ondragend="p4DragEnd(event)">
""", 1)
print('[OK] 4/5 todoRow 增加拖拽')

# ============================================================
# 5. quadCell 增加放置区
# ============================================================
quad_anchor = must(h, """      <div class="quad-cell" style="--qc:${q.color}">
""", 'quadCell-open')
h = h.replace(quad_anchor, """      <div class="quad-cell" style="--qc:${q.color}"
           ondragover="p4Allow(event,${q.q})" ondragleave="p4Leave(event)" ondrop="p4DropOn(event,${q.q})">
""", 1)
print('[OK] 5/5 quadCell 增加放置区')

# ============================================================
# 清理误入的坏 token（保险）
# ============================================================
FIX = [
    ('if (!t Bill) return;', 'if (!t) return;'),
    ('cell.classListetted', 'cell.classList'),
]
for a, b in FIX:
    if a in h:
        h = h.replace(a, b)
        print('[FIX] %r -> %r' % (a, b))

for t in ['\u30ac', 'beda', '\u6b65\u6b65', 'classListetted', 'Bill ', '\u4e4f\u529b']:
    if t in h:
        die('仍有坏 token: %r' % t)
print('[OK] 坏 token 清理完成')

# ============================================================
# 语法自检（浏览器视角逐块）
# ============================================================
def extract_scripts(html):
    blocks, pos = [], 0
    while True:
        s = html.find('<script', pos)
        if s < 0:
            break
        gt = html.find('>', s)
        if gt < 0:
            break
        if 'src=' in html[s:gt + 1]:
            pos = gt + 1
            continue
        e = html.find('</script>', gt)
        if e < 0:
            break
        blocks.append(html[gt + 1:e])
        pos = e + len('</script>')
    return blocks


blocks = extract_scripts(h)
ok = True
for idx, b in enumerate(blocks):
    if not b.strip():
        continue
    tmp = os.path.join(ROOT, '_chk_p4_%d.js' % idx)
    io.open(tmp, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    if r.returncode != 0:
        ok = False
        print('[FAIL] script 块 #%d (%d 字符)：' % (idx, len(b)))
        print((r.stderr or '').strip()[:1200])
    else:
        print('[OK] script 块 #%d (%d 字符) 通过' % (idx, len(b)))
    os.remove(tmp)
if not ok:
    die('语法自检未通过，未写入（备份 %s）' % os.path.basename(BAK))

io.open(HTML, 'w', encoding='utf-8').write(h)
print('')
print('[DONE] 写入 %s  字符 %d -> %d（+%d）字节 %d'
      % (os.path.basename(HTML), orig, len(h), len(h) - orig, os.path.getsize(HTML)))