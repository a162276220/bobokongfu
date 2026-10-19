"""云端账号改造的 pytest 入口：把 node 套件包成仓库统一入口能跑的闸门。

沙箱注意（本机实测）：这个环境禁止「捕获子进程输出的管道」——`subprocess.run(..., capture_output=True)`
会以 WinError 5 失败（工具说明里写明的边界）。所以这里把子进程 stdout 重定向到**文件**再读回。
不要把它改成管道。
"""

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp'
NODE = shutil.which('node')


def run_node(script):
    """跑一个 node 套件，返回 (returncode, 输出文本)。输出走文件重定向，不走管道。"""
    if not NODE:
        pytest.skip('node is not on PATH')
    OUT.mkdir(exist_ok=True)
    log = OUT / (Path(script).stem + '.log')
    with log.open('w', encoding='utf-8') as handle:
        proc = subprocess.run([NODE, str(ROOT / script)], stdout=handle,
                              stderr=subprocess.STDOUT)
    return proc.returncode, log.read_text(encoding='utf-8')


def test_data_plane_selftest_passes():
    """数据面契约：同一组断言在内存假库、SQLite 适配器与 D1 适配器上各跑一遍。"""
    code, out = run_node('goldminer-hut/tools/selftest.mjs')
    assert code == 0, out[-2000:]
    assert '全部通过' in out


def test_cloud_accounts_suite_passes():
    """迁移、账号、会话、邀请码、Worker 路由与跨账号隔离。"""
    code, out = run_node('tests/goldminer-cloud-harness.mjs')
    assert code == 0, out[-2000:]
    assert '全部通过' in out


def test_devserver_smoke_passes():
    """本地开发服务器：起真进程、走真 HTTP，验浏览器要走的那条路。"""
    code, out = run_node('tests/goldminer-devserver-smoke.mjs')
    assert code == 0, out[-2000:]
    assert '全部通过' in out


def test_frontend_sync_layer_passes():
    """前端同步层：数据面地址解析、双模式鉴权、登录序列、轮询策略。"""
    code, out = run_node('tests/goldminer-sync-harness.mjs')
    assert code == 0, out[-2000:]
    assert '全部通过' in out
