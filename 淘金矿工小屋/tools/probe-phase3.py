# -*- coding: utf-8 -*-
"""第三期回归：注入探针 -> 无头 Chrome 跑一遍 -> 抽结果 + 出截图。
用法: python tools/probe-phase3.py
"""
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
PROBE_HTML = os.path.join(ROOT, '_p3_probe.html')
SHOT_HTML = os.path.join(ROOT, '_p3_shot.html')
SHOT_PNG = os.path.join(ROOT, '_shot3-monthly.png')
PROFILE = os.path.join(ROOT, '_p3_profile')

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

# ---------------- 播种 + 断言 ----------------
SEED = r"""
function __p3seed() {
  var s = getState();
  var ym = utpMonth();
  var y = ym.slice(0, 4), m = ym.slice(5, 7);
  s.growth = [
    { id: 'g1', dir: '本职进阶',   name: 'Q4 项目准时交付 100%',   pct: 40,  due: y + '-' + m + '-25', action: '完成 2 个里程碑', done: false, demo: false },
    { id: 'g2', dir: '自媒体打造', name: '小红书稳定日更 21 天',   pct: 65,  due: y + '-' + m + '-30', action: '发 5 条选题',    done: false, demo: false },
    { id: 'g3', dir: '自由剪辑',   name: '剪辑模板攒到 10 套',     pct: 100, due: y + '-' + m + '-10', action: '',               done: true,  demo: false },
    { id: 'g4', dir: '自由教练',   name: '拿到 3 个长期客户',      pct: 10,  due: '2020-01-01',       action: '',               done: false, demo: false }
  ];
  s.media = {
    items: [
      { id: 'm1', date: y + '-' + m + '-03', plat: '抖音官方号', title: '家长最关心的 5 个问题', pub: y + '-' + m + '-05', src: '热点检索·榜单第1', note: '', stage: '已发布', demo: false },
      { id: 'm2', date: y + '-' + m + '-04', plat: '抖音个人号', title: '新手避坑清单',         pub: y + '-' + m + '-06', src: '', note: '', stage: '已发布', demo: false },
      { id: 'm3', date: y + '-' + m + '-05', plat: '视频号',     title: '本周课程回顾',         pub: y + '-' + m + '-07', src: '', note: '', stage: '已发布', demo: false },
      { id: 'm4', date: y + '-' + m + '-08', plat: '小红书',     title: '学员名场面混剪',       pub: '',                  src: '', note: '', stage: '制作中', demo: false },
      { id: 'm5', date: y + '-' + m + '-09', plat: '小红书',     title: '第一课作业讲评',       pub: '',                  src: '', note: '', stage: '已采用', demo: false }
    ],
    kpi: [ { month: ym, lyT: 50, lyA: 32, zfT: 1000, zfA: 640, mark: '信息流 A 素材跑量最好' } ]
  };
  saveState();
  return ym;
}
"""

