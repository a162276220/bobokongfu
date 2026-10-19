# -*- coding: utf-8 -*-
"""
淘金矿工小屋 · utopia 移植 第三期：复盘打通
把「成长目标」+「新媒体工作台」数据汇入【挖矿月报】，并让月报可翻月 / 可一键复制。

改动 6 处锚点（全部 assert count==1，失败即停）：
  1) CSS      : 在第二期 CSS 头注释后插入 .rv-* 段
  2) genReport: generateMonthlyReport() 支持 ym 参数 + _reportMonth / 翻月工具函数
  3) render   : renderMonthlyReport() 取到 ym / rv / isCur，并调用 generateReviewExtras
  4) header   : 月报头部插入 翻月控件 + 复制月报按钮
  5) body     : 月度总评前插入「成长目标月报」「新媒体月报」两张卡，总评接 rv
  6) eval+js  : generateMonthlyEvaluation 接 rv 并追加成长/新媒体评语；主 script 尾部注入第三期函数

改前自动备份：_backup-pre-phase3.html
运行： <python> tools/add-utopia-phase3.py
"""
import io
import os
import shutil
import sys
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
BAK = os.path.join(ROOT, '_backup-pre-phase3.html')

PY = sys.executable


def die(msg):
    print('[FAIL] ' + msg)
    sys.exit(1)


def must(h, anchor, name):
    n = h.count(anchor)
    if n != 1:
        die('锚点「%s」出现 %d 次（应为 1）' % (name, n))
    return anchor


# ============================================================
# 0. 读取 + 备份
# ============================================================
h = io.open(HTML, encoding='utf-8').read()
orig_len = len(h)
shutil.copyfile(HTML, BAK)
print('[OK] 备份 -> %s (%d 字节)' % (os.path.basename(BAK), os.path.getsize(BAK)))

# ============================================================
# 1. CSS：.rv-* 段
# ============================================================
css_anchor = must(h, """  /* ============================================================
     utopia 移植 · 第二期：成长目标 / 新媒体工作台
     ============================================================ */
""", 'css-header')

CSS3 = """
  /* ============================================================
     utopia 移植 · 第三期：复盘打通（月报 · 成长 / 新媒体）
     ============================================================ */
    .rv-mnav { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
    .rv-mpick { width: 132px !important; height: 32px; padding: 0 8px; font-size: 13px; }
    .rv-bar { flex: 1; height: 7px; min-width: 54px; background: rgba(39,53,47,.10); border-radius: 999px; overflow: hidden; }
    .rv-bar > i { display: block; height: 100%; border-radius: 999px; transition: width .32s cubic-bezier(.16,1,.3,1); }
    .rv-line { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
    .rv-lb { width: 74px; flex: none; font-size: 12.5px; color: var(--ink-2); }
    .rv-num { width: 42px; flex: none; text-align: right; font-size: 12px; font-weight: 800; color: var(--text-warm); }
    .rv-sub { width: 40px; flex: none; text-align: right; font-size: 11px; color: var(--ink-3); }
    .rv-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 4px; }
    .rv-kcol { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 8px; text-align: center; }
    .rv-kcol .kv { font-size: 19px; font-weight: 800; color: var(--text-cream); }
    .rv-kcol .kv.ok { color: var(--color-success); }
    .rv-kcol .kv.no { color: var(--color-danger); }
    .rv-kcol .kl { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
    .rv-kcol .kr { font-size: 11.5px; font-weight: 700; margin-top: 3px; color: var(--ink-2); }
    .rv-watch { font-size: 12.5px; color: var(--ink-2); padding: 4px 0; }
    .rv-watch.over { color: var(--color-danger); font-weight: 700; }
    .rv-hint { font-size: 12.5px; color: var(--ink-3); background: rgba(39,53,47,.04); border-radius: var(--radius-sm); padding: 10px 12px; margin: 8px 0 2px; line-height: 1.6; }
    .rv-plat { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12.5px; color: var(--ink-2); }
    .rv-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .rv-big { font-size: 22px; font-weight: 800; color: var(--text-cream); }
    .rv-small { font-size: 12px; color: var(--ink-3); }
    @media (max-width: 900px) { .rv-two { grid-template-columns: 1fr; } .rv-mnav { width: 100%; } }
"""
h = h.replace(css_anchor, css_anchor + CSS3, 1)
print('[OK] 1/6 CSS .rv-* 段已插入')

