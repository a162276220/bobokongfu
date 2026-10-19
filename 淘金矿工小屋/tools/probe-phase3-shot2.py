# -*- coding: utf-8 -*-
"""第三期：再出一张能看见「成长目标 / 新媒体」两张新卡的截图。
额外播种「每日报表」让月报上半部分（金币/热量/消费）也有数据，画面更真实。
"""
import io
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
HTML = os.path.join(ROOT, '_p3_shot2.html')
PNG = os.path.join(ROOT, '_shot3-review.png')
PROFILE = os.path.join(ROOT, '_p3_profile2')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

SEED = r"""
function __seed() {
  var s = getState();
  var ym = utpMonth();
  var y = ym.slice(0, 4), m = ym.slice(5, 7);
  var last = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();

  /* 每日报表：让月报上半部分有数据 */
  s.reports = s.reports || { daily: [], weekly: [] };
  s.reports.daily = [];
  for (var d = 1; d <= Math.min(last, 16); d++) {
    var ds = y + '-' + m + '-' + String(d).padStart(2, '0');
    var on = (d % 7 !== 0);
    s.reports.daily.push({
      date: ds,
      coinsEarned: on ? 18 + (d % 5) * 6 : 0,
      tasksCompleted: on ? 3 + (d % 3) : 0,
      caloriesIn: on ? 1750 + (d % 4) * 60 : 0,
      caloriesOut: on ? 2050 + (d % 5) * 70 : 0,
      totalExpense: on ? 60 + (d % 6) * 25 : 0,
      expenseCount: on ? 2 + (d % 3) : 0
    });
  }

  s.growth = [
    { id: 'g1', dir: '本职进阶',   name: 'Q4 项目准时交付 100%', pct: 40,  due: y + '-' + m + '-25', action: '完成 2 个里程碑', done: false, demo: false },
    { id: 'g2', dir: '自媒体打造', name: '小红书稳定日更 21 天', pct: 65,  due: y + '-' + m + '-30', action: '发 5 条选题',    done: false, demo: false },
    { id: 'g3', dir: '自由剪辑',   name: '剪辑模板攒到 10 套',   pct: 100, due: y + '-' + m + '-10', action: '',               done: true,  demo: false },
    { id: 'g4', dir: '自由教练',   name: '拿到 3 个长期客户',    pct: 10,  due: '2020-01-01',       action: '',               done: false, demo: false }
  ];
  s.media = {
    items: [
      { id: 'm1', date: y + '-' + m + '-03', plat: '抖音官方号', title: '家长最关心的 5 个问题', pub: y + '-' + m + '-05', src: '热点检索·榜单第1', note: '', stage: '已发布', demo: false },
      { id: 'm2', date: y + '-' + m + '-04', plat: '抖音个人号', title: '新手避坑清单',         pub: y + '-' + m + '-06', src: '', note: '', stage: '已发布', demo: false },
      { id: 'm3', date: y + '-' + m + '-05', plat: '视频号',     title: '本周课程回顾',         pub: y + '-' + m + '-07', src: '', note: '', stage: '已发布', demo: false },
      { id: 'm4', date: y + '-' + m + '-08', plat: '小红书',     title: '学员名场面混剪',       pub: '',                  src: '', note: '', stage: '制作中', demo: false },
      { id: 'm5', date: y + '-' + m + '-09', plat: '小红书',     title: '第一课作业讲评',       pub: '',                  src: '', note: '', stage: '已采用', demo: false }
    ],
    kpi: [ { month: ym, lyT: 50, lyA: 32, zfT: 1000, zfA: 640, mark: '信息流 A 素材跑量最好，下月按这个结构再铺 3 条' } ]
  };
  saveState();
}

function __shot() {
  __seed();
  navTo('report-monthly');
  /* 滚到「成长目标 / 新媒体」两张新卡 */
  var cards = document.querySelectorAll('#mainContent .utp-card');
  if (cards.length) cards[0].scrollIntoView({ block: 'start' });
  var d = document.createElement('div');
  d.id = 'probeout'; d.setAttribute('data-p3', 'READY');
  document.body.appendChild(d);
}
"""


def main():
    src = io.open(SRC, encoding='utf-8').read()
    tail = '\n<script>\n' + SEED + '\nwindow.addEventListener("load", function(){ setTimeout(__shot, 600); });\n</script>\n'
    i = src.rfind('</body>')
    io.open(HTML, 'w', encoding='utf-8').write(src[:i] + tail + src[i:])

    shutil.rmtree(PROFILE, ignore_errors=True)
    if os.path.exists(PNG):
        os.remove(PNG)
    url = 'file:///' + HTML.replace('\\', '/')
    r = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                        '--user-data-dir=' + PROFILE, '--allow-file-access-from-files',
                        '--screenshot=' + PNG, '--window-size=1440,1250',
                        '--hide-scrollbars', '--virtual-time-budget=9000', url],
                       capture_output=True, text=True, timeout=180)
    ok = os.path.exists(PNG)
    print('[%s] %s' % ('OK' if ok else 'WARN', PNG if ok else (r.stderr or '')[:400]))
    shutil.rmtree(PROFILE, ignore_errors=True)
    if os.path.exists(HTML):
        os.remove(HTML)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
