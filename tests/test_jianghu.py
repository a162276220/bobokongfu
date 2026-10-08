"""江湖（工作台里的文字武侠）的接线与内容体检。

引擎与内容数据是纯 JS，所以真正的规则试跑交给 tests/jianghu-harness.mjs：
它把两个模块装进 vm 沙箱，冒充宿主 API，穷举每一条奇遇分支与每一场切磋。
这里负责沙箱够不着的两件事：
  1. 内容/引擎自身的问题清单必须为空；
  2. 工作台 HTML 真的把「江湖」页签、存档字段、打卡产出都接上了 —— 页签是
     手写的正则匹配，改坏任何一个字符串字面量都会让它悄悄消失。
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / '淘金矿工小屋'
WORKBENCH = APP / '淘金矿工小屋·自律工作台.html'
CONTENT = APP / 'wuxia-content.js'
ENGINE = APP / 'jianghu.js'
HARNESS = ROOT / 'tests' / 'jianghu-harness.mjs'


@pytest.fixture(scope='module')
def html():
    return WORKBENCH.read_text(encoding='utf-8')


@pytest.fixture(scope='module')
def engine_src():
    return ENGINE.read_text(encoding='utf-8')


@pytest.fixture(scope='module')
def report():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not on PATH')
    proc = subprocess.run([node, str(HARNESS)], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:2000]
    return json.loads(proc.stdout)


def test_the_wuxia_modules_parse_as_javascript():
    """这两个文件都带中文与 emoji，注释里一个 */ 就能把后半段变成语法错误。"""
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not on PATH')
    for path in (CONTENT, ENGINE):
        proc = subprocess.run([node, '--check', str(path)], capture_output=True, text=True)
        assert proc.returncode == 0, (path.name, proc.stderr[:400])


def test_the_engine_leaves_nothing_broken(report):
    assert report['engineProblems'] == [], '\n'.join(report['engineProblems'])


def test_the_content_data_cross_references_cleanly(report):
    assert report['contentProblems'] == [], '\n'.join(report['contentProblems'])


def test_the_content_is_big_enough_to_be_a_game(report):
    got = report['coverage']
    assert got['events'] >= 15, got
    assert got['duels'] >= 5, got
    assert got['skills'] >= 3, got
    # 每条分支都该被强制走到过，否则罕见分支里的坏数据要等运气才暴露
    assert got['outcomes'] == report['engineChecks']['outcomeTexts'], got


def test_the_growth_curve_reaches_the_top_and_battles_have_stakes(report):
    checks = report['engineChecks']
    assert checks['realms'] >= 4, checks
    duels = checks['duels']
    assert duels['masterWins'] == duels['master'] > 0, duels
    assert duels['beginnerLosses'] > 0, duels
    assert duels['maxRounds'] >= 3, duels


def test_gear_table_is_valid(report):
    """装备表自己也要经得起交叉引用 —— 它现在只摆在数据层，引擎还没接。"""
    assert report['contentProblems'] == [], '\n'.join(report['contentProblems'])


def test_gear_table_shape(report):
    gear = report['coverage']['gear']
    assert gear['total'] == 24
    assert gear['general'] == 12
    assert gear['sect'] == 12
    assert gear['slots'] == ['armor', 'boots', 'charm', 'weapon']


# ---------- 工作台接线 ----------

def test_the_workbench_loads_both_modules(html):
    for src in ('wuxia-content.js', 'jianghu.js'):
        assert '<script src="%s"></script>' % src in html, src
    # 引擎要在主脚本之前就位：主脚本一上来就 initApp()，页签渲染会找 Jianghu
    loader = html.index('<script src="jianghu.js">')
    main = html.index('const STORAGE_KEY')
    assert loader < main


def test_the_jianghu_tab_is_wired_into_the_router(html):
    assert re.search(r"\{ key: 'jianghu',.*?\}", html), 'NAV_CONFIG 里没有江湖'
    assert re.search(r"'jianghu':\s*\(\)\s*=>\s*Jianghu\.render\(\)", html), '路由没有渲染器'
    assert re.search(r"'jianghu'\s*:\s*'江湖", html), '标题表里没有江湖'


def test_every_nav_entry_has_a_renderer_and_a_title(html):
    """页签是手写清单，漏一项就会点开看到“页面开发中”。"""
    keys = set(re.findall(r"\{ key: '([\w-]+)'", html))
    assert 'jianghu' in keys, keys
    renderers = set(re.findall(r"'([\w-]+)':\s*\(\)\s*=>", html))
    titles = set(re.findall(r"'([\w-]+)':\s*'[^']*'", html.split('const PAGE_TITLES')[1].split('};')[0]))
    assert keys <= renderers, sorted(keys - renderers)
    assert keys <= titles, sorted(keys - titles)


def test_checkin_buys_cultivation_time(html):
    body = html.split('function claimTaskCoins')[1].split('\n  }')[0]
    assert 'Jianghu.earnHours(taskKey' in body, '打卡没有换成修炼时辰'
    assert body.index('Jianghu.earnHours') > body.index('addCoins('), \
        '时辰应在金币落袋之后再给，失败路径不该产出'


def test_the_task_hours_table_matches_the_real_mine_tracks(html):
    tasks = set(re.findall(r'(\w+):\s*\{ name:', html.split('const TASK_CONFIG')[1].split('};')[0]))
    hours = set(re.findall(r'(\w+):\s*\d+', CONTENT.read_text(encoding='utf-8')
                           .split('var TASK_HOURS')[1].split('};')[0]))
    assert tasks, '台账配置读不出来'
    assert hours <= tasks, sorted(hours - tasks)
    assert tasks <= hours, sorted(tasks - hours)


def test_the_default_state_covers_every_field_the_engine_touches(html):
    """ensureFields 只补一层，引擎引用到而 defaultState 漏写的字段会是 undefined。"""
    top = _top_level_keys(_jianghu_default(html))
    used = set(re.findall(r'\bj\.([A-Za-z]\w*)', ENGINE.read_text(encoding='utf-8')))
    assert used, '引擎里没抓到状态字段，正则失效了'
    assert used <= top, sorted(used - top)
    assert top <= used, sorted(top - used)


def test_the_default_state_stats_are_the_four_weixin_attrs(html):
    stats = re.search(r'stats:\s*\{([^}]*)\}', _jianghu_default(html)).group(1)
    keys = set(re.findall(r'(\w+):', stats))
    content_stats = set(re.findall(r"(\w+):\s*'[^']+'",
                                   CONTENT.read_text(encoding='utf-8').split('var STATS')[1].split('};')[0]))
    assert keys == content_stats, (sorted(keys), sorted(content_stats))
    assert all(int(v) > 0 for v in re.findall(r':\s*(\d+)', stats)), '初始属性必须为正'


def test_every_adoptable_pet_has_a_jianghu_role(html, report):
    """商城能领养的宠物，江湖里都得有位置；反之伙伴加成不能指向不存在的图集。"""
    sellers = set(re.findall(r"petId: '([\w-]+)'", html))
    built = {path.parent.name for path in (ROOT / 'pet').glob('*/pet.json')}
    block = CONTENT.read_text(encoding='utf-8').split('byId: {')[1].split('\n    },')[0]
    bonuses = set(re.findall(r"'([\w-]+)':\s*\{ label:", block))
    assert sellers == built, (sorted(sellers ^ built))
    assert bonuses == built, '江湖伙伴名单与图鉴脱节: %s' % sorted(bonuses ^ built)


def _top_level_keys(block):
    """去掉嵌套对象后剩下的那层键名 —— ensureFields 只会补到这一层。"""
    inner = block
    while re.search(r'\{[^{}]+\}', inner):
        inner = re.sub(r'\{[^{}]+\}', '{}', inner)
    return set(re.findall(r'(\w+):', inner))


def _jianghu_default(html):
    """截出 defaultState() 里 jianghu 的那个对象字面量（含嵌套花括号）。"""
    start = html.index('{', html.index('jianghu:', html.index('function defaultState')))
    depth, i = 0, start
    while True:
        if html[i] == '{':
            depth += 1
        elif html[i] == '}':
            depth -= 1
            if depth == 0:
                return html[start:i + 1]
        i += 1
