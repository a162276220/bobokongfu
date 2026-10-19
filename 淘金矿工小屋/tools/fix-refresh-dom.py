# -*- coding: utf-8 -*-
"""
淘金矿工小屋 · 修复 renderXxx() 不刷新 DOM 的缺陷

问题（实测确认）：
  renderDashboard() / renderPlanner() / renderGrowth() / renderMedia() 是**纯字符串函数**，
  只 return HTML，不写 DOM。文件里大量 `saveState(); renderDashboard();` 的写法
  **完全不会刷新界面** —— 数据进了 state，但用户看到的还是旧画面。
  影响：加/勾/删待办、加计划、成长目标操作、新媒体操作，界面均无反应（第一期起就存在）。

修法（铁律 9：统一刷新入口）：
  新增 refreshPage(page) —— 刷新指定页；不传则刷新当前页。
  把「动作函数里的 renderXxx() 裸调用」统一替换为 refreshPage('xxx')。
  注意：renderXxx() 作为 **PAGE_RENDERERS 里的渲染器** 或 **被 refreshPage 内部调用** 时不动。

改前备份：_backup-pre-refreshfix.html
"""
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
BAK = os.path.join(ROOT, '_backup-pre-refreshfix.html')


def die(m):
    print('[FAIL] ' + m)
    sys.exit(1)


h = io.open(HTML, encoding='utf-8').read()
orig = len(h)
shutil.copyfile(HTML, BAK)
print('[OK] 备份 -> %s' % os.path.basename(BAK))

# ------------------------------------------------------------
# 1. 注入 refreshPage 工具（放在 awardDailyHours 之前，供全模块使用）
# ------------------------------------------------------------
anchor = """  /* 每日奖励：同一模块一天只给一次时辰，防止加一条完成一条地刷 */"""
if h.count(anchor) != 1:
    die('refreshPage 注入锚点不唯一')

REFRESH = """  /* 统一刷新入口（铁律 9）：renderXxx() 只返回字符串，必须经此写回 DOM。
     传 page 刷新指定页；不传则刷新当前页。渲染函数之间禁止互调，一律走这里。 */
  function refreshPage(page) {
    const target = page || window.currentPage || 'dashboard';
    navTo(target);
  }
  window.refreshPage = refreshPage;

"""
h = h.replace(anchor, REFRESH + anchor, 1)
print('[OK] 1/2 refreshPage 已注入')

# ------------------------------------------------------------
# 2. 把动作函数里的裸 renderXxx() 调用改为 refreshPage('xxx')
#    只改「语句位置」的调用（前面是 ; 或 { 或行首缩进），不碰 PAGE_RENDERERS 与 return/箭头
# ------------------------------------------------------------
# 映射：函数名 -> 页面 key
PAGE_OF = {
    'renderDashboard': 'dashboard',
    'renderPlanner': 'planner',
    'renderGrowth': 'growth',
    'renderMedia': 'media',
}

# 需要排除的上下文（渲染器注册、箭头函数、window 导出、refreshPage 内部）
lines = h.split('\n')
changed = {k: 0 for k in PAGE_OF}
skip_pat = re.compile(r'PAGE_RENDERERS|=>|window\.|function render\w+\(|refreshPage|pageDiv\.innerHTML|renderer\(')

for idx, ln in enumerate(lines):
    if skip_pat.search(ln):
        continue
    for fn, page in PAGE_OF.items():
        # 语句形态：可选 `saveState(); ` 前缀 + fn() + 结尾
        pat = re.compile(r'(?<![\w.])' + fn + r'\(\);')
        if pat.search(ln):
            lines[idx] = pat.sub("refreshPage('%s');" % page, lines[idx])
            changed[fn] += 1

h = '\n'.join(lines)
for fn, n in changed.items():
    print('     %s -> refreshPage(%r)  %d 处' % (fn, PAGE_OF[fn], n))
total = sum(changed.values())
if total == 0:
    die('没有替换到任何裸调用，锚点逻辑需复核')
print('[OK] 2/2 裸 renderXxx() 调用已替换 %d 处' % total)

# ------------------------------------------------------------
# 3. 校验：确认 renderXxx 仍作为渲染器存在（没被误改）
# ------------------------------------------------------------
for fn, page in PAGE_OF.items():
    if ("'%s':" % page) not in h and ('"%s":' % page) not in h:
        die('页面注册丢失: ' + page)
print('[OK] 3/3 渲染器注册完好')

# ------------------------------------------------------------
# 4. 语法自检
# ------------------------------------------------------------
def extract_scripts(html):
    out, pos = [], 0
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
        out.append(html[gt + 1:e])
        pos = e + len('</script>')
    return out


ok = True
for i, b in enumerate(extract_scripts(h)):
    if not b.strip():
        continue
    tmp = os.path.join(ROOT, '_chk_rf_%d.js' % i)
    io.open(tmp, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    print(('[OK] ' if r.returncode == 0 else '[FAIL] ') + 'script 块 #%d (%d 字符)' % (i, len(b)))
    if r.returncode != 0:
        ok = False
        print((r.stderr or '')[:1000])
    os.remove(tmp)
if not ok:
    die('语法自检未通过，未写入')

io.open(HTML, 'w', encoding='utf-8').write(h)
print('\n[DONE] 写入 %s  字符 %d -> %d（+%d）' % (os.path.basename(HTML), orig, len(h), len(h) - orig))