# ============================================================
# 2. generateMonthlyReport：支持 ym 参数 + 翻月工具
# ============================================================
gen_anchor = must(h, """function generateMonthlyReport() {
    const state = getState();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
""", 'generateMonthlyReport-head')

GEN_NEW = """let _reportMonth = '';   /* '' = 当月；否则 'YYYY-MM' */
  function reportMonth() {
    if (_reportMonth && /^\\d{4}-\\d{2}$/.test(_reportMonth)) return _reportMonth;
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function reportShiftMonth(n) {
    const ym = reportMonth();
    const d = new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10) - 1 + n, 1);
    _reportMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    navTo('report-monthly');
  }
  function reportGotoMonth() {
    const el = document.getElementById('rptMonth');
    if (el && el.value) { _reportMonth = el.value; navTo('report-monthly'); }
  }
  function reportThisMonth() { _reportMonth = ''; navTo('report-monthly'); }

  function generateMonthlyReport(ym) {
    const state = getState();
    const use = ym || reportMonth();
    const year = parseInt(use.slice(0, 4), 10);
    const month = parseInt(use.slice(5, 7), 10) - 1;
"""
h = h.replace(gen_anchor, GEN_NEW, 1)
print('[OK] 2/6 generateMonthlyReport 支持翻月')

# ============================================================
# 3. renderMonthlyReport 头部：取 ym / rv / isCur
# ============================================================
ren_anchor = must(h, """function renderMonthlyReport() {
  const state = getState();
  const report = generateMonthlyReport();
  const daysInMonth = new Date(report.year, report.month, 0).getDate();
""", 'renderMonthlyReport-head')

REN_NEW = """function renderMonthlyReport() {
  const state = getState();
  const report = generateMonthlyReport();
  const daysInMonth = new Date(report.year, report.month, 0).getDate();
  const ym = report.year + '-' + String(report.month).padStart(2, '0');
  const rv = generateReviewExtras(report, state);
  const isCur = ym === utpMonth();
"""
h = h.replace(ren_anchor, REN_NEW, 1)
print('[OK] 3/6 renderMonthlyReport 已接 rv')

# ============================================================
# 4. 月报头部：翻月控件 + 复制月报
# ============================================================
head_anchor = must(h, """        <button class="btn btn-outline btn-sm" onclick="navTo('report-weekly')">查看周报 →</button>""", 'report-header-btn')

HEAD_NEW = """        <span class="rv-mnav">
          <button class="btn btn-outline btn-sm" onclick="reportShiftMonth(-1)">← 上月</button>
          <input class="input rv-mpick" type="month" id="rptMonth" value="${ym}" onchange="reportGotoMonth()">
          <button class="btn btn-outline btn-sm" onclick="reportShiftMonth(1)">下月 →</button>${isCur ? '' : '\\n          <button class="btn btn-outline btn-sm" onclick="reportThisMonth()">回到本月</button>'}
        </span>
        <button class="btn btn-outline btn-sm" onclick="reportCopyText()">📋 复制月报</button>
        <button class="btn btn-outline btn-sm" onclick="navTo('report-weekly')">查看周报 →</button>"""
h = h.replace(head_anchor, HEAD_NEW, 1)
print('[OK] 4/6 月报头部 翻月 + 复制')

# ============================================================
# 5. 月报主体：插两张卡 + 总评接 rv
# ============================================================
body_anchor = must(h, """      <!-- 月度总评 -->
      <div class="card" style="margin-top:16px;">
        <div class="card-title"><span class="title-icon">📝</span>月度总评</div>
        <div style="padding:16px;background:rgba(255, 109, 36,0.08);border-radius:var(--radius-sm);font-size:14px;line-height:1.8;color:var(--text-cream);">
          ${generateMonthlyEvaluation(report, daysInMonth)}""", 'report-body-tail')

