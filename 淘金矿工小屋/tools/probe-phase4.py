# -*- coding: utf-8 -*-
"""第四期回归：异源叠加日历 + 当日任务进程 + 待办拖拽。
用法: python tools/probe-phase4.py
"""
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
PROBE = os.path.join(ROOT, '_p4_probe.html')
SHOT = os.path.join(ROOT, '_p4_shot.html')
PNG = os.path.join(ROOT, '_shot4-planner.png')
PROFILE = os.path.join(ROOT, '_p4_profile')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

SEED = r"""
function __seed() {
  var s = getState();
  var t = todayStr();
  /* 今天：四源齐活 */
  s.plans = [
    { id: 'pl1', date: t, text: '晚 8 点剪课程片', cat: '本职进阶', note: '', span: '单日', done: false, demo: false },
    { id: 'pl2', date: t, text: '整理本周素材', cat: '副业打造', note: '挑 3 个钩子', span: '3 日内', done: false, demo: false },
    { id: 'pl3', date: t, text: '晨间复盘', cat: '学习成长', note: '', span: '单日', done: true, demo: false, doneAt: new Date().toISOString() }
  ];
  s.todos = [
    { id: 'td1', text: '回学员作业', q: 1, due: t, done: false, demo: false },
    { id: 'td2', text: '写季度总结', q: 2, due: t, done: false, demo: false },
    { id: 'td3', text: '看行业报告', q: 3, due: '2020-01-01', done: false, demo: false },
    { id: 'td4', text: '已完成的事', q: 4, due: t, done: true, demo: false }
  ];
  s.growth = [
    { id: 'g1', dir: '自媒体打造', name: '小红书日更 21 天', pct: 65, due: t, action: '', done: false, demo: false }
  ];
  s.media = { items: [
    { id: 'm1', date: t, plat: '视频号', title: '本周课程回顾', pub: t, src: '', note: '', stage: '制作中', demo: false }
  ], kpi: [] };
  s.body = s.body || { records: [] };
  s.body.records = [ { id: 'b1', date: t, weight: 128.5, bodyfat: 22, dayType: '训练日', diet: '标准健康饮食', periodDay: true, training: '', note: '' } ];
  s.lay = null;
  saveState();
  return t;
}
"""