TESTS = r"""
function __p3run() {
  var out = [], errs = [];
  window.addEventListener('error', function (e) { errs.push(String(e.message) + ' @' + e.lineno); });
  function log(s) { out.push(s); }

  try {
    var ym = __p3seed();
    log('SEED_YM ' + ym);

    /* 1. 全页面导航 */
    var pages = Object.keys(PAGE_RENDERERS);
    var bad = [];
    pages.forEach(function (k) {
      try {
        navTo(k);
        var mc = document.getElementById('mainContent');
        if (!mc || mc.innerHTML.length < 20) bad.push(k + '(empty)');
      } catch (e) { bad.push(k + '(' + e.message + ')'); }
    });
    log('PAGES ' + (pages.length - bad.length) + '/' + pages.length + (bad.length ? ' BAD=' + bad.join(',') : ''));

    /* 2. 月报渲染 */
    navTo('report-monthly');
    var html = document.getElementById('mainContent').innerHTML;
    log('MONTHLY_LEN ' + html.length);
    log('CARD_GROWTH ' + (html.indexOf('rv-line') >= 0 && html.indexOf('成长目标') >= 0));
    log('CARD_MEDIA ' + (html.indexOf('rv-plat') >= 0 && html.indexOf('新媒体') >= 0));
    log('GROWTH_STATS ' + (html.indexOf('目标总数') >= 0 && html.indexOf('平均进度') >= 0));
    log('MEDIA_KPI ' + (html.indexOf('留资 实际/目标') >= 0 && html.indexOf('增粉 实际/目标') >= 0));
    log('MONTH_NAV ' + (html.indexOf('rptMonth') >= 0 && html.indexOf('reportShiftMonth') >= 0 && html.indexOf('reportGotoMonth') >= 0));
    log('COPY_BTN ' + (html.indexOf('reportCopyText') >= 0));
    log('OVERDUE_SHOWN ' + (html.indexOf('已逾期') >= 0));

    /* 3. extras 数值 */
    var st = getState(), rep = generateMonthlyReport(), rv = generateReviewExtras(rep, st);
    log('RV_GROWTH total=' + rv.growth.total + ' done=' + rv.growth.done + ' open=' + rv.growth.open + ' avg=' + rv.growth.avg + ' overdue=' + rv.growth.overdue.length + ' soon=' + rv.growth.soon.length);
    log('RV_DIRS ' + rv.growth.dirs.map(function (d) { return d.dir + ':' + d.pct + '(' + d.done + '/' + d.n + ')'; }).join(' | '));
    log('RV_MEDIA pub=' + rv.media.published + ' inflight=' + rv.media.inFlight + ' hasKpi=' + rv.media.hasKpi + ' ly=' + rv.media.lyA + '/' + rv.media.lyT + '(' + rv.media.lyRate + '%) zf=' + rv.media.zfA + '/' + rv.media.zfT + '(' + rv.media.zfRate + '%)');
    log('RV_PLAT ' + JSON.stringify(rv.media.platCount));

    /* 4. 翻月 */
    var cur = reportMonth();
    reportShiftMonth(-1);
    var prev = reportMonth();
    var h2 = document.getElementById('mainContent').innerHTML;
    log('SHIFT ' + cur + ' -> ' + prev + ' ok=' + (prev < cur));
    log('PAST_BACKBTN ' + (h2.indexOf('回到本月') >= 0));
    log('PAST_KPI_HINT ' + (h2.indexOf('本月还没填绩效') >= 0));
    log('PAST_NO_KPI_RATE ' + (h2.indexOf('达成 ') < 0));
    reportShiftMonth(1);
    log('SHIFT_FWD_BACK ' + (reportMonth() === cur));
    var h3 = document.getElementById('mainContent').innerHTML;
    log('CUR_NO_BACKBTN ' + (h3.indexOf('回到本月') < 0));
    reportThisMonth();
    log('THIS_MONTH ' + (reportMonth() === cur));

    /* 5. 总评带成长 / 新媒体 */
    var ev = generateMonthlyEvaluation(rep, new Date(rep.year, rep.month, 0).getDate(), rv);
    log('EVAL_GROWTH ' + (ev.indexOf('成长目标') >= 0));
    log('EVAL_MEDIA ' + (ev.indexOf('新媒体') >= 0));
    log('EVAL_RATE ' + (ev.indexOf('64%') >= 0));

    /* 6. 复制月报不抛错 */
    var threw = 'no';
    try { reportCopyText(); } catch (e) { threw = e.message; }
    log('COPY_NO_THROW ' + (threw === 'no' ? 'yes' : threw));

    /* 7. 旧功能未回归 */
    log('STATE growth=' + (st.growth || []).length + ' mediaItems=' + ((st.media && st.media.items) || []).length + ' kpi=' + ((st.media && st.media.kpi) || []).length);
    log('LEGACY navTo=' + (typeof navTo) + ' renderPlanner=' + (typeof renderPlanner) + ' renderDashboard=' + (typeof renderDashboard) + ' renderGrowth=' + (typeof renderGrowth) + ' renderMedia=' + (typeof renderMedia));
    log('LEGACY jianghu=' + (typeof Jianghu.render) + ' utpKpiSave=' + (typeof window.utpKpiSave));
    var dashHtml = (navTo('dashboard'), document.getElementById('mainContent').innerHTML);
    log('DASH_FOCUS_QUAD ' + (dashHtml.indexOf('quad-cell') >= 0 && dashHtml.indexOf('focus-card') >= 0));
    var planHtml = (navTo('planner'), document.getElementById('mainContent').innerHTML);
    log('PLANNER_CAL ' + (planHtml.indexOf('cal-grid') >= 0));
    var growHtml = (navTo('growth'), document.getElementById('mainContent').innerHTML);
    log('GROWTH_RING ' + (growHtml.indexOf('utp-ring') >= 0));
    var medHtml = (navTo('media'), document.getElementById('mainContent').innerHTML);
    log('MEDIA_PIPE ' + (medHtml.indexOf('utp-pipe') >= 0 && medHtml.indexOf('utp-kpi') >= 0));

    log('ERRORS ' + errs.length + (errs.length ? ' :: ' + errs.join(' ;; ') : ''));
  } catch (e) {
    log('FATAL ' + e.message + ' | ' + String(e.stack || '').split('\n')[1]);
    log('ERRORS ' + errs.length);
  }

  var d = document.createElement('div');
  d.id = 'probeout';
  d.setAttribute('data-p3', out.join('\n'));
  document.body.appendChild(d);
  document.title = 'P3DONE';
}
"""