BODY_NEW = """      <!-- 成长目标 · 新媒体（第三期复盘打通） -->
      <div class="grid grid-2" style="margin-top:16px;">
        ${rvGrowthCard(rv, isCur)}
        ${rvMediaCard(rv)}
      </div>

      <!-- 月度总评 -->
      <div class="card" style="margin-top:16px;">
        <div class="card-title"><span class="title-icon">📝</span>月度总评</div>
        <div style="padding:16px;background:rgba(255, 109, 36,0.08);border-radius:var(--radius-sm);font-size:14px;line-height:1.8;color:var(--text-cream);">
          ${generateMonthlyEvaluation(report, daysInMonth, rv)}"""
h = h.replace(body_anchor, BODY_NEW, 1)
print('[OK] 5/6 月报主体 两张新卡 + 总评接 rv')

# ============================================================
# 6a. generateMonthlyEvaluation 签名 + 追加评语
# ============================================================
eval_head = must(h, """function generateMonthlyEvaluation(report, daysInMonth) {
  const evaluations = [];
  const activeRate = (report.activeDays / daysInMonth * 100).toFixed(0);
""", 'eval-head')
h = h.replace(eval_head, """function generateMonthlyEvaluation(report, daysInMonth, rv) {
  const evaluations = [];
  const activeRate = (report.activeDays / daysInMonth * 100).toFixed(0);
""", 1)

eval_tail = must(h, """  if (report.bestDay) {
    evaluations.push(`🏆 最佳表现日：${formatDate(report.bestDay.date)}，获得 ${report.bestDay.coinsEarned} 金币！`);
  }

  return evaluations.join('\\n\\n');
}""", 'eval-tail')

EVAL_TAIL_NEW = """  if (report.bestDay) {
    evaluations.push(`🏆 最佳表现日：${formatDate(report.bestDay.date)}，获得 ${report.bestDay.coinsEarned} 金币！`);
  }

  /* ---- 第三期：成长 + 新媒体汇入总评 ---- */
  if (rv) {
    const g = rv.growth;
    if (g.total) {
      let gTxt = `🌱 成长目标：共 ${g.total} 条（完成 ${g.done} / 在途 ${g.open}），平均进度 ${g.avg}%。`;
      if (g.overdue.length) gTxt += `有 ${g.overdue.length} 条已过截止日，得抓紧收口。`;
      else if (g.soon.length) gTxt += `有 ${g.soon.length} 条本月到期，注意排期。`;
      else gTxt += '节奏稳，没有逾期目标。';
      evaluations.push(gTxt);
    }
    const m = rv.media;
    if (m.published || m.hasKpi || m.inFlight) {
      const seg = [];
      if (m.published) seg.push(`发布 ${m.published} 条内容`);
      if (m.inFlight) seg.push(`在制 ${m.inFlight} 条`);
      if (m.hasKpi) {
        seg.push(`留资 ${m.lyA}/${m.lyT}（${m.lyRate == null ? '未设目标' : m.lyRate + '%'}）`);
        seg.push(`增粉 ${m.zfA}/${m.zfT}（${m.zfRate == null ? '未设目标' : m.zfRate + '%'}）`);
      }
      let mTxt = `📣 新媒体：${seg.join('，')}。`;
      if (m.hasKpi && m.lyRate != null && m.lyRate < 100) mTxt += '留资没打满，下月把信息流素材再压一压。';
      else if (m.hasKpi && m.lyRate != null && m.lyRate >= 100) mTxt += '留资达标，这套打法可以固化成 SOP。';
      evaluations.push(mTxt);
    }
  }

  return evaluations.join('\\n\\n');
}"""
h = h.replace(eval_tail, EVAL_TAIL_NEW, 1)
print('[OK] 6a/6 总评已接 rv 并追加成长/新媒体评语')

# ============================================================
# 6b. 主 script 尾部注入第三期函数
# ============================================================
js_anchor = must(h, """  window.utpKpiPrefill = utpKpiPrefill; window.utpKpiSave = utpKpiSave; window.utpKpiDel = utpKpiDel;""", 'phase2-window-exports')