TESTS = r"""
function __run() {
  var out = [], errs = [];
  window.addEventListener('error', function (e) { errs.push(String(e.message) + ' @' + e.lineno); });
  function log(s) { out.push(s); }
  try {
    var t = __seed();

    /* 1. 全页面导航 */
    var pages = Object.keys(PAGE_RENDERERS), bad = [];
    pages.forEach(function (k) {
      try { navTo(k);
        var mc = document.getElementById('mainContent');
        if (!mc || mc.innerHTML.length < 20) bad.push(k + '(empty)');
      } catch (e) { bad.push(k + '(' + e.message + ')'); }
    });
    log('PAGES ' + (pages.length - bad.length) + '/' + pages.length + (bad.length ? ' BAD=' + bad.join(',') : ''));

    /* 2. planner 渲染 + 异源标记 */
    navTo('planner');
    var h = document.getElementById('mainContent').innerHTML;
    log('PLANNER_LEN ' + h.length);
    log('LEGEND ' + (h.indexOf('p4-legend') >= 0 && h.indexOf('待办截止') >= 0 && h.indexOf('成长截止') >= 0 && h.indexOf('经期') >= 0 && h.indexOf('在制内容') >= 0));
    log('DAY_PANE ' + (h.indexOf('p4-days') >= 0 && h.indexOf('任务进程') >= 0));
    var mkCount = (h.match(/p4-mk/g) || []).length;
    log('CAL_DOTS ' + mkCount + ' (>=' + '5 ' + (mkCount >= 5) + ')');
    log('P4_CLASS ' + (h.indexOf('p4-col') >= 0 && h.indexOf('p4-lg') >= 0));

    /* 3. 当日全集数值 */
    var s = getState();
    var items = p4DayItems(s, t, t);
    var byK = {};
    items.forEach(function (x) { byK[x.k] = (byK[x.k] || 0) + 1; });
    log('DAY_ITEMS total=' + items.length + ' ' + JSON.stringify(byK));
    log('DAY_HAS_PLAN ' + (byK.plan === 3));
    log('DAY_HAS_TODO ' + (byK.todo === 3));
    log('DAY_HAS_GROW ' + (byK.grow === 1));
    log('DAY_HAS_MEDIA ' + (byK.media === 1));
    log('DAY_HAS_PERIOD ' + (byK.period === 1));

    /* 4. 图例开关 */
    p4Toggle('media');
    var after1 = p4DayItems(getState(), t, t).filter(function (x) { return x.k === 'media'; }).length;
    log('TOGGLE_OFF_MEDIA ' + (after1 === 0));
    var layMedia = getState().lay.media;
    log('TOGGLE_STATE_FALSE ' + (layMedia === false));
    var h2 = document.getElementById('mainContent').innerHTML;
    log('LEGEND_OFF_CLASS ' + (h2.indexOf('p4-lg off') >= 0));
    p4Toggle('media');
    var after2 = p4DayItems(getState(), t, t).filter(function (x) { return x.k === 'media'; }).length;
    log('TOGGLE_ON_MEDIA ' + (after2 === 1));
    log('TOGGLE_STATE_TRUE ' + (getState().lay.media === true));

    /* 5. 拖拽分诊：td2 从 q2 拖到 q1 */
    var before = (getState().todos || []).find(function (x) { return x.id === 'td2'; }).q;
    p4DragStart({ dataTransfer: { setData: function () {}, effectAllowed: '' }, target: null }, 'td2');
    p4DropOn({ preventDefault: function () {}, dataTransfer: { getData: function () { return ''; } } }, 1);
    var afterQ = (getState().todos || []).find(function (x) { return x.id === 'td2'; }).q;
    log('DRAG ' + before + '->' + afterQ + ' ok=' + (before === 2 && afterQ === 1));
    var planHtml2 = document.getElementById('mainContent').innerHTML;
    log('DRAG_RERENDER_PLANNER ' + (planHtml2.indexOf('p4-legend') >= 0 && planHtml2.indexOf('p4-days') >= 0));
    navTo('dashboard');
    var dashAfter = document.getElementById('mainContent').innerHTML;
    log('DRAG_ON_DASH ' + (dashAfter.indexOf('quad-cell') >= 0));
    var q1Items = (getState().todos || []).filter(function (x) { return x.q === 1 && !x.done; }).length;
    log('DRAG_Q1_COUNT ' + (q1Items === 2));
    navTo('planner');

    /* 6. 拖到同格不应改动 */
    p4DragStart({ dataTransfer: { setData: function () {}, effectAllowed: '' }, target: null }, 'td2');
    p4DropOn({ preventDefault: function () {}, dataTransfer: { getData: function () { return ''; } } }, 1);
    log('DRAG_SAME ' + ((getState().todos || []).find(function (x) { return x.id === 'td2'; }).q === 1 && _p4DragId === null));

    /* 7. 旧功能未回归 */
    var d0 = (navTo('dashboard'), document.getElementById('mainContent').innerHTML);
    log('DASH_OK ' + (d0.indexOf('quad-cell') >= 0 && d0.indexOf('focus-card') >= 0));
    var g0 = (navTo('growth'), document.getElementById('mainContent').innerHTML);
    log('GROWTH_OK ' + (g0.indexOf('utp-ring') >= 0));
    var m0 = (navTo('media'), document.getElementById('mainContent').innerHTML);
    log('MEDIA_OK ' + (m0.indexOf('utp-pipe') >= 0));
    var r0 = (navTo('report-monthly'), document.getElementById('mainContent').innerHTML);
    log('MONTHLY_OK ' + (r0.indexOf('rv-line') >= 0 && r0.indexOf('rptMonth') >= 0));
    log('LEGACY jianghu=' + (typeof Jianghu.render) + ' renderPlanner=' + (typeof renderPlanner) + ' togglePlan=' + (typeof togglePlan) + ' toggleTodo=' + (typeof toggleTodo));

    log('ERRORS ' + errs.length + (errs.length ? ' :: ' + errs.join(' ;; ') : ''));
  } catch (e) {
    log('FATAL ' + e.message + ' | ' + String(e.stack || '').split('\n')[1]);
    log('ERRORS ' + errs.length);
  }
  var d = document.createElement('div');
  d.id = 'probeout';
  d.setAttribute('data-p4', out.join('\n'));
  document.body.appendChild(d);
}
"""

