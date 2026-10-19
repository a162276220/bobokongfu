#!/usr/bin/env bash
# 淘金矿工小屋 · 前端改动后的必跑闸门
#
# 用法：
#   bash tools/run-gate.sh
#
# 串行跑三道检查，任一失败即整体失败（exit 1）：
#   1) 覆盖度检查   —— 确认每个事件入口动作函数都在矩阵里（或已豁免）
#   2) DOM 刷新矩阵 —— 确认每个动作「改了状态就一定刷新界面」（58 个用例）
#   3) 第四期回归   —— 确认任务进程总览与旧功能没被改坏
#
# 改完前端（尤其新增动作函数）后跑这个；全绿再 build-dist。
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PY="C:/Users/HUAWEI/.workbuddy/binaries/python/versions/3.13.12/python.exe"
[ -x "$PY" ] || PY="python"

fail=0

echo "############################################################"
echo "# 1/3  动作函数覆盖度检查"
echo "############################################################"
"$PY" tools/check-action-coverage.py || fail=1
echo

echo "############################################################"
echo "# 2/3  全站 DOM 刷新矩阵"
echo "############################################################"
out=$("$PY" tools/probe-domrefresh.py 2>&1)
echo "$out" | grep -E "FAIL|WARN|SKIP|汇总|ERRORS"
if echo "$out" | grep -qE "FAIL=[1-9]"; then
  echo "  => 矩阵有失败项"
  fail=1
fi
echo

echo "############################################################"
echo "# 3/3  第四期回归（任务进程总览 + 旧功能）"
echo "############################################################"
out2=$("$PY" tools/probe-phase4.py 2>&1)
echo "$out2" | tail -8
if ! echo "$out2" | grep -q "\[PASS\] 全绿"; then
  echo "  => 回归未全绿"
  fail=1
fi
echo

echo "############################################################"
if [ "$fail" -eq 0 ]; then
  echo "# ✅ 三道闸门全绿，可以 build-dist 了"
  echo "############################################################"
  exit 0
else
  echo "# ❌ 有检查未通过，先修再 build-dist"
  echo "############################################################"
  exit 1
fi