JS3 = r"""
  /* ============================================================
     utopia 移植 · 第三期：复盘打通
     成长目标 + 新媒体绩效 汇入【挖矿月报】
     ============================================================ */
  const RV_DIR_COLORS = ['#FF6D24', '#27A973', '#8A7BE8', '#E8A33D'];

  function rvDirColor(dir) {
    const i = GROW_DIRS.indexOf(dir);
    return RV_DIR_COLORS[i >= 0 ? i : 0];
  }
  function rvBar(pct, color) {
    const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    return '<div class="rv-bar"><i style="width:' + p + '%;background:' + (color || 'var(--gold)') + '"></i></div>';
  }
  function rvRate(a, t) { return t > 0 ? Math.round(a / t * 100) : null; }

  /* 聚合月报所需的成长 / 新媒体数据 */
  function generateReviewExtras(report, state) {
    const ym = report.year + '-' + String(report.month).padStart(2, '0');
    const today = todayStr();
    const start = report.startDate, end = report.endDate;

    /* --- 成长目标（无月度历史，取当前快照） --- */
    const goals = state.growth || [];
    const doneG = goals.filter(function (g) { return g.done; });
    const openG = goals.filter(function (g) { return !g.done; });
    const avg = goals.length
      ? Math.round(goals.reduce(function (a, g) { return a + Math.max(0, Math.min(100, g.pct || 0)); }, 0) / goals.length)
      : 0;
    const soon = openG.filter(function (g) { return g.due && g.due >= today && g.due <= end; });
    const overdue = openG.filter(function (g) { return g.due && g.due < today; });
    const dueInMonth = goals.filter(function (g) { return g.due && g.due >= start && g.due <= end; });
    const dirs = GROW_DIRS.map(function (d) {
      const arr = goals.filter(function (g) { return (g.dir || '其他') === d; });
      const pct = arr.length
        ? Math.round(arr.reduce(function (a, g) { return a + Math.max(0, Math.min(100, g.pct || 0)); }, 0) / arr.length)
        : 0;
      return { dir: d, pct: pct, n: arr.length, done: arr.filter(function (g) { return g.done; }).length };
    });

    /* --- 新媒体 --- */
    const items = (state.media && state.media.items) || [];
    const published = items.filter(function (i) {
      return i.stage === '已发布' && i.pub && i.pub >= start && i.pub <= end;
    });
    const inFlight = items.filter(function (i) { return i.stage === '已采用' || i.stage === '制作中'; });
    const platCount = {};
    published.forEach(function (i) { platCount[i.plat] = (platCount[i.plat] || 0) + 1; });
    const kpiRec = ((state.media && state.media.kpi) || []).find(function (k) { return k.month === ym; });
    const lyT = (kpiRec && kpiRec.lyT) || 0, lyA = (kpiRec && kpiRec.lyA) || 0;
    const zfT = (kpiRec && kpiRec.zfT) || 0, zfA = (kpiRec && kpiRec.zfA) || 0;

    return {
      ym: ym,
      growth: {
        total: goals.length, done: doneG.length, open: openG.length, avg: avg,
        soon: soon, overdue: overdue, dueInMonth: dueInMonth.length, dirs: dirs,
      },
      media: {
        published: published.length, inFlight: inFlight.length, platCount: platCount,
        hasKpi: !!kpiRec, lyT: lyT, lyA: lyA, zfT: zfT, zfA: zfA,
        lyRate: rvRate(lyA, lyT), zfRate: rvRate(zfA, zfT),
        mark: (kpiRec && kpiRec.mark) || '',
      },
    };
  }

  /* ---- 卡 1：成长目标月报 ---- */
  function rvGrowthCard(rv, isCur) {
    const g = rv.growth;
    const head = '<div class="utp-card-head"><span class="utp-card-title">🌱 成长目标</span>' +
      '<span class="utp-note">四曲线进度 · ' + (isCur ? '本月快照' : '当前快照（成长无月度存档）') + '</span></div>';

    if (!g.total) {
      return '<div class="utp-card">' + head +
        '<div class="rv-hint">还没有成长目标。去「成长目标」页加几条，月报这里就会自动汇总四条曲线的进度。</div></div>';
    }

    const stats = '<div class="rv-two">' +
      '<div class="rv-kcol"><div class="kv">' + g.total + '</div><div class="kl">目标总数</div></div>' +
      '<div class="rv-kcol"><div class="kv ' + (g.done ? 'ok' : '') + '">' + g.done + '</div><div class="kl">已完成</div></div>' +
      '</div>' +
      '<div class="rv-two">' +
      '<div class="rv-kcol"><div class="kv">' + g.open + '</div><div class="kl">在途</div></div>' +
      '<div class="rv-kcol"><div class="kv ' + (g.avg >= 100 ? 'ok' : (g.overdue.length ? 'no' : '')) + '">' + g.avg + '%</div><div class="kl">平均进度</div></div>' +
      '</div>';

    const lines = g.dirs.map(function (d) {
      return '<div class="rv-line"><span class="rv-lb">' + utpEsc(d.dir) + '</span>' + rvBar(d.pct, rvDirColor(d.dir)) +
        '<span class="rv-num">' + d.pct + '%</span><span class="rv-sub">' + d.done + '/' + d.n + '</span></div>';
    }).join('');

    let watch = '';
    const items = g.overdue.concat(g.soon).slice(0, 6);
    if (items.length) {
      watch = '<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:8px">' +
        items.map(function (x) {
          const over = x.due < todayStr();
          return '<div class="rv-watch' + (over ? ' over' : '') + '">' + (over ? '⚠️ 已逾期 ' : '⏳ 临近 ') +
            utpEsc(x.name) + ' · <b>' + x.due + '</b></div>';
        }).join('') + '</div>';
    } else {
      watch = '<div class="rv-hint" style="margin-top:10px">✅ 没有逾期目标，成长节奏稳。</div>';
    }

    return '<div class="utp-card">' + head + stats +
      '<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:8px">' + lines + '</div>' +
      watch + '</div>';
  }

  /* ---- 卡 2：新媒体月报 ---- */
  function rvMediaCard(rv) {
    const m = rv.media;
    const platRows = MEDIA_PLATFORMS.map(function (p) {
      const n = m.platCount[p.n] || 0;
      return '<div class="rv-plat"><i class="rv-dot" style="background:' + p.color + '"></i>' +
        '<span style="flex:1">' + utpEsc(p.n) + '</span>' +
        '<b style="color:' + (n ? p.color : 'var(--ink-3)') + '">' + n + ' 条</b></div>';
    }).join('');

    const kpi = m.hasKpi
      ? '<div class="rv-two">' +
        '<div class="rv-kcol"><div class="kv ' + (m.lyRate != null ? (m.lyRate >= 100 ? 'ok' : 'no') : '') + '">' + m.lyA + '/' + m.lyT + '</div>' +
        '<div class="kl">留资 实际/目标</div><div class="kr">' + (m.lyRate == null ? '未设目标' : '达成 ' + m.lyRate + '%') + '</div></div>' +
        '<div class="rv-kcol"><div class="kv ' + (m.zfRate != null ? (m.zfRate >= 100 ? 'ok' : 'no') : '') + '">' + m.zfA + '/' + m.zfT + '</div>' +
        '<div class="kl">增粉 实际/目标</div><div class="kr">' + (m.zfRate == null ? '未设目标' : '达成 ' + m.zfRate + '%') + '</div></div>' +
        '</div>' +
        (m.mark ? '<div class="rv-watch">📝 ' + utpEsc(m.mark) + '</div>' : '')
      : '<div class="rv-hint">本月还没填绩效。去「新媒体工作台 → 本月绩效」补上留资 / 增粉目标与实际，月报会自动算达成率。</div>';

    return '<div class="utp-card">' +
      '<div class="utp-card-head"><span class="utp-card-title">📣 新媒体</span>' +
      '<span class="utp-note">本月发布 ' + m.published + ' 条 · 在制 ' + m.inFlight + ' 条</span></div>' +
      kpi +
      '<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:8px">' +
      '<div class="rv-small" style="margin-bottom:4px">本月发布分布（按计划发布日归月）</div>' + platRows + '</div></div>';
  }

  /* ---- 一键复制月报（纯文本，方便贴进汇报） ---- */
  function reportCopyText() {
    const state = getState();
    const report = generateMonthlyReport();
    const daysInMonth = new Date(report.year, report.month, 0).getDate();
    const rv = generateReviewExtras(report, state);
    const L = [];
    L.push('【挖矿月报】' + report.year + ' 年 ' + report.month + ' 月（' + report.startDate + ' ~ ' + report.endDate + '）');
    L.push('');
    L.push('■ 挖矿：' + report.totalCoinsEarned + ' 金币 · ' + report.totalTasksCompleted + ' 个任务 · 活跃 ' + report.activeDays + '/' + daysInMonth + ' 天');
    L.push('■ 热量：摄入 ' + report.totalCaloriesIn + ' / 消耗 ' + report.totalCaloriesOut + ' kcal · 净缺口 ' + (report.totalCaloriesOut - report.totalCaloriesIn) + ' kcal');
    L.push('■ 消费：¥' + report.totalExpense.toFixed(2) + ' · 日均 ¥' + (report.totalExpense / daysInMonth).toFixed(2));
    if (rv.growth.total) {
      L.push('■ 成长：' + rv.growth.total + ' 条目标 · 完成 ' + rv.growth.done + ' · 平均进度 ' + rv.growth.avg + '%' +
        (rv.growth.overdue.length ? ' · 逾期 ' + rv.growth.overdue.length + ' 条' : ''));
    }
    if (rv.media.published || rv.media.hasKpi || rv.media.inFlight) {
      const seg = ['发布 ' + rv.media.published + ' 条', '在制 ' + rv.media.inFlight + ' 条'];
      if (rv.media.hasKpi) {
        seg.push('留资 ' + rv.media.lyA + '/' + rv.media.lyT + (rv.media.lyRate == null ? '' : '（' + rv.media.lyRate + '%）'));
        seg.push('增粉 ' + rv.media.zfA + '/' + rv.media.zfT + (rv.media.zfRate == null ? '' : '（' + rv.media.zfRate + '%）'));
      }
      L.push('■ 新媒体：' + seg.join(' · '));
    }
    L.push('');
    L.push('【月度总评】');
    L.push(generateMonthlyEvaluation(report, daysInMonth, rv));
    const text = L.join('\n');

    const done = function () { showToast('月报文字已复制，可直接粘进汇报', 'success'); };
    const fail = function () {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) { showToast('复制失败，可手动选中月报内容', 'warning'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else { fail(); }
  }

  window.generateReviewExtras = generateReviewExtras;
  window.reportMonth = reportMonth;
  window.reportShiftMonth = reportShiftMonth;
  window.reportGotoMonth = reportGotoMonth;
  window.reportThisMonth = reportThisMonth;
  window.reportCopyText = reportCopyText;
"""
h = h.replace(js_anchor, js_anchor + JS3, 1)
print('[OK] 6b/6 第三期 JS 函数已注入')