SHOT = r"""
function __p3shot() {
  __p3seed();
  navTo('report-monthly');
  window.scrollTo(0, 0);
  var d = document.createElement('div');
  d.id = 'probeout';
  d.setAttribute('data-p3', 'SHOT_READY');
  document.body.appendChild(d);
}
"""


def inject(html, extra):
    tail = '\n<script data-p3-probe>\n' + extra + '\n</script>\n'
    i = html.rfind('</body>')
    if i < 0:
        i = len(html)
    return html[:i] + tail + html[i:]


def run_chrome(url, extra_args):
    cmd = [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
           '--user-data-dir=' + PROFILE, '--allow-file-access-from-files'] + extra_args + [url]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=180)


def main():
    src = io.open(SRC, encoding='utf-8').read()

    # ---- 探针 ----
    io.open(PROBE_HTML, 'w', encoding='utf-8').write(
        inject(src, SEED + TESTS + '\nwindow.addEventListener("load", function(){ setTimeout(__p3run, 500); });\n'))
    if os.path.isdir(PROFILE):
        shutil.rmtree(PROFILE, ignore_errors=True)

    url = 'file:///' + PROBE_HTML.replace('\\', '/').replace(' ', '%20')
    r = run_chrome(url, ['--dump-dom', '--virtual-time-budget=12000'])
    dom = r.stdout or ''
    if not dom:
        print('[WARN] dump-dom 空，重跑一次')
        r = run_chrome(url, ['--dump-dom', '--virtual-time-budget=16000'])
        dom = r.stdout or ''

    m = re.search(r'data-p3="([^"]*)"', dom)
    print('=' * 62)
    if not m:
        print('[FAIL] 没拿到 probeout；dom 长度=%d' % len(dom))
        print(dom[:800])
        return 1
    lines = m.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(lines)
    print('=' * 62)

    fails = []
    for ln in lines.split('\n'):
        if ln.startswith('ERRORS') and not ln.startswith('ERRORS 0'):
            fails.append(ln)
        if 'BAD=' in ln or ln.startswith('FATAL'):
            fails.append(ln)
        if ln.startswith(('CARD_', 'MONTH_NAV', 'COPY_BTN', 'GROWTH_STATS', 'MEDIA_KPI', 'OVERDUE_SHOWN',
                          'PAST_BACKBTN', 'PAST_KPI_HINT', 'PAST_NO_KPI_RATE', 'EVAL_', 'DASH_', 'PLANNER_',
                          'GROWTH_RING', 'MEDIA_PIPE', 'COPY_NO_THROW')):
            if not ln.rstrip().endswith(('True', 'true', 'yes')):
                fails.append(ln)
        if ln.startswith('PAGES') and not re.match(r'PAGES (\d+)/\1(\s|$)', ln):
            fails.append(ln)

    print('[%s] 断言 %s' % ('PASS' if not fails else 'FAIL',
                            '全绿' if not fails else ('失败 ' + str(len(fails)) + ' 项: ' + ' | '.join(fails))))

    # ---- 截图 ----
    io.open(SHOT_HTML, 'w', encoding='utf-8').write(
        inject(src, SEED + SHOT + '\nwindow.addEventListener("load", function(){ setTimeout(__p3shot, 600); });\n'))
    if os.path.exists(SHOT_PNG):
        os.remove(SHOT_PNG)
    shutil.rmtree(PROFILE, ignore_errors=True)
    url2 = 'file:///' + SHOT_HTML.replace('\\', '/').replace(' ', '%20')
    r2 = run_chrome(url2, ['--screenshot=' + SHOT_PNG, '--window-size=1440,1500',
                           '--hide-scrollbars', '--virtual-time-budget=9000'])
    if os.path.exists(SHOT_PNG):
        print('[OK] 截图 %s (%d 字节)' % (os.path.basename(SHOT_PNG), os.path.getsize(SHOT_PNG)))
    else:
        print('[WARN] 截图失败：%s' % (r2.stderr or '')[:300])

    # ---- 清理 ----
    shutil.rmtree(PROFILE, ignore_errors=True)
    for f in (PROBE_HTML, SHOT_HTML):
        if os.path.exists(f):
            os.remove(f)
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