SHOTJS = r"""
function __shot() {
  __seed();
  navTo('planner');
  window.scrollTo(0, 0);
  var d = document.createElement('div');
  d.id = 'probeout'; d.setAttribute('data-p4', 'READY');
  document.body.appendChild(d);
}
"""


def main():
    src = io.open(SRC, encoding='utf-8').read()
    tail = '\n<script>\n' + SEED + TESTS + '\nwindow.addEventListener("load", function(){ setTimeout(__run, 500); });\n</script>\n'
    i = src.rfind('</body>')
    io.open(PROBE, 'w', encoding='utf-8').write(src[:i] + tail + src[i:])
    shutil.rmtree(PROFILE, ignore_errors=True)
    url = 'file:///' + PROBE.replace('\\', '/')
    r = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                        '--user-data-dir=' + PROFILE, '--allow-file-access-from-files',
                        '--dump-dom', '--virtual-time-budget=12000', url],
                       capture_output=True, text=True, timeout=180)
    dom = r.stdout or ''
    m = re.search(r'data-p4="([^"]*)"', dom)
    print('=' * 62)
    if not m:
        print('[FAIL] 无 probeout，dom 长度 %d' % len(dom))
        print(dom[:600])
        return 1
    txt = m.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(txt)
    print('=' * 62)
    fails = []
    for ln in txt.split('\n'):
        if ln.startswith('ERRORS') and not ln.startswith('ERRORS 0'):
            fails.append(ln)
        if 'BAD=' in ln or ln.startswith('FATAL'):
            fails.append(ln)
        if ln.startswith(('LEGEND', 'DAY_PANE', 'P4_CLASS', 'DAY_HAS_', 'TOGGLE_', 'DRAG')):
            if not ln.rstrip().endswith(('True', 'true')):
                fails.append(ln)
        if ln.startswith('PAGES') and not re.match(r'PAGES (\d+)/\1(\s|$)', ln):
            fails.append(ln)
    print('[%s] %s' % ('PASS' if not fails else 'FAIL', '全绿' if not fails else '失败: ' + ' | '.join(fails)))

    io.open(SHOT, 'w', encoding='utf-8').write(
        src[:i] + '\n<script>\n' + SEED + SHOTJS + '\nwindow.addEventListener("load", function(){ setTimeout(__shot, 600); });\n</script>\n' + src[i:])
    shutil.rmtree(PROFILE, ignore_errors=True)
    if os.path.exists(PNG):
        os.remove(PNG)
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                    '--user-data-dir=' + PROFILE, '--allow-file-access-from-files',
                    '--screenshot=' + PNG, '--window-size=1440,1350', '--hide-scrollbars',
                    '--virtual-time-budget=9000', 'file:///' + SHOT.replace('\\', '/')],
                   capture_output=True, text=True, timeout=180)
    print('[%s] 截图 %s' % ('OK' if os.path.exists(PNG) else 'WARN', os.path.basename(PNG)))
    shutil.rmtree(PROFILE, ignore_errors=True)
    for f in (PROBE, SHOT):
        if os.path.exists(f):
            os.remove(f)
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())