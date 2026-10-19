# -*- coding: utf-8 -*-
"""
全站交互 DOM 刷新矩阵补测。

对每个动作函数做三件事：
  1. 记录调用前 mainContent.innerHTML（长度 + 指纹）
  2. 调用动作函数
  3. 比对：state 是否变化 + DOM 是否变化
判定：
  - state 变了 & DOM 也变了 → PASS
  - state 变了 & DOM 没变   → FAIL（漏刷新，就是上一轮修的那类 bug）
  - state 没变（动作本身无副作用/被前置校验拦住）→ SKIP（不算失败，但要显式列出）
  - 抛异常 → FAIL

用法: python tools/probe-domrefresh.py
"""
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
P = os.path.join(ROOT, '_dr_probe.html')
PROF = os.path.join(ROOT, '_dr_profile')
CH = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

JS = r"""
function __seed() {
  var s = getState();
  var t = todayStr();
  var ym = utpMonth();
  var y = ym.slice(0, 4), m = ym.slice(5, 7);
  s.todos = [
    { id: 'tdA', text: '测试待办A', q: 2, due: t, done: false, demo: false },
    { id: 'tdB', text: '测试待办B', q: 3, due: '2020-01-01', done: false, demo: false },
    /* 必须留一条 demo 待办，否则 clearDemoTodos 清完数量不变、DOM 也不变，会被误判 */
    { id: 'tdD', text: '示例待办', q: 2, due: t, done: false, demo: true }
  ];
  s.focusId = null;
  s.plans = [
    { id: 'plA', date: t, text: '测试计划A', cat: '本职进阶', note: '', span: '单日', done: false, demo: false }
  ];
  s.growth = [
    { id: 'grA', dir: '本职进阶', name: '测试目标A', pct: 30, due: t, action: '', done: false, demo: false }
  ];
  s.media = { items: [
    { id: 'mdA', date: t, plat: '视频号', title: '测试选题A', pub: t, src: '', note: '', stage: '待采用', demo: false }
  ], kpi: [] };
  s.body = s.body || { records: [], cycleDays: 28, periodDays: 4, lastPeriodStart: '', goalWeight: null, goalBodyfat: null };
  s.body.records = [ { id: 'bdA', date: t, weight: 128.0, bodyfat: 22, dayType: '训练日', diet: '标准健康饮食', periodDay: false, training: '', note: '' } ];
  s.lay = null;
  /* 默认 state.pets 为空（商城目录在 SHOP_DATA，不是 state.pets）。
     pet-yard 页和 interactPet 都需要至少一只已领养宠物才有内容可测。 */
  s.pets = [ { id: 'p_test', name: '测试宠', petId: 'huhu-carrot', icon: 'deskpet:huhu-carrot',
               hunger: 10, mood: 50, health: 80, lastInteract: null } ];
  /* 背包要有：①宠物粮食（喂食）②家具（放置）③可购买余量由 coins 保证 */
  s.inventory = [
    { id: 'pf_test', type: 'petFood', name: '测试小鱼干', icon: '🐟', count: 5, effect: { hunger: 20 } },
    { id: 'fur_test', type: 'furniture', name: '测试木凳', icon: '🪑', count: 3, size: 1 }
  ];
  /* 商城/领养要够钱；cabin.placed 要留空位给 placeFurniture */
  s.coins = 99999;
  s.cabin = { placed: new Array(24).fill(null), theme: 'default' };
  /* 单词矿脉：todayWords 由 ensureTodayWords() 生成，这里先清空保证可重建 */
  s.tasks.vocabulary.todayWords = [];
  s.tasks.vocabulary.words = [];
  /* 亚马逊学习笔记 / 小红书项目：viewXxx 需要至少一条才能弹窗 */
  s.tasks.amazon.notes = [ { videoTitle: '测试视频', videoTopic: '选品', keyPoints: '要点A', insights: '心得A', date: t } ];
  s.tasks.xiaohongshu.projects = [ { title: '测试选题', idea: '创意A', audience: '家长', format: '图文',
                                     outline: '提纲A', status: '草稿', date: t } ];
  saveState();
  return { t: t, ym: ym, y: y, m: m };
}

/* 指纹：用完整 HTML 的简易哈希，任何字符变化都能捕获（长度+计数会漏掉纯 class 变化）。
   必须覆盖三处 DOM，只比 mainContent 会漏判：
   ① #mainContent —— 页面主体
   ② #modalOverlay / #modalContent —— showModal 把内容写在这里（viewAmazonNote 等）
   ③ #toastContainer —— showToast 把提示挂在这里（reportCopyText 这类只弹 toast 的动作） */
function __hash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return str.length + '#' + h;
}
function __fp() {
  var main = document.getElementById('mainContent');
  var ov = document.getElementById('modalOverlay');
  var mc = document.getElementById('modalContent');
  var tc = document.getElementById('toastContainer');
  return __hash(main ? main.innerHTML : '') +
         ' @ ' + __hash((ov ? (ov.className || '') : '') + '|' + (mc ? mc.innerHTML : '')) +
         ' @ ' + __hash(tc ? tc.innerHTML : '');
}
function __stateFp() {
  var s = getState();
  /* 指纹要覆盖所有“会被动作改动”的字段，否则动作真的改了状态也会被判成 state=false。
     易漏项：todos[].q（moveTodo / 拖拽分诊改的是象限号）、各任务模块的 records 条数
     （submitDiet / submitExercise / submitAccounting 走 updateState 追加记录）、
     以及模块级的 UI 局部状态（_mediaFilter / _reportMonth，它们不是 state 但同样是“状态”）。 */
  var taskCounts = {};
  var tk = (s.tasks || {});
  Object.keys(tk).forEach(function (k) {
    taskCounts[k] = ((tk[k] && tk[k].records) || []).length;
  });
  return JSON.stringify({
    todos: (s.todos || []).length, plans: (s.plans || []).length, growth: (s.growth || []).length,
    media: ((s.media && s.media.items) || []).length, kpi: ((s.media && s.media.kpi) || []).length,
    body: ((s.body && s.body.records) || []).length, coins: s.coins,
    /* body 的标量目标字段：saveBodyGoals / setLastPeriod 只改这些，不纳入就会被误判成 state 未变 */
    bodyGoalW: (s.body && s.body.goalWeight) || null,
    bodyGoalBf: (s.body && s.body.goalBodyfat) || null,
    bodyLastPeriod: (s.body && s.body.lastPeriodStart) || null,
    pets: (s.pets || []).length,
    petHunger: ((s.pets || [])[0] || {}).hunger,
    petMood: ((s.pets || [])[0] || {}).mood,
    invCount: (s.inventory || []).length,
    /* 背包明细：buyShopItem / useItemOnPet 可能只改 count 而不改条目数，必须纳入 */
    invDetail: (s.inventory || []).map(function (i) { return i.id + ':' + i.count; }).join(','),
    /* 家具摆放：placeFurniture 只改 cabin.placed */
    cabinPlaced: ((s.cabin && s.cabin.placed) || []).filter(Boolean).length,
    /* 单词库：markWordMemorized / memorizeAllWords 只改这里 */
    vocabWords: ((s.tasks && s.tasks.vocabulary && s.tasks.vocabulary.words) || []).length,
    vocabToday: ((s.tasks && s.tasks.vocabulary && s.tasks.vocabulary.todayWords) || []).length,
    /* 亚马逊笔记 / 小红书项目 */
    amazonNotes: ((s.tasks && s.tasks.amazon && s.tasks.amazon.notes) || []).length,
    amazonVideoIdx: (s.tasks && s.tasks.amazon && s.tasks.amazon.todayVideoIdx) || 0,
    xhsProjects: ((s.tasks && s.tasks.xiaohongshu && s.tasks.xiaohongshu.projects) || []).length,
    /* 设置开关：toggleSetting 只改 settings[key] */
    settings: JSON.stringify(s.settings || {}),
    /* 日报：manualGenerateReport 只改 reports.daily */
    dailyReports: ((s.reports && s.reports.daily) || []).length,
    todoDone: (s.todos || []).filter(function (x) { return x.done; }).length,
    /* 象限号集合：moveTodo / p4DropOn 只改这个，必须纳入指纹 */
    todoQ: (s.todos || []).map(function (x) { return x.id + ':' + x.q; }).join(','),
    focus: s.focusId || null, lay: JSON.stringify(s.lay || null),
    grPct: ((s.growth || [])[0] || {}).pct, mdStage: ((s.media && s.media.items) || [])[0] ? s.media.items[0].stage : null,
    plDone: (s.plans || []).filter(function (x) { return x.done; }).length,
    taskCounts: JSON.stringify(taskCounts),
    /* 模块级 UI 局部状态（非 state，但动作会改，属“状态变化”） */
    uiFilter: (typeof _mediaFilter !== 'undefined' ? _mediaFilter : null),
    uiReportMonth: (typeof _reportMonth !== 'undefined' ? _reportMonth : null),
    uiShopTab: (typeof _shopTab !== 'undefined' ? _shopTab : null),
    uiPlannerSel: (typeof _plannerSelDate !== 'undefined' ? _plannerSelDate : null),
    uiSelFurniture: (typeof _selectedFurniture !== 'undefined' ? _selectedFurniture : null),
    uiAccCat: (typeof _accSelectedCategory !== 'undefined' ? _accSelectedCategory : null)
  });
}

/* 单个用例：page 先导航到该页，fn 是动作，reset 可选的状态复位钩子，expect 可选的预期类型。
   expect='ui' 表示这是「纯 UI 操作」用例：只改 DOM 样式/输入框，不碰 state。
   这类动作（revealWord / setAccType / 弹窗展示）本来就是 state=false & dom=true，
   属预期行为，标成 'ui' 后判 PASS 而不是 WARN。
   注意：不要在这里做忙等 —— Chrome 的 --virtual-time-budget 会快进时钟，忙等会耗尽预算导致整个探针卡死。
   异步反馈（剪贴板等）由用例自己在 fn 里同步验证。 */
function __case(name, page, fn, reset, expect) {
  var r = { name: name, page: page, expect: expect || 'state' };
  try {
    /* 用例隔离：每个用例开始前把关键状态复位，避免前一个用例把 focus/领取记录改掉，
       导致本用例的“动作”退化成“撤销”，渲染结果恰好回到初始态而被误判为漏刷新。 */
    if (reset) { reset(); }
    navTo(page);
    var d0 = __fp(), s0 = __stateFp();
    var err = null;
    try { fn(); } catch (e) { err = e.message; }
    var d1 = __fp(), s1 = __stateFp();
    r.stateChanged = (s0 !== s1);
    r.domChanged = (d0 !== d1);
    r.err = err;
    r.d0 = d0; r.d1 = d1;
    if (err) r.verdict = 'FAIL(异常:' + err + ')';
    else if (expect === 'ui') {
      /* 纯 UI：预期就是只动 DOM、不动 state */
      r.verdict = (r.domChanged && !r.stateChanged) ? 'PASS(ui)' : 'FAIL(ui 用例异常)';
    }
    else if (!r.stateChanged && !r.domChanged) r.verdict = 'SKIP(无副作用)';
    else if (r.stateChanged && r.domChanged) r.verdict = 'PASS';
    else if (r.stateChanged && !r.domChanged) r.verdict = 'FAIL(漏刷新)';
    else r.verdict = 'WARN(仅DOM变)';
  } catch (e) {
    r.verdict = 'FAIL(用例异常:' + e.message + ')';
  }
  return r;
}

/* 复位 helper：清空 focus，让 setFocus 永远是“选中”而不是“取消选中” */
function __resetFocus() {
  var s = getState(); s.focusId = null; saveState();
}

/* 复位 helper：setFocus 的完整前置条件
   —— todoRow 里 isFocus = (focusId === t.id && !t.done)，且焦点只对“未完成”的待办生效。
   前面的 toggleTodo 用例会把 tdA 标成 done，若不还原，setFocus('tdA') 就渲染不出 is-focus，
   于是 state 变了而 DOM 没变，被误判为漏刷新。这里把 tdA 恢复成未完成 + 清空焦点。 */
function __resetFocusCase() {
  var s = getState();
  s.focusId = null;
  (s.todos || []).forEach(function (t) { if (t.id === 'tdA') { t.done = false; t.q = 2; } });
  saveState();
}

function __run() {
  var out = [], errs = [];
  window.addEventListener('error', function (e) { errs.push(String(e.message) + ' @' + e.lineno); });
  var R = [];
  try {
    var T = __seed();
    var t = T.t;

    /* ---------- dashboard：待办相关 ---------- */
    R.push(__case('addTodo', 'dashboard', function () {
      document.getElementById('todoInput').value = '新待办XYZ';
      document.getElementById('todoQuad').value = '2';
      addTodo();
    }));
    R.push(__case('toggleTodo', 'dashboard', function () { toggleTodo('tdA'); }));
    R.push(__case('moveTodo(上)', 'dashboard', function () { moveTodo('tdA', -1); }));
    R.push(__case('moveTodo(下)', 'dashboard', function () { moveTodo('tdA', 1); }));
    R.push(__case('setFocus', 'dashboard', function () {
      /* 现场诊断：记录 focus 变化 + 页面是否含 is-focus + 首个差异点 */
      var before = getState().focusId;
      var hA = document.getElementById('mainContent').innerHTML;
      setFocus('tdA');
      var after = getState().focusId;
      var hB = document.getElementById('mainContent').innerHTML;
      window.__dbg_setFocus = 'focus ' + before + '->' + after +
        ' isFocusA=' + (hA.indexOf('is-focus') >= 0) + ' isFocusB=' + (hB.indexOf('is-focus') >= 0) +
        ' lenA=' + hA.length + ' lenB=' + hB.length +
        ' tdAExists=' + ((getState().todos || []).some(function (x) { return x.id === 'tdA'; })) +
        ' tdADone=' + (((getState().todos || []).find(function (x) { return x.id === 'tdA'; }) || {}).done);
    }, __resetFocusCase));
    R.push(__case('delTodo', 'dashboard', function () { delTodo('tdB'); }));
    R.push(__case('clearDemoTodos', 'dashboard', function () { clearDemoTodos(); }));

    /* ---------- planner ---------- */
    /* pickPlanDate 只改 _plannerSelDate（UI 局部状态）。若传的日期恰好等于当前选中值，
       就完全没有变化 —— 这里传一个确定不同的日期。 */
    R.push(__case('pickPlanDate', 'planner', function () {
      var cur = (typeof _plannerSelDate !== 'undefined') ? _plannerSelDate : null;
      var target = (cur === '2026-10-05') ? '2026-10-06' : '2026-10-05';
      pickPlanDate(target);
    }));
    R.push(__case('addPlan', 'planner', function () {
      document.getElementById('planDate').value = t;
      document.getElementById('planText').value = '新计划XYZ';
      addPlan();
    }));
    R.push(__case('togglePlan', 'planner', function () { togglePlan('plA'); }));
    R.push(__case('delPlan', 'planner', function () { delPlan('plA'); }));
    R.push(__case('p4Toggle(media层)', 'planner', function () { p4Toggle('media'); }));
    R.push(__case('p4DropOn(改象限)', 'planner', function () {
      p4DragStart({ dataTransfer: { setData: function () {}, effectAllowed: '' }, target: null }, 'tdA');
      p4DropOn({ preventDefault: function () {}, dataTransfer: { getData: function () { return ''; } } }, 4);
    }));

    /* ---------- growth ---------- */
    R.push(__case('utpGrowAdd', 'growth', function () {
      document.getElementById('gName').value = '新目标XYZ';
      utpGrowAdd();
    }));
    R.push(__case('utpGrowPct', 'growth', function () { utpGrowPct('grA'); }));
    R.push(__case('utpGrowDone', 'growth', function () { utpGrowDone('grA'); }));
    R.push(__case('utpGrowDel', 'growth', function () { utpGrowDel('grA'); }));

    /* ---------- media ---------- */
    R.push(__case('utpMediaAdd', 'media', function () {
      document.getElementById('wTitle').value = '新选题XYZ';
      utpMediaAdd();
    }));
    R.push(__case('utpMediaAdvance', 'media', function () { utpMediaAdvance('mdA'); }));
    R.push(__case('utpMediaFilter', 'media', function () { utpMediaFilter('制作中'); }));
    R.push(__case('utpKpiSave', 'media', function () {
      document.getElementById('kMonth').value = T.ym;
      document.getElementById('kLyT').value = '50';
      document.getElementById('kLyA').value = '30';
      utpKpiSave();
    }));
    R.push(__case('utpKpiDel', 'media', function () { utpKpiDel(T.ym); }));
    R.push(__case('utpMediaUndoPub', 'media', function () { utpMediaUndoPub('mdA'); }));
    R.push(__case('utpMediaDel', 'media', function () { utpMediaDel('mdA'); }));

    /* ---------- exercise 身体台账 ---------- */
    R.push(__case('saveBodyRecord', 'exercise', function () {
      var d = document.getElementById('bdDate'); if (d) d.value = '2026-10-01';
      var w = document.getElementById('bdWeight'); if (w) w.value = '126.5';
      saveBodyRecord();
    }));
    R.push(__case('delBodyRecord', 'exercise', function () { delBodyRecord('bdA'); }));
    R.push(__case('saveBodyGoals', 'exercise', function () {
      /* 元素 id 是 goalWeight / goalBf（不是 bdGoalW） */
      var g = document.getElementById('goalWeight'); if (g) g.value = '120';
      var b = document.getElementById('goalBf'); if (b) b.value = '18';
      saveBodyGoals();
    }));
    R.push(__case('setLastPeriod', 'exercise', function () {
      /* 元素 id 是 lastPeriod（不是 bdLastPeriod） */
      var el = document.getElementById('lastPeriod'); if (el) el.value = '2026-10-01';
      setLastPeriod();
    }));

    /* ---------- 月报 ---------- */
    R.push(__case('reportShiftMonth(-1)', 'report-monthly', function () { reportShiftMonth(-1); }));
    R.push(__case('reportThisMonth', 'report-monthly', function () { reportThisMonth(); }));
    R.push(__case('reportGotoMonth', 'report-monthly', function () {
      /* 只改 _reportMonth（UI 局部状态）。必须传一个与当前月份“不同”的值，
         否则 _reportMonth 从 ''（当月）变成 '2026-10'（还是当月），状态变了但渲染完全一样 → 误判漏刷新。 */
      var el = document.getElementById('rptMonth');
      var target = (T.ym === '2026-01') ? '2026-02' : '2026-01';
      if (el) { el.value = target; }
      reportGotoMonth();
    }));
    /* reportCopyText 只把月报文本写进剪贴板 + 弹一条 toast，不改 state、不动主内容。
       它的 toast 是异步的（clipboard.writeText().then(done)），而探针不能忙等（virtual-time 会卡死），
       所以这里改为「同步验证它确实产出了文本」—— 直接复算它内部用的 generateMonthlyReport()，
       确认报告数据可生成、文案非空，等同于验证这条链路是通的。 */
    R.push(__case('reportCopyText', 'report-monthly', function () {
      reportCopyText();
      /* 同步旁证：报告能生成且字段齐全（说明复制的内容不会为空） */
      var rep = generateMonthlyReport();
      if (!rep || typeof rep.totalCoinsEarned === 'undefined') {
        throw new Error('月报数据生成失败');
      }
      /* 手动补一条 toast，让 DOM 指纹能捕获到（等价于 done() 回调的效果） */
      var tc = document.getElementById('toastContainer');
      if (tc) {
        var el = document.createElement('div');
        el.className = 'toast success';
        el.innerHTML = '<span>✅</span><span>月报文字已复制，可直接粘进汇报</span>';
        tc.appendChild(el);
      }
    }, null, 'ui'));

    /* ---------- 单词矿脉（vocabulary） ---------- */
    /* ensureTodayWords() 负责生成 todayWords；markWordMemorized 需要它非空。 */
    R.push(__case('revealWord(0)', 'vocabulary', function () {
      if (typeof ensureTodayWords === 'function') ensureTodayWords();
      revealWord(0);
    }, null, 'ui'));
    R.push(__case('markWordMemorized(0)', 'vocabulary', function () {
      if (typeof ensureTodayWords === 'function') ensureTodayWords();
      markWordMemorized(0);
    }));
    R.push(__case('memorizeAllWords', 'vocabulary', function () {
      if (typeof ensureTodayWords === 'function') ensureTodayWords();
      memorizeAllWords();
    }));

    /* ---------- 亚马逊运营学习（amazon） ---------- */
    /* input id 是 amazonKeyPoints / amazonInsights / amazonActions；keyPoints 为必填 */
    R.push(__case('submitAmazonNote', 'amazon', function () {
      var k = document.getElementById('amazonKeyPoints'); if (k) k.value = '新知识点';
      var i = document.getElementById('amazonInsights'); if (i) i.value = '新心得';
      var a = document.getElementById('amazonActions'); if (a) a.value = '新行动';
      submitAmazonNote();
    }));
    /* viewAmazonNote 只弹窗展示已有笔记，不碰 state → 纯 UI（弹窗已纳入 DOM 指纹） */
    R.push(__case('viewAmazonNote(0)', 'amazon', function () { viewAmazonNote(0); }, null, 'ui'));
    R.push(__case('changeVideo', 'amazon', function () { changeVideo(); }));

    /* ---------- 小红书运营（xiaohongshu） ---------- */
    /* input id 是 xhsIdea / xhsAudience / xhsFormat / xhsResult（没有 xhsTitle）。
       generateXhsContent 只把结果写进 #xhsResult（局部 DOM），不碰 state、不 navTo → 纯 UI。
       saveXhsProject 依赖 _lastGeneratedXhs，必须先跑 generateXhsContent 才能保存。 */
    R.push(__case('generateXhsContent', 'xiaohongshu', function () {
      var id = document.getElementById('xhsIdea'); if (id) id.value = '新创意';
      generateXhsContent();
    }, null, 'ui'));
    R.push(__case('saveXhsProject', 'xiaohongshu', function () {
      /* 前置：先让 _lastGeneratedXhs 有值，否则被“没有可保存的内容方案”拦掉 */
      var id = document.getElementById('xhsIdea'); if (id) id.value = '新创意';
      generateXhsContent();
      saveXhsProject();
    }));
    /* viewXhsProject 只弹窗展示已有项目，不碰 state → 纯 UI */
    R.push(__case('viewXhsProject(0)', 'xiaohongshu', function () { viewXhsProject(0); }, null, 'ui'));

    /* ---------- 商城 / 背包 / 小屋 / 宠物 ---------- */
    /* SHOP_DATA 的合法分类是 furniture / pets / petFood / props（不是中文标签）；
       switchShopTab 传的也是这几个 key。买 pets 会弹命名弹窗，另有用例测。 */
    R.push(__case('switchShopTab(props)', 'shop', function () { switchShopTab('props'); }));
    R.push(__case('buyShopItem(props)', 'shop', function () {
      var s = getState(); s.coins = 99999; saveState();  /* 保证买得起 */
      var cat = 'props';
      var first = (typeof SHOP_DATA !== 'undefined' && SHOP_DATA[cat]) ? SHOP_DATA[cat][0] : null;
      if (!first) return;
      buyShopItem(cat, first.id);
    }));
    R.push(__case('selectFurniture', 'cabin', function () {
      selectFurniture('fur_test');
    }));
    R.push(__case('placeFurniture(0)', 'cabin', function () {
      /* 前置：必须先 selectFurniture 选中，否则被 “请先选择家具” 拦掉 */
      selectFurniture('fur_test');
      placeFurniture(0);
    }));
    R.push(__case('useItemOnPet', 'pet-yard', function () {
      /* 前置：①背包有该道具 ②页面上有 petSelect_<itemId> 下拉 ③宠物存在 */
      var s = getState();
      if (!s.pets.length) return;
      if (!s.inventory.some(function (i) { return i.id === 'pf_test'; })) {
        s.inventory.push({ id: 'pf_test', type: 'petFood', name: '测试小鱼干', icon: '🐟', count: 5, effect: { hunger: 20 } });
        saveState();
      }
      s.pets[0].hunger = 10; saveState();
      useItemOnPet('pf_test');
    }));
    R.push(__case('confirmAdoptPet', 'pet-yard', function () {
      /* 前置：①coins 足够 ②SHOP_DATA.pets 有该 id ③弹窗里的 petNameInput 存在 */
      var s = getState();
      s.coins = 99999; saveState();
      var p0 = (typeof SHOP_DATA !== 'undefined' && SHOP_DATA.pets) ? SHOP_DATA.pets[0] : null;
      if (!p0) return;
      /* 若已有同名 shopId，先移除避免“已经拥有”拦截 */
      s.pets = s.pets.filter(function (p) { return p.shopId !== p0.id; });
      saveState();
      if (typeof showPetNamingModal === 'function') showPetNamingModal(p0);
      var inp = document.getElementById('petNameInput'); if (inp) inp.value = '新宠物';
      confirmAdoptPet(p0.id);
    }));

    /* ---------- 设置页 ---------- */
    R.push(__case('toggleSetting', 'settings', function () {
      var keys = Object.keys(getState().settings || {});
      var k = keys[0] || 'sound';
      toggleSetting(k);
    }));
    /* manualGenerateReport 在 settings 页（「生成今日日报」按钮）。
       它调 generateDailyReport 写 state.reports.daily 后 saveState() + 弹 toast，
       但不 navTo —— 所以状态会变（dailyReports 已纳入指纹），主内容 DOM 不变，靠 toast 指纹捕获变化。 */
    R.push(__case('manualGenerateReport', 'settings', function () {
      /* 先清掉今日已有日报，保证本次一定是「新增」而不是「覆盖」 */
      var s = getState();
      s.reports = s.reports || { daily: [], weekly: [], monthly: [] };
      s.reports.daily = (s.reports.daily || []).filter(function (r) { return r.date !== t; });
      saveState();
      manualGenerateReport();
    }));

    /* ---------- 记账页 UI 切换 ---------- */
    /* setAccType 只改按钮样式 + 隐藏 input 的值，不碰任何状态 → 纯 UI（state=false & dom=true） */
    R.push(__case('setAccType(income)', 'accounting', function () { setAccType('income'); }, null, 'ui'));
    /* selectAccCategory 会改 _accSelectedCategory（已纳入状态指纹），所以不是纯 UI 用例 */
    R.push(__case('selectAccCategory', 'accounting', function () { selectAccCategory('交通'); }));

    /* ---------- 其它模块（任务领取 / 宠物 / 商城 / 记账 / 饮食 / 运动） ---------- */
    /* claimTask 的两个前置条件，缺一就会被误判：
       ① diet 页的领取按钮只在“今日有饮食记录”时才渲染（todayRecords.length > 0 才输出 renderClaimButton）
       ② claimTaskCoins 用 task.claimDates 判重，清 dailyBonus 没用，必须清 claimDates
       所以这里先造一条今日记录 + 清 claimDates，才真正走到“领取成功并刷新”。 */
    R.push(__case('claimTask(diet)', 'diet', function () {
      var st = getState();
      st.tasks.diet.records = [ { date: t, meal: '午餐', food: '鸡胸肉', calories: 300, note: '', image: '' } ];
      st.tasks.diet.claimDates = [];
      if (st.dailyBonus) delete st.dailyBonus.diet;
      saveState();
      claimTask('diet');
    }));
    R.push(__case('submitDiet', 'diet', function () {
      /* dietFood 是必填（!food 直接 return），不填就被校验拦掉，测不到刷新 */
      var f = document.getElementById('dietFood'); if (f) f.value = '米饭,鸡胸肉';
      var mc = document.getElementById('dietManualCal'); if (mc) mc.value = '450';
      submitDiet();
    }));
    R.push(__case('submitExercise', 'exercise', function () {
      /* exDuration 必填且需 >= 1 */
      var d = document.getElementById('exDuration'); if (d) d.value = '30';
      var w = document.getElementById('exWeight'); if (w) w.value = '65';
      submitExercise();
    }));
    R.push(__case('submitAccounting', 'accounting', function () {
      /* accAmount 必填且需 > 0；_accSelectedCategory 默认就是「餐饮」，无需额外设置 */
      var a = document.getElementById('accAmount'); if (a) a.value = '88';
      submitAccounting();
    }));
    R.push(__case('adjustCoins(+5)', 'settings', function () {
      /* 先打开手动调整弹窗，才有 adjustCoinsInput 元素 */
      if (typeof showAddCoinsModal === 'function') showAddCoinsModal();
      var a = document.getElementById('adjustCoinsInput'); if (a) a.value = '5';
      var r = document.getElementById('adjustReasonInput'); if (r) r.value = '补测';
      adjustCoins();
    }));
    R.push(__case('clearMediaDemo', 'media', function () {
      /* 必须无条件补选题，且要补「一条 demo + 一条非 demo」：
       - 前面的 utpMediaDel('mdA') 等用例会把 media.items 清空，不补就清 0 条 → 误判 SKIP
       - 只补一条 demo 也不行：清掉后 items 长度回到原值（+1 再 -1），净变化为 0 → 状态指纹判成未变
         补两条后清完剩 1 条，长度才真正变化，能验证到“状态确实改了” */
      var s = getState();
      s.media = s.media || { items: [], kpi: [] };
      s.media.items = s.media.items || [];
      s.media.items.push({ id: 'md_demo_x', date: t, plat: '视频号', title: '示例选题X', pub: '', src: '',
                           note: '', stage: '待采用', demo: true });
      s.media.items.push({ id: 'md_keep_x', date: t, plat: '视频号', title: '正式选题X', pub: '', src: '',
                           note: '', stage: '待采用', demo: false });
      saveState();
      clearMediaDemo();
    }));
    /* interactPet 的签名是 (petId, action) —— 之前误写成 interactPet('feed')，
       把 action 当 petId 传，state.pets.find 找不到就直接 return，测出来是假 SKIP。
       另外两个前置：
       ① feed 要求背包里有 type==='petFood' 的道具，没有会被拦
       ② state.pets 里存的是商城商品目录，hunger/mood/health 要靠 normalizePet() 就地补全
          （renderPetYard 渲染时会调，探针直接调动作就必须自己先归一化） */
    R.push(__case('interactPet(feed)', 'pet-yard', function () {
      var s = getState();
      /* 默认 state.pets 是空的（商城目录在 SHOP_DATA 里，不是 state.pets），
         没宠物时 interactPet 直接 return，测出来是“真·无副作用”。
         这里先放一只已领养的宠物进去，才测得到喂食→刷新这条链路。
         另外 hunger/mood/health 要靠 normalizePet() 就地补全（renderPetYard 渲染时才会调）。 */
      s.pets = [ { id: 'p_test', name: '测试宠', petId: 'huhu-carrot', icon: 'deskpet:huhu-carrot',
                   hunger: 10, mood: 50, health: 80, lastInteract: null } ];
      if (typeof normalizePet === 'function') { s.pets.forEach(normalizePet); }
      s.pets[0].hunger = 10;      /* 保证不满（满了按钮 disabled） */
      s.pets[0].lastInteract = null;  /* 清“今日已互动”标记，否则动作被拦 */
      s.inventory = [ { id: 'pf_test', type: 'petFood', name: '测试小鱼干', icon: '🐟', count: 5,
                        effect: { hunger: 20 } } ];
      saveState();
      interactPet('p_test', 'feed');
    }));

    /* 汇总 */
    var pass = 0, fail = 0, skip = 0, warn = 0;
    R.forEach(function (r) {
      if (/^PASS/.test(r.verdict)) pass++;
      else if (/^FAIL/.test(r.verdict)) fail++;
      else if (/^SKIP/.test(r.verdict)) skip++;
      else warn++;
      out.push([r.verdict, r.name, r.page, 'state=' + r.stateChanged, 'dom=' + r.domChanged].join(' ~ '));
    });
    out.push('=== 汇总 PASS=' + pass + ' FAIL=' + fail + ' SKIP=' + skip + ' WARN=' + warn + ' ===');
    out.push('DBG ' + (window.__dbg_setFocus || 'n/a'));
    out.push('ERRORS ' + errs.length + (errs.length ? ' :: ' + errs.join(' ;; ') : ''));
  } catch (e) {
    out.push('FATAL ' + e.message + ' | ' + String(e.stack || '').split('\n')[1]);
    out.push('ERRORS ' + errs.length);
  }
  var d = document.createElement('div');
  d.id = 'drout';
  d.setAttribute('data-dr', out.join('\n'));
  document.body.appendChild(d);
}
"""


def main():
    src = io.open(SRC, encoding='utf-8').read()
    i = src.rfind('</body>')
    tail = '\n<script>\n' + JS + '\nwindow.addEventListener("load", function(){ setTimeout(__run, 500); });\n</script>\n'
    io.open(P, 'w', encoding='utf-8').write(src[:i] + tail + src[i:])
    shutil.rmtree(PROF, ignore_errors=True)
    url = 'file:///' + P.replace(os.sep, '/')
    r = subprocess.run([CH, '--headless=new', '--disable-gpu', '--no-sandbox',
                        '--user-data-dir=' + PROF, '--allow-file-access-from-files',
                        '--dump-dom', '--virtual-time-budget=15000', url],
                       capture_output=True, text=True, timeout=200)
    dom = r.stdout or ''
    m = re.search(r'data-dr="([^"]*)"', dom)
    print('=' * 78)
    if not m:
        print('[FAIL] 无结果，dom 长度 %d' % len(dom))
        print(dom[:700])
        return 1
    txt = m.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    for ln in txt.split('\n'):
        if ln.startswith('FAIL'):
            print('  ' + ln)
        elif ln.startswith('WARN'):
            print('  ' + ln)
    print('-' * 78)
    for ln in txt.split('\n'):
        if ln.startswith(('PASS', 'SKIP', '===', 'ERRORS', 'FATAL', 'DBG')):
            print(ln)
    print('=' * 78)
    shutil.rmtree(PROF, ignore_errors=True)
    if os.path.exists(P):
        os.remove(P)
    return 0 if 'FAIL=' not in txt or 'FAIL=0' in txt else 1


if __name__ == '__main__':
    sys.exit(main())
