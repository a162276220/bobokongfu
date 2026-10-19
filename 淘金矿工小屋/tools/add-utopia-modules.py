"""第一期：把 utopia 工作台的三个核心模块移植进淘金矿工小屋。

A. 今日焦点卡 + 四象限待办  -> 并进「金矿主控大厅」首屏
B. 计划月历 · 四周日程窗 + 当日计划 + 已完成归档 -> 新模块「计划月历」
C. 身体台账（体重/体脂/经期） -> 并进「运动台账」

集成点：
  - 数据全部进 defaultState()，ensureFields() 会自动给老档补字段
  - 新模块的"每日首次使用"给修炼时辰：WUXIA.TASK_HOURS 加 todo/planner/body 三键，
    并用 awardDailyHours() 做当日去重（earnHours 本身没有日上限，不去重会被刷）
  - 铁律 9：所有动作改完数据后统一 renderDashboard()/renderPlanner()/navTo 刷新，
    渲染函数之间不互调
  - 图表内联 SVG，无外链

每个锚点都 assert，命中失败立即报错退出，不做半套。
"""
import io
import re

APP = r"D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
WUXIA = r"D:/桌宠/淘金矿工小屋/wuxia-content.js"

# ---------------------------------------------------------------- 1) 数据层
DEFAULT_STATE_ANCHOR = "      lastActiveDate: todayStr(),"
DEFAULT_STATE_NEW = """      /* ===== utopia 移植：今日焦点 + 四象限待办 ===== */
      todos: [],
      focusId: null,
      todoBonusDate: null,
      /* ===== utopia 移植：计划月历 ===== */
      plans: [],
      planBonusDate: null,
      /* ===== utopia 移植：身体台账 ===== */
      body: {
        records: [],
        cycleDays: 28, periodDays: 4, lastPeriodStart: '',
        goalWeight: null, goalBodyfat: null,
      },
      bodyBonusDate: null,
      lastActiveDate: todayStr(),"""

TASK_HOURS_OLD = """    diet: 1, exercise: 3, accounting: 1, vocabulary: 3, amazon: 2, xiaohongshu: 2
  };"""
TASK_HOURS_NEW = """    diet: 1, exercise: 3, accounting: 1, vocabulary: 3, amazon: 2, xiaohongshu: 2,
    todo: 2, planner: 2, body: 1
  };"""

# ---------------------------------------------------------------- 2) JS 函数块
JS_BLOCK = """  /* ============================================================
     utopia 移植 · 第一期
     A 今日焦点卡 + 四象限待办 / B 计划月历 / C 身体台账
     数据全在 state 顶层（todos/plans/body），铁律 9：动作改数据 ->
     统一 renderDashboard()/renderPlanner() 刷新，渲染函数之间不互调。
     ============================================================ */
  const QUADRANTS = [
    { q: 1, name: '重要且紧急',   hint: '马上做',   color: '#E84A3C' },
    { q: 2, name: '重要不紧急',   hint: '排期做',   color: '#FF6D24' },
    { q: 3, name: '紧急不重要',   hint: '快速处理', color: '#E8A33D' },
    { q: 4, name: '不重要不紧急', hint: '有空再说', color: '#93A099' },
  ];
  const PLAN_CATS  = ['本职进阶', '副业打造', '学习成长', '生活安排', '其他'];
  const PLAN_SPANS = ['单日', '3 日内', '半月', '一月'];
  const DIET_TAGS  = ['标准健康饮食', '外卖高油超标', '纯高蛋白吃肉日', '碳水不足'];
  let _plannerSelDate = '';

  /* 每日奖励：同一模块一天只给一次时辰，防止加一条完成一条地刷 */
  function awardDailyHours(key, name) {
    const s = getState();
    const today = todayStr();
    s.dailyBonus = s.dailyBonus || {};
    if (s.dailyBonus[key] === today) return 0;
    s.dailyBonus[key] = today;
    saveState();
    return window.Jianghu ? Jianghu.earnHours(key, name) : 0;
  }
  function isOverdue(t) {
    return !t.done && t.due && t.due < todayStr();
  }

  /* ---------- A. 今日焦点 + 四象限 ---------- */
  function addTodo() {
    const input = document.getElementById('todoInput');
    const text = (input && input.value || '').trim();
    if (!text) { showToast('先写一件要做的事', 'warning'); return; }
    const qSel = document.getElementById('todoQuad');
    const dueEl = document.getElementById('todoDue');
    const q = parseInt(qSel && qSel.value || '2', 10);
    const s = getState();
    s.todos = s.todos || [];
    s.todos.push({
      id: 'td_' + Date.now(), text: text,
      q: [1, 2, 3, 4].indexOf(q) >= 0 ? q : 2,
      due: (dueEl && dueEl.value) || '',
      done: false, createdAt: new Date().toISOString(), demo: false,
    });
    if (input) input.value = '';
    saveState(); renderDashboard();
  }
  function toggleTodo(id) {
    const s = getState();
    const t = (s.todos || []).find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? new Date().toISOString() : null;
    saveState();
    if (t.done) {
      addCoins(1, '待办完成');
      const h = awardDailyHours('todo', '四象限待办');
      if (h) showToast('⚔️ 今日首次完成待办， +' + h + ' 个修炼时辰', 'info');
    }
    renderDashboard();
  }
  function moveTodo(id, dir) {
    const s = getState();
    const t = (s.todos || []).find(x => x.id === id);
    if (!t) return;
    t.q = Math.min(4, Math.max(1, t.q + dir));
    saveState(); renderDashboard();
  }
  function delTodo(id) {
    const s = getState();
    s.todos = (s.todos || []).filter(x => x.id !== id);
    if (s.focusId === id) s.focusId = null;
    saveState(); renderDashboard();
  }
  function setFocus(id) {
    const s = getState();
    s.focusId = (s.focusId === id) ? null : id;
    saveState(); renderDashboard();
  }
  function clearDemoTodos() {
    const s = getState();
    s.todos = (s.todos || []).filter(t => !t.demo);
    s.focusId = null; saveState(); renderDashboard();
    showToast('示例待办已清空', 'info');
  }
  function todoRow(t) {
    const over = isOverdue(t);
    const isFocus = getState().focusId === t.id && !t.done;
    return `
        <div class="todo-item${t.done ? ' done' : ''}${isFocus ? ' is-focus' : ''}${over ? ' over' : ''}">
          <span class="todo-check" onclick="toggleTodo('${t.id}')">${t.done ? '✓' : ''}</span>
          <span class="todo-body">
            <span class="todo-text">${t.text}</span>
            ${over ? '<span class="todo-over">逾期 ' + t.due + '</span>' : ''}
            ${t.due && !over && !t.done ? '<span class="todo-due">' + t.due + '</span>' : ''}
          </span>
          <span class="todo-ops">
            <span class="op" title="提高重要度" onclick="event.stopPropagation();moveTodo('${t.id}',1)">▲</span>
            <span class="op" title="降低重要度" onclick="event.stopPropagation();moveTodo('${t.id}',-1)">▼</span>
            <span class="op" title="删除" onclick="event.stopPropagation();delTodo('${t.id}')">✕</span>
          </span>
        </div>`;
  }
  function quadCell(q) {
    const all = getState().todos || [];
    const open = all.filter(t => t.q === q.q && !t.done && !isOverdue(t));
    const over = all.filter(t => t.q === q.q && !t.done && isOverdue(t));
    const done = all.filter(t => t.q === q.q && t.done);
    return `
      <div class="quad-cell" style="--qc:${q.color}">
        <div class="quad-head">
          <span class="quad-name">${q.name}</span>
          <span class="quad-hint">${q.hint} · ${open.length + over.length}</span>
        </div>
        ${over.map(todoRow).join('')}
        ${open.map(todoRow).join('') || (over.length ? '' : '<div class="quad-empty">这一格空着</div>')}
        ${done.slice(-3).map(todoRow).join('')}
      </div>`;
  }
  function focusBlock() {
    const s = getState();
    const open = (s.todos || []).filter(t => !t.done);
    const focus = open.find(t => t.id === s.focusId);
    if (focus) {
      return `
        <div class="focus-now" onclick="setFocus('${focus.id}')">
          <div class="focus-q">现在就做</div>
          <div class="focus-text">${focus.text}</div>
          <div class="focus-meta">点一下取消焦点</div>
        </div>`;
    }
    if (open.length === 0) {
      return `
        <div class="focus-now empty">
          <div class="focus-q">今天很干净</div>
          <div class="focus-text">下面加一件待办、选个象限，它就是你今天的主角</div>
        </div>`;
    }
    const over = open.filter(isOverdue).sort((a, b) => (a.due < b.due ? -1 : 1));
    const top = over[0] || open.slice().sort((a, b) => a.q - b.q)[0];
    return `
      <div class="focus-now suggest" onclick="setFocus('${top.id}')">
        <div class="focus-q">${isOverdue(top) ? '已经逾期，先清掉' : '建议先做'}</div>
        <div class="focus-text">${top.text}</div>
        <div class="focus-meta">来自「${QUADRANTS[top.q - 1].name}」 · 点一下设为今日焦点</div>
      </div>`;
  }
  function renderFocusAndQuads() {
    const s = getState();
    const hasDemo = (s.todos || []).some(t => t.demo);
    return `
    <!-- utopia 移植：今日焦点 + 四象限待办 -->
    <div class="card focus-card">
      <div class="card-title"><span class="title-icon">🎯</span>今天你要先做哪一件小事？</div>
      ${focusBlock()}
      <div class="quick-todo">
        <select class="select" id="todoQuad">
          ${QUADRANTS.map(q => `<option value="${q.q}">${q.name}</option>`).join('')}
        </select>
        <input class="input" id="todoDue" type="date" title="截止日期（可选）">
        <input class="input" id="todoInput" placeholder="加一件待办，回车进四象限…"
               onkeydown="if(event.key==='Enter')addTodo()">
        <button class="btn btn-gold" onclick="addTodo()">＋添加</button>
      </div>
    </div>
    <div class="quad-grid">
      ${QUADRANTS.map(quadCell).join('')}
    </div>
    ${hasDemo ? '<div style="text-align:right;margin:-6px 0 14px;"><button class="btn btn-outline btn-sm" onclick="clearDemoTodos()">清空示例待办</button></div>' : ''}`;
  }

  /* ---------- B. 计划月历 ---------- */
  function addPlan() {
    const g = id => document.getElementById(id);
    const date = g('planDate') && g('planDate').value;
    const text = (g('planText') && g('planText').value || '').trim();
    if (!date) { showToast('先选日期', 'warning'); return; }
    if (!text) { showToast('写一句计划内容', 'warning'); return; }
    const s = getState();
    s.plans = s.plans || [];
    s.plans.push({
      id: 'pl_' + Date.now(), date: date, text: text,
      cat: (g('planCat') && g('planCat').value) || '其他',
      note: (g('planNote') && g('planNote').value) || '',
      span: (g('planSpan') && g('planSpan').value) || '单日',
      done: false, createdAt: new Date().toISOString(), demo: false,
    });
    _plannerSelDate = date;
    saveState(); renderPlanner();
  }
  function togglePlan(id) {
    const s = getState();
    const p = (s.plans || []).find(x => x.id === id);
    if (!p) return;
    p.done = !p.done;
    p.doneAt = p.done ? new Date().toISOString() : null;
    saveState();
    if (p.done) {
      const h = awardDailyHours('planner', '计划月历');
      if (h) showToast('⚔️ 今日首次完成计划， +' + h + ' 个修炼时辰', 'info');
    }
    renderPlanner();
  }
  function delPlan(id) {
    const s = getState();
    s.plans = (s.plans || []).filter(x => x.id !== id);
    saveState(); renderPlanner();
  }
  function pickPlanDate(d) {
    _plannerSelDate = d; renderPlanner();
  }
  function planRow(p) {
    const over = !p.done && p.date < todayStr();
    return `
        <div class="record-item plan-item${p.done ? ' done' : ''}${over ? ' over' : ''}">
          <span class="todo-check" onclick="togglePlan('${p.id}')">${p.done ? '✓' : ''}</span>
          <div class="ri-content">
            <div class="ri-title">${p.text} <span class="plan-cat">${p.cat}</span></div>
            <div class="ri-meta">${p.date} · ${p.span}${p.note ? ' · ' + p.note : ''}${over ? ' · <b style="color:var(--color-danger)">逾期</b>' : ''}</div>
          </div>
          <span class="op" title="删除" onclick="delPlan('${p.id}')">✕</span>
        </div>`;
  }
  function calCell(d, plans, sel, today) {
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

    return `
    <div class="module-header">
      <div class="mh-icon">🗓️</div>
      <div><div class="mh-title">计划月历</div><div class="mh-desc">四周日程窗 · 点日期排计划，做完自动归档</div></div>
      <div class="mh-spacer"></div>
      <div class="header-coin-display"><span class="coin-icon">🗓️</span><span class="coin-amount">${plans.filter(p => !p.done).length}</span></div>
    </div>
    <div class="card">
      <div class="card-title"><span class="title-icon">📆</span>四周日程窗
        <span style="margin-left:auto"><button class="btn btn-outline btn-sm" onclick="pickPlanDate('${today}')">回到今天</button></span></div>
      <div class="cal-head">${['一', '二', '三', '四', '五', '六', '日'].map(d => '<span>' + d + '</span>').join('')}</div>
      <div class="cal-grid">${cells.map(d => calCell(d, plans, sel, today)).join('')}</div>
      ${overdue.length ? '<div class="overdue-bar">⚠️ 有 ' + overdue.length + ' 条计划过了日期还没做完：<b style="color:var(--color-danger)">' + overdue.slice(0, 3).map(p => p.text).join('、') + '</b></div>' : ''}
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title"><span class="title-icon">📝</span>当日计划 · ${sel}</div>
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
  window.init_planner = function () {};

  /* ---------- C. 身体台账 ---------- */
  function saveBodyRecord() {
    const g = id => document.getElementById(id);
    const date = (g('bdDate') && g('bdDate').value) || todayStr();
    const weight = parseFloat(g('bdWeight') && g('bdWeight').value);
    const bf = parseFloat(g('bdBf') && g('bdBf').value);
    if (!weight || weight <= 0) { showToast('填一下体重（斤）', 'warning'); return; }
    const s = getState();
    s.body = s.body || { records: [] };
    s.body.records = s.body.records || [];
    if ((s.body.records || []).some(r => r.date === date)) {
      showToast('这一天已经记过了，要改就先删掉那条', 'warning'); return;
    }
    s.body.records.push({
      id: 'bd_' + Date.now(), date: date,
      weight: weight, bodyfat: isNaN(bf) ? null : bf,
      dayType: (g('bdType') && g('bdType').value) || '训练日',
      diet: (g('bdDiet') && g('bdDiet').value) || '标准健康饮食',
      periodDay: !!(g('bdPeriod') && g('bdPeriod').checked),
      training: (g('bdTrain') && g('bdTrain').value) || '',
      note: (g('bdNote') && g('bdNote').value) || '',
      createdAt: new Date().toISOString(),
    });
    saveState();
    const h = awardDailyHours('body', '身体台账');
    if (h) showToast('⚖️ 已记录， +' + h + ' 个修炼时辰', 'info');
    else showToast('已记录', 'success');
    navTo('exercise');
  }
  function delBodyRecord(id) {
    const s = getState();
    s.body.records = (s.body.records || []).filter(r => r.id !== id);
    saveState(); navTo('exercise');
  }
  function saveBodyGoals() {
    const g = id => document.getElementById(id);
    const s = getState();
    s.body.goalWeight = parseFloat(g('goalWeight') && g('goalWeight').value) || null;
    s.body.goalBodyfat = parseFloat(g('goalBf') && g('goalBf').value) || null;
    saveState(); navTo('exercise');
    showToast('目标已更新', 'success');
  }
  function setLastPeriod() {
    const g = id => document.getElementById(id);
    const s = getState();
    s.body.lastPeriodStart = (g('lastPeriod') && g('lastPeriod').value) || '';
    saveState(); navTo('exercise');
  }
  function trendSvg(recs) {
    const pts = recs.slice(0, 12).slice().reverse();   // 旧 -> 新
    if (pts.length < 2) return '<div class="side-empty">记满 2 次就能看到趋势线</div>';
    const W = 320, H = 120, PAD = 24;
    const ws = pts.map(r => r.weight || 0), bfs = pts.map(r => (r.bodyfat == null ? null : r.bodyfat));
    const wMin = Math.min.apply(null, ws), wMax = Math.max.apply(null, ws);
    const bfVals = bfs.filter(v => v != null);
    const bMin = bfVals.length ? Math.min.apply(null, bfVals) : 0;
    const bMax = bfVals.length ? Math.max.apply(null, bfVals) : 1;
    const X = i => PAD + i * (W - PAD * 2) / (pts.length - 1);
    const Yw = v => H - PAD - ((v - wMin) / ((wMax - wMin) || 1)) * (H - PAD * 2);
    const Yb = v => H - PAD - ((v - bMin) / ((bMax - bMin) || 1)) * (H - PAD * 2);
    const wLine = pts.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yw(r.weight || 0).toFixed(1)).join(' ');
    const bfPts = bfs.map((v, i) => ({ v: v, i: i })).filter(o => o.v != null);
    const bLine = bfPts.map((o, i) => (i ? 'L' : 'M') + X(o.i).toFixed(1) + ',' + Yb(o.v).toFixed(1)).join(' ');
    const dots = pts.map((r, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Yw(r.weight || 0).toFixed(1) + '" r="2.6" fill="#FF6D24"/>').join('')
      + bfPts.map(o => '<circle cx="' + X(o.i).toFixed(1) + '" cy="' + Yb(o.v).toFixed(1) + '" r="2.4" fill="#8A7BE8"/>').join('');
    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
        <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(39,53,47,.18)"/>
        <polyline points="${wLine}" fill="none" stroke="#FF6D24" stroke-width="2"/>
        ${bfPts.length ? '<polyline points="' + bLine + '" fill="none" stroke="#8A7BE8" stroke-width="2" stroke-dasharray="4 3"/>' : ''}
        ${dots}
        <text x="${PAD}" y="12" font-size="10" fill="#FF6D24">● 体重（斤）</text>
        <text x="${PAD + 78}" y="12" font-size="10" fill="#8A7BE8">● 体脂率（%）</text>
      </svg>`;
  }
  function bodySection() {
    const s = getState();
    const b = s.body || {};
    const recs = (b.records || []).slice().sort((a, c) => (a.date < c.date ? 1 : -1));
    const latest = recs[0];
    const prev = recs[1];
    const monthStart = todayStr().slice(0, 8) + '01';
    const monthRecs = recs.filter(r => r.date >= monthStart);
    const firstOfMonth = monthRecs[monthRecs.length - 1];
    const gw = b.goalWeight, gb = b.goalBodyfat;
    const kpi = [
      { label: '当前体重', val: latest ? latest.weight + ' 斤' : '--' },
      { label: '当前体脂', val: latest && latest.bodyfat != null ? latest.bodyfat + ' %' : '--' },
      { label: '本月已减体重', val: (latest && firstOfMonth && firstOfMonth.weight != null) ? Math.max(0, (firstOfMonth.weight - latest.weight)).toFixed(1) + ' 斤' : '--' },
      { label: '距目标', val: (latest && gw) ? Math.max(0, latest.weight - gw).toFixed(1) + ' 斤' : (latest && gb && latest.bodyfat != null) ? Math.max(0, latest.bodyfat - gb).toFixed(1) + ' %' : '--' },
    ];
    const cycleInfo = b.lastPeriodStart ? (() => {
      const start = new Date(b.lastPeriodStart), now = new Date(todayStr());
      const day = Math.floor((now - start) / 86400000) + 1;
      const inPeriod = day <= (b.periodDays || 4);
      return '周期第 ' + day + ' 天' + (inPeriod ? ' · 经期中' : ' · 非经期');
    })() : '记一次经期开始日期，就能算周期';
    return `
    <div class="card">
      <div class="card-title"><span class="title-icon">⚖️</span>身体台账
        <span style="margin-left:auto;font-size:12px;color:var(--ink-3)">周期 ${b.cycleDays || 28} 天 · 行经 ${b.periodDays || 4} 天</span></div>
      <div class="body-kpis">
        ${kpi.map(k => '<div class="bp-card"><div class="bp-label">' + k.label + '</div><div class="bp-value">' + k.val + '</div></div>').join('')}
      </div>
      <div style="margin:6px 0 2px">${trendSvg(recs)}</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">目标体重（斤）</label>
          <input class="input" id="goalWeight" type="number" step="0.1" value="${gw == null ? '' : gw}"></div>
        <div class="form-group"><label class="form-label">目标体脂（%）</label>
          <input class="input" id="goalBf" type="number" step="0.1" value="${gb == null ? '' : gb}"></div>
        <div class="form-group" style="align-self:flex-end"><button class="btn btn-outline btn-sm" style="width:100%" onclick="saveBodyGoals()">存目标</button></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">最近一次经期开始</label>
          <input class="input" id="lastPeriod" type="date" value="${b.lastPeriodStart || ''}"></div>
        <div class="form-group" style="align-self:flex-end"><button class="btn btn-outline btn-sm" style="width:100%" onclick="setLastPeriod()">更新</button></div>
        <div class="form-group" style="align-self:flex-end"><div class="ri-meta">${cycleInfo}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><span class="title-icon">📝</span>记一次身体数据</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">日期</label>
          <input class="input" id="bdDate" type="date" value="${todayStr()}"></div>
        <div class="form-group"><label class="form-label">体重（斤）</label>
          <input class="input" id="bdWeight" type="number" step="0.1" placeholder="如 120.5"></div>
        <div class="form-group"><label class="form-label">体脂率（%）</label>
          <input class="input" id="bdBf" type="number" step="0.1" placeholder="可选"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">状态</label>
          <select class="select" id="bdType"><option>训练日</option><option>休息日</option><option>放纵日</option></select></div>
        <div class="form-group"><label class="form-label">饮食</label>
          <select class="select" id="bdDiet">${DIET_TAGS.map(d => '<option>' + d + '</option>').join('')}</select></div>
        <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:6px;min-height:38px">
          <input type="checkbox" id="bdPeriod" style="width:16px;height:16px"> 经期日</label></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">训练内容</label>
          <input class="input" id="bdTrain" placeholder="如：力量 40 分钟 + 慢跑 20 分钟"></div>
        <div class="form-group"><label class="form-label">补充说明（可选）</label>
          <input class="input" id="bdNote" placeholder="补充说明"></div>
        <div class="form-group" style="align-self:flex-end"><button class="btn btn-gold" style="width:100%" onclick="saveBodyRecord()">⚖️ 记录今天</button></div>
      </div>
      <div class="record-list">
        ${recs.length ? recs.slice(0, 8).map(r => `
          <div class="record-item">
            <div class="ri-content">
              <div class="ri-title">${r.date} · ${r.weight} 斤${r.bodyfat != null ? ' · ' + r.bodyfat + ' %' : ''} · ${r.dayType}</div>
              <div class="ri-meta">${r.diet}${r.periodDay ? ' · 经期日' : ''}${r.training ? ' · ' + r.training : ''}${r.note ? ' · ' + r.note : ''}</div>
            </div>
            <span class="op" title="删除" onclick="delBodyRecord('${r.id}')">✕</span>
          </div>`).join('') : emptyState('⚖️', '还没有身体数据，记一次就能看趋势')}
      </div>
    </div>`;
  }
"""

# ---------------------------------------------------------------- 3) CSS
CSS_BLOCK = """  /* ===== utopia 移植：焦点卡 / 四象限 / 计划月历 / 身体台账 ===== */
    .focus-card .quick-todo { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .focus-card .quick-todo .select { max-width: 150px; }
    .focus-card .quick-todo .input[type="date"] { max-width: 150px; }
    .focus-now { border-radius: var(--radius-sm); padding: 14px 16px; cursor: pointer;
      background: linear-gradient(135deg, rgba(255,109,36,.14), rgba(255,109,36,.04));
      border: 1px solid rgba(255,109,36,.28); }
    .focus-now.empty { background: var(--sunken, #F6E9D8); border-color: var(--line); }
    .focus-q { font-size: 11px; letter-spacing: 2px; color: var(--accent-deep, #E85A12); font-weight: 700; }
    .focus-now.empty .focus-q { color: var(--ink-3); }
    .focus-text { font-size: 19px; font-weight: 700; color: var(--ink); margin: 5px 0 4px; }
    .focus-meta { font-size: 11.5px; color: var(--ink-3); }
    .quad-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .quad-cell { background: var(--surface, #FFFDF8); border: 1px solid var(--line);
      border-top: 3px solid var(--qc, var(--accent)); border-radius: var(--radius-sm); padding: 12px; }
    .quad-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
    .quad-name { font-size: 13.5px; font-weight: 700; color: var(--qc, var(--ink)); }
    .quad-hint { font-size: 11px; color: var(--ink-3); }
    .quad-empty { font-size: 12px; color: var(--ink-3); padding: 8px 0; }
    .todo-item { display: flex; align-items: center; gap: 9px; padding: 7px 6px;
      border-radius: 8px; }
    .todo-item + .todo-item { border-top: 1px dashed var(--line-soft); }
    .todo-item.is-focus { background: rgba(255,109,36,.10); }
    .todo-item.over .todo-text { color: var(--color-danger); }
    .todo-check { width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--ink-3);
      display: flex; align-items: center; justify-content: center; font-size: 12px;
      color: #fff; cursor: pointer; flex-shrink: 0; }
    .todo-item.done .todo-check { background: var(--teal, #27A973); border-color: var(--teal, #27A973); }
    .todo-item.done .todo-text { text-decoration: line-through; color: var(--ink-3); }
    .todo-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .todo-text { font-size: 14px; color: var(--ink); cursor: pointer; }
    .todo-due { font-size: 10.5px; color: var(--ink-3); }
    .todo-over { font-size: 10.5px; color: var(--color-danger); font-weight: 700; }
    .todo-ops { display: flex; gap: 4px; opacity: 0; transition: opacity var(--dur-fast); }
    .todo-item:hover .todo-ops { opacity: 1; }
    .todo-ops .op { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      border-radius: 5px; cursor: pointer; font-size: 10px; color: var(--ink-3); }
    .todo-ops .op:hover { background: rgba(39,53,47,.08); color: var(--ink); }
    .cal-head { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px; }
    .cal-head span { text-align: center; font-size: 11px; color: var(--ink-3); }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cal-cell { min-height: 56px; border-radius: 8px; background: rgba(255,255,255,.55);
      border: 1px solid transparent; padding: 4px 5px; cursor: pointer;
      display: flex; flex-direction: column; gap: 2px; position: relative;
      transition: background var(--dur-fast); }
    .cal-cell:hover { background: #fff; }
    .cal-cell.dim { opacity: .55; }
    .cal-cell.today { border-color: var(--accent); }
    .cal-cell.sel { background: var(--accent-soft, rgba(255,109,36,.14)); border-color: var(--accent); }
    .cal-day { font-size: 12px; font-weight: 600; color: var(--ink); }
    .cal-count { position: absolute; top: 3px; right: 4px; font-size: 9px; background: var(--accent);
      color: #fff; border-radius: 8px; padding: 0 4px; font-weight: 700; }
    .cal-dot { width: 5px; height: 5px; border-radius: 50%; }
    .cal-dot.ok { background: var(--teal, #27A973); }
    .overdue-bar { margin-top: 10px; padding: 8px 12px; border-radius: 8px;
      background: rgba(232,74,60,.10); font-size: 12.5px; color: var(--ink-2); }
    .plan-item .plan-cat { font-size: 10.5px; color: var(--accent-deep, #E85A12);
      border: 1px solid rgba(255,109,36,.28); border-radius: 999px; padding: 0 6px; margin-left: 4px; }
    .plan-item .todo-check { border-radius: 50%; }
    .plan-item.done .plan-cat { opacity: .5; }
    .body-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
    .bp-card { background: var(--sunken, #F6E9D8); border-radius: var(--radius-sm); padding: 10px 12px; }
    .bp-label { font-size: 11px; color: var(--ink-3); }
    .bp-value { font-size: 19px; font-weight: 700; color: var(--ink); margin-top: 2px; }
    .record-item .op { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
      border-radius: 6px; cursor: pointer; color: var(--ink-3); font-size: 11px; }
    .record-item .op:hover { background: rgba(39,53,47,.08); color: var(--color-danger); }
    @media (max-width: 768px) {
      .quad-grid { grid-template-columns: 1fr; }
      .body-kpis { grid-template-columns: 1fr 1fr; }
      .focus-text { font-size: 16px; }
      .focus-card .quick-todo .select, .focus-card .quick-todo .input[type="date"] { max-width: none; }
    }
"""

