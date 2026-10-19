# -*- coding: utf-8 -*-
"""
动作函数覆盖度检查（DOM 刷新矩阵的守门人）。

作用：扫描主文件里所有「会被 onclick/onchange/onsubmit 等事件触发的动作函数」，
与 tools/probe-domrefresh.py 矩阵里的用例做差集，报告哪些动作函数还没进矩阵。

为什么需要它：
    probe-domrefresh.py 是「新增动作函数后必须补一条用例」这条约定的执行者。
    但人总会忘。这个脚本把「忘了」变成一条明确的 FAIL，让 CI / 提交前检查能拦住。

用法：
    python tools/check-action-coverage.py          # 报告缺口，有缺口 exit 1
    python tools/check-action-coverage.py --list   # 顺便列出已覆盖的

退出码：0 = 全覆盖；1 = 有未覆盖的动作函数。
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, '淘金矿工小屋·自律工作台.html')
PROBE = os.path.join(ROOT, 'tools', 'probe-domrefresh.py')

# ── 白名单：这些 handler 不需要进 DOM 刷新矩阵 ──────────────────────────────
# 分类说明：
#   1) 导航/框架类：只切页面或开关 UI，不改数据，本身不是「动作」
#   2) 纯工具类：DOM 原生 API、事件对象方法、模态框开关
#   3) 环境依赖类：依赖同步层/网络/剪贴板，无头环境无法稳定验证
#   4) 已被其他用例间接覆盖：通过串联调用验证（如 generateXhsContent 在 saveXhsProject 用例里）
EXEMPT = {
    # 1) 导航 / 框架
    'navTo', 'toggleSidebar', 'closeSidebar', 'closeModal',
    'toggleSetting',          # 已覆盖（在矩阵里）
    # 2) 纯工具 / 原生 API / 事件方法
    'getElementById', 'click', 'if', 'stopPropagation', 'showToast',
    'esc', 'iconHtml', 'iconText', 'dateStr', 'todayStr', 'formatTime',
    # 3) 环境依赖：同步层 / 网络 / 剪贴板 / 整页重载
    'saveApiConfig',          # 依赖 window.gmSetApi，保存后会 location.reload()
    'clearApiToken',          # 依赖 window.gmSetApi
    'testApiConfig',          # 依赖 window.gmApiProbe，发起网络请求
    'exportWorkbenchData',    # 触发文件下载
    'importWorkbenchData',    # 触发文件选择器
    'confirmReset',           # 弹确认框，真正动作是 resetAllData
    'resetAllData',           # 会清空 localStorage，测试里不能真跑
    # 4) 其他已间接覆盖 / 纯展示
    'selectAccCategory',      # 已覆盖（在矩阵里）
    'revealWord',             # 已覆盖（在矩阵里）
    'setAccType',             # 已覆盖（在矩阵里）
    'changeVideo',            # 已覆盖（在矩阵里）
    'utpKpiPrefill',          # 纯表单回填，不改 state、不重渲染（由 utpKpiSave 覆盖写入路径）
    'checkAchievements',      # 被 claimTask / buyShopItem 等内部调用，非独立入口
    'showAddCoinsModal',      # 弹窗展示，真正动作是 adjustCoins（已覆盖）
    'showPetNamingModal',     # 弹窗展示，真正动作是 confirmAdoptPet（已覆盖）
    'viewAmazonNote',         # 已覆盖（在矩阵里）
    'viewXhsProject',         # 已覆盖（在矩阵里）
    'reportGotoMonth',        # 已覆盖（在矩阵里）
    'reportCopyText',         # 已覆盖（在矩阵里）
    'manualGenerateReport',   # 已覆盖（在矩阵里）
    # 拖拽辅助回调：只在拖拽过程中切换 hover 高亮 class（.p4-drop），不碰数据、不重渲染。
    # 真正的落点动作 p4DropOn（改象限）已在矩阵里覆盖。
    'p4DragStart', 'p4DragEnd', 'p4Allow', 'p4Leave',
}

# 事件属性前缀：这些属性里的函数调用属于「用户触发的动作」
EVENT_ATTRS = ('onclick', 'onchange', 'onsubmit', 'oninput', 'onkeydown',
               'ondragstart', 'ondragend', 'ondragover', 'ondrop', 'ondragleave')


def extract_handlers(html):
    """抽取所有事件属性里被调用的函数名。"""
    names = set()
    for attr in EVENT_ATTRS:
        # 抓 onxxx="..." 里的函数调用
        for m in re.finditer(attr + r'="([^"]*)"', html):
            body = m.group(1)
            for fm in re.finditer(r'([A-Za-z_$][\w$]*)\s*\(', body):
                names.add(fm.group(1))
    return names


def extract_defined_functions(html):
    """抽取主文件里所有 function xxx( 定义的函数名。"""
    return set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(', html))


def extract_probe_cases(probe_src):
    """抽取矩阵里的用例名，去掉参数部分（__case('addTodo' → addTodo）。"""
    cases = set()
    for m in re.finditer(r"__case\(\s*'([^']+)'", probe_src):
        raw = m.group(1)
        # 'adjustCoins(+5)' → adjustCoins ; 'moveTodo(上)' → moveTodo
        base = re.sub(r'\(.*$', '', raw).strip()
        cases.add(base)
    return cases


def main():
    show_list = '--list' in sys.argv

    if not os.path.exists(MAIN):
        print('[FAIL] 找不到主文件：%s' % MAIN)
        return 1
    if not os.path.exists(PROBE):
        print('[FAIL] 找不到矩阵脚本：%s' % PROBE)
        return 1

    html = io.open(MAIN, encoding='utf-8').read()
    probe_src = io.open(PROBE, encoding='utf-8').read()

    handlers = extract_handlers(html)
    defined = extract_defined_functions(html)
    cases = extract_probe_cases(probe_src)

    # 只关心「既是事件入口、又真的定义在文件里」的函数
    actionable = sorted(handlers & defined)
    # 减去豁免项与已覆盖项
    uncovered = [f for f in actionable if f not in EXEMPT and f not in cases]

    print('=' * 74)
    print('动作函数覆盖度检查')
    print('=' * 74)
    print('  事件入口函数总数 : %d' % len(actionable))
    print('  矩阵已覆盖       : %d' % len([f for f in actionable if f in cases]))
    print('  豁免（导航/工具/环境依赖）: %d' % len([f for f in actionable if f in EXEMPT and f not in cases]))
    print('  未覆盖           : %d' % len(uncovered))
    print('-' * 74)

    if show_list:
        print('  已覆盖：')
        for f in sorted(actionable):
            if f in cases:
                print('    ✅ %s' % f)
        print('  豁免：')
        for f in sorted(actionable):
            if f in EXEMPT and f not in cases:
                print('    ➖ %s' % f)
        print('-' * 74)

    if uncovered:
        print()
        print('  ❌ 以下动作函数是事件入口，但既不在矩阵里、也不在豁免名单里：')
        for f in uncovered:
            print('     - %s' % f)
        print()
        print('  处理方式（二选一）：')
        print('    1) 在 tools/probe-domrefresh.py 里补一条 __case(\'%s\', ...)' % (uncovered[0] if uncovered else 'xxx'))
        print('    2) 若它确实不需要 DOM 刷新断言（纯导航/工具/环境依赖），')
        print('       把它加进本脚本的 EXEMPT 集合并写明原因。')
        print()
        print('[FAIL] 有 %d 个动作函数未覆盖' % len(uncovered))
        return 1

    print('  ✅ 全部动作函数已覆盖或已豁免')
    print('=' * 74)
    return 0


if __name__ == '__main__':
    sys.exit(main())