# ============================================================
# 7. 逐块语法自检（浏览器视角抽 script 块，绕开非贪婪正则的假验证）
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
        tag = html[s:gt + 1]
        if 'src=' in tag:
            pos = gt + 1
            continue
        e = html.find('</script>', gt)
        if e < 0:
            break
        blocks.append(html[gt + 1:e])
        pos = e + len('</script>')
    return blocks

blocks = extract_scripts(h)
print('[..] 抽到 %d 个内联 script 块，逐个 node --check' % len(blocks))
ok = True
for idx, b in enumerate(blocks):
    if not b.strip():
        continue
    tmp = os.path.join(ROOT, '_chk_p3_%d.js' % idx)
    io.open(tmp, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    if r.returncode != 0:
        ok = False
        print('[FAIL] script 块 #%d (%d 字符) 语法错：' % (idx, len(b)))
        print((r.stderr or '').strip()[:1500])
    else:
        print('[OK] script 块 #%d (%d 字符) 通过' % (idx, len(b)))
    os.remove(tmp)
if not ok:
    die('语法自检未通过，文件未写入（备份在 %s）' % os.path.basename(BAK))

# ============================================================
# 8. 写出
# ============================================================
io.open(HTML, 'w', encoding='utf-8').write(h)
print('')
print('[DONE] 写入 %s' % os.path.basename(HTML))
print('       字符 %d -> %d（+%d）' % (orig_len, len(h), len(h) - orig_len))
print('       字节 %d' % os.path.getsize(HTML))