# ---------------------------------------------------------------- 4) 导航
NAV_ANCHOR = """    { key: 'jianghu',     name: '江湖·文字武侠', icon: '⚔️' },
  ];"""
NAV_NEW = """    { key: 'jianghu',     name: '江湖·文字武侠', icon: '⚔️' },
    { key: 'planner',     name: '计划月历',     icon: '🗓️' },
  ];"""
RENDER_ANCHOR = """    'jianghu':         () => Jianghu.render(),
  };"""
RENDER_NEW = """    'jianghu':         () => Jianghu.render(),
    'planner':         () => renderPlanner(),
  };"""
TITLE_ANCHOR = "'jianghu':'江湖·文字武侠',"
TITLE_NEW = "'jianghu':'江湖·文字武侠', 'planner':'计划月历',"

# ---------------------------------------------------------------- 5) 挂载
JS_ANCHOR = "\n  function initApp() {"

DASH_ANCHOR = """    </div>

    <!-- 金矿资产总览 -->"""
DASH_NEW = """    </div>

    ${renderFocusAndQuads()}

    <!-- 金矿资产总览 -->"""

EX_ANCHOR = """    ${renderModuleHeader('exercise')}
    <div class="grid grid-2">"""
EX_NEW = """    ${renderModuleHeader('exercise')}
    ${bodySection()}
    <div class="grid grid-2">"""


