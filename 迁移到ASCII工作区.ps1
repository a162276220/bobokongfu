# ============================================================
# 迁移 D:\桌宠 -> D:\desktop-pet 并重建 git 基线
# 在本机 PowerShell（非 DSH 沙箱）运行，避开中文目录 grantWrite 问题
# 用法：右键「使用 PowerShell 运行」，或复制到本机后 .\迁移到ASCII工作区.ps1
# ============================================================
$ErrorActionPreference = 'Stop'

$src = 'D:\桌宠'
$dst = 'D:\desktop-pet'

# 安全阀：目标不存在或为空才继续，防止覆盖已有数据
if (Test-Path $dst) {
  $first = Get-ChildItem $dst -Force -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($first) {
    Write-Error "目标 $dst 已存在且非空，为防误覆盖已中止。清空后重跑。"
    exit 1
  }
}

Write-Host "步骤 1/4：复制 $src -> $dst（robocopy）"
robocopy $src $dst /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH
if ($LASTEXITCODE -ge 8) {
  Write-Error "robocopy 失败，退出码 $LASTEXITCODE"
  exit 1
}

Write-Host "步骤 2/4：git init"
Set-Location $dst
git init
git symbolic-ref HEAD refs/heads/master

Write-Host "步骤 3/4：配置提交身份"
git config user.name "a162276220"
git config user.email "80498191+a162276220@users.noreply.github.com"

Write-Host "步骤 4/4：首次提交基线"
git add -A
git commit -m "chore: baseline from D:\桌宠"

Write-Host ""
Write-Host "完成。新工作区：$dst"
Write-Host "请在宿主把该会话的工作区根目录改为 $dst 后继续。"