def sub_once(h, old, new, tag):
    assert old in h, '锚点未命中: ' + tag
    return h.replace(old, new, 1)


def main() -> None:
    html = io.open(APP, encoding='utf-8').read()

    # 1) 数据层
    html = sub_once(html, DEFAULT_STATE_ANCHOR, DEFAULT_STATE_NEW, 'defaultState')
    print('1) defaultState 增加 todos/plans/body')

    # 2) 江湖时辰表
    wuxia = io.open(WUXIA, encoding='utf-8').read()
    assert TASK_HOURS_OLD in wuxia, 'TASK_HOURS 锚点未命中'
    wuxia = wuxia.replace(TASK_HOURS_OLD, TASK_HOURS_NEW, 1)
    io.open(WUXIA, 'w', encoding='utf-8', newline='').write(wuxia)
    print('2) WUXIA.TASK_HOURS 增加 todo:2 / planner:2 / body:1')

    # 3) JS 函数块（挂在 initApp 之前）
    html = sub_once(html, JS_ANCHOR, '\n' + JS_BLOCK + JS_ANCHOR, 'JS 函数块')
    print('3) 新增 utopia 模块函数块')

    # 4) 导航/渲染器/标题
    html = sub_once(html, NAV_ANCHOR, NAV_NEW, 'NAV_CONFIG')
    html = sub_once(html, RENDER_ANCHOR, RENDER_NEW, 'PAGE_RENDERERS')
    html = sub_once(html, TITLE_ANCHOR, TITLE_NEW, 'PAGE_TITLES')
    print('4) 计划月历 已加入导航/渲染器/标题')

    # 5) 主控大厅：焦点卡 + 四象限
    html = sub_once(html, DASH_ANCHOR, DASH_NEW, '主控大厅')
    print('5) 主控大厅 首屏加入焦点卡 + 四象限')

    # 6) 运动台账：身体台账
    html = sub_once(html, EX_ANCHOR, EX_NEW, '运动台账')
    print('6) 运动台账 加入身体台账')

    # 7) CSS（追加到样式表末尾，优先级最高）
    assert CSS_BLOCK.strip() not in html
    html = html.replace('  </style>', CSS_BLOCK + '  </style>', 1)
    print('7) CSS 追加完成')

    io.open(APP, 'w', encoding='utf-8', newline='').write(html)
    print('written ->', APP)


if __name__ == '__main__':
    main()
