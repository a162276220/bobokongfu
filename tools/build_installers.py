from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE_ROOT = ROOT / 'release' / '胡胡-Windows-10-11'
BS = chr(92)
EDITION = 'huhu-carrot-v1'
PET_IDS = ('huhu-carrot', 'huhu-carrot-office')
VALUE_LINE = 'selected-avatar-id = "custom:huhu-carrot-office"'

VERSION_TXT = '''Package: Huhu Windows
Version: 1
System: Windows 10/11
Architecture: x64 + ARM64
Pets: huhu-carrot (frames2d), huhu-carrot-office (sprite2d v1 compat)
'''
EDITION_TXT = 'edition=' + EDITION + chr(10)

README_MD = '# ' + '''胡胡桌宠（Huhu Carrot Desk Pet）

两只桌宠，同一个角色，两个宿主：

- huhu-carrot —— frames2d 帧序列宠物，清单 v2，供 DSH 宠物中心使用。
- huhu-carrot-office —— sprite2d 兼容宠物，扁平 v1 清单，供 Codex 使用。

## 安装

1. 双击运行 安装胡胡.cmd。
2. 按提示先关闭 DSH 与 Codex。**宠物注册表在宿主启动时一次性构建，不重启不会生效。**
3. 安装器会把两只宠物放进 %CODEX_HOME% 的 pets 目录；未设置 %CODEX_HOME% 时用 %USERPROFILE% 下的 .codex 目录。
4. 重启 DSH 或 Codex，在设置的宠物列表里选择「胡胡」。

安装器会尝试在 config.toml 的 [desktop] 段写入：

    selected-avatar-id = "custom:huhu-carrot-office"

写入前先备份成 config.toml.huhu-时间戳.bak。如果该键已存在别的值，安装器保留原值不动，只在日志里提示。

## 卸载

双击运行 卸载胡胡-Windows.cmd。它删除 pets 下的两只宠物，并在该键确实指向胡胡时把 config.toml 还原到最近的 huhu 备份。

## 自动化与静默安装

- 安装胡胡.cmd 接一个目标 pets 目录参数时，跳过 %CODEX_HOME% 推导，直接装到该目录。
- 设置环境变量 HUHU_YES 为 1 时，跳过「请关闭宿主」的暂停提示。

## 行为

待机呼吸、眨眼（周期约 3.2 到 3.9 秒）、单击摸头气泡、左键拖动换位、七个会话状态各自的动画、随机台词气泡。引擎没有悬停、双击、右键与拖动方向钩子，这些行为不做。

## 台词

每只宠物目录里的 voice.json 覆盖引擎内置台词池；pet.json 的 remarks 块覆盖摸头与喂食槽位。

## 说明

角色资产来自用户提供的一张实拍图，衍生资产仅供个人使用。见 ASSET-NOTICE.md。
'''

ASSET_NOTICE_MD = '''# 资产与许可声明（ASSET-NOTICE）

## 角色资产

本项目的美术角色来自**用户提供的一张实拍图**（一只胡萝卜造型的毛绒玩偶）。

- 由该实拍图程序化衍生的所有资产（抠图、帧序列、图集、预览图）均为本项目的生成物。
- 这些衍生资产**仅供个人使用**。请不要公开分发、售卖或用于商业用途。
- 本项目不包含任何第三方代码、字体、贴图或音效。

## 宠物引擎

宠物运行依赖 @linxin666/dsh-pet，许可为 **Apache-2.0**。

- 本项目不修改该引擎的源码。
- 本项目不分发该引擎，也不把它打进发布包。发布包只包含清单、帧资产、台词与安装脚本。
- 引擎的运行由宿主的安装提供，用户需自行确保 DSH 或 Codex 已装好。

## 清单里的来源声明

frames2d 清单 pet/huhu-carrot/pet.json 是清单 v2，携带 author 与 license 字段，license 值为 User-supplied source; personal use only。

sprite2d 清单 pet/huhu-carrot-office/pet.json 刻意走扁平 v1 结构以兼容 Codex，该结构没有 author 与 license 字段，因此来源声明只能落在本文件里。这是刻意的取舍，不是遗漏。
'''


def write_text(name, content):
    path = RELEASE_ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    return path


def build_docs():
    return [write_text('VERSION.txt', VERSION_TXT),
            write_text('HUHU-EDITION.txt', EDITION_TXT),
            write_text('README.md', README_MD),
            write_text('ASSET-NOTICE.md', ASSET_NOTICE_MD)]


INSTALL_CMD = '''@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "PKG_DIR=%~dp0"
if "%~1"=="" (
    if defined CODEX_HOME (
        set "PET_DIR=%CODEX_HOME%@BS@pets"
    ) else (
        set "PET_DIR=%USERPROFILE%@BS@.codex@BS@pets"
    )
) else (
    set "PET_DIR=%~1"
)

REM %date% is locale dependent: on a YYYY/MM/DD machine ~0,8 yields
REM 2026/09/ (no day, and with slashes) which landed inside the backup
REM FILENAME and made Copy-Item fail. Get-Date is locale independent.
set "TS=manual"
for /f "delims=" %%T in ('powershell -NoProfile -NoLogo -Command "Get-Date -Format yyyyMMddHHmmss"') do set "TS=%%T"
set "LOG_DIR=%LOCALAPPDATA%@BS@HuhuPet"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG=%LOG_DIR%@BS@huhu-install-!TS!.log"
echo [%date% %time%] install start package=%PKG_DIR% pets=%PET_DIR% > "%LOG%"

REM stage 1: refuse to run from a directory that is not a huhu release
if not exist "%PKG_DIR%HUHU-EDITION.txt" (
    echo [ERROR] HUHU-EDITION.txt is missing; this is not a huhu release package. >> "%LOG%"
    echo [ERROR] HUHU-EDITION.txt is missing; aborting.
    exit /b 1
)
findstr /C:"edition=huhu-carrot-v1" "%PKG_DIR%HUHU-EDITION.txt" >nul
if errorlevel 1 (
    echo [ERROR] HUHU-EDITION.txt does not declare edition=huhu-carrot-v1. >> "%LOG%"
    echo [ERROR] unsupported package edition; aborting.
    exit /b 1
)

REM stage 2: the pet registry is built once when the host starts
if not defined HUHU_YES (
    echo.
    echo Please close DSH and Codex before continuing.
    echo The pet registry is built once at host startup, so a restart is required.
    echo.
    pause
)

REM stage 3: stage into a hidden temp dir, verify the staged copy, then rename
call :install_pet huhu-carrot
if errorlevel 1 exit /b 1
call :install_pet huhu-carrot-office
if errorlevel 1 exit /b 1

REM stage 4: point the desktop pet selector at the codex-compatible pet.
REM Inlined instead of call :write_config: calling a label that sits right
REM after another label's exit /b made cmd.exe leave an empty staging dir
REM behind during installs, so the config step runs in place here instead.
set "HOME_DIR=%USERPROFILE%"
if defined CODEX_HOME set "HOME_DIR=%CODEX_HOME%"
set "CFG=%HOME_DIR%@BS@config.toml"
set "CFG_STATE="
for /f "delims=" %%R in ('powershell -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%PKG_DIR%_huhu-config.ps1" -ConfigPath "%CFG%" -BackupPath "%CFG%.huhu-!TS!.bak"') do set "CFG_STATE=%%R"
if "!CFG_STATE!"=="WROTE" (
    echo [OK] config.toml updated: selected-avatar-id = custom:huhu-carrot-office >> "%LOG%"
)
if "!CFG_STATE!"=="ALREADY-SET" (
    echo [OK] config.toml already points at 胡胡 >> "%LOG%"
)
if "!CFG_STATE!"=="KEPT-OTHER-VALUE" (
    echo [WARN] selected-avatar-id already set to another pet; left untouched >> "%LOG%"
    echo [WARN] selected-avatar-id already set to another pet; left untouched.
)
if "!CFG_STATE!"=="SKIPPED" (
    echo [WARN] config.toml not found at %CFG% >> "%LOG%"
    echo [WARN] config.toml not found; add selected-avatar-id under [desktop] manually.
)
if "!CFG_STATE!"=="" (
    echo [ERROR] config step returned no result >> "%LOG%"
    exit /b 1
)

REM sweep stale staging dirs left behind by an interrupted earlier install
for /d %%D in ("%PET_DIR%@BS@.huhu-*-installing") do rmdir /S /Q "%%D"

echo.
echo Install finished. Restart DSH or Codex, then pick 胡胡 in settings.
exit /b 0

:install_pet
set "ID=%~1"
set "SRC=%PKG_DIR%pet@BS@%ID%"
set "DST=%PET_DIR%@BS@%ID%"
set "TMP=%PET_DIR%@BS@.%ID%-installing"
echo [%date% %time%] installing %ID% >> "%LOG%"
if not exist "%SRC%" (
    echo [ERROR] source directory missing: %SRC% >> "%LOG%"
    echo [ERROR] source directory missing: %SRC%
    exit /b 1
)
if exist "%TMP%" rmdir /S /Q "%TMP%"
if not exist "%PET_DIR%" mkdir "%PET_DIR%"
REM a trailing backslash makes xcopy copy the source CONTENTS, not the dir
xcopy /E /I /Y "%SRC%@BS@" "%TMP%" >nul
if errorlevel 1 (
    echo [ERROR] copy failed for %ID% >> "%LOG%"
    rmdir /S /Q "%TMP%"
    exit /b 1
)
REM verify the staged copy against the source before the rename replaces the
REM live pet. robocopy /L is list-only and never touches either dir: exit 0
REM means the trees match; 1 or more means a file differs, is missing or is
REM extra. The old for/R + fc loop was dead code: for/R yields absolute
REM paths on this build, and its directory guard skipped every regular file.
robocopy "%SRC%" "%TMP%" /L /E /NJH /NJS /NFL /NDL /NC /NS /NP >nul
if errorlevel 1 (
    echo [ERROR] staged copy differs from the source for %ID% >> "%LOG%"
    rmdir /S /Q "%TMP%"
    exit /b 1
)
echo [OK] staged copy matches the source for %ID% >> "%LOG%"
if exist "%DST%" rmdir /S /Q "%DST%"
ren "%TMP%" "%ID%"
if errorlevel 1 (
    echo [ERROR] rename failed for %ID% >> "%LOG%"
    rmdir /S /Q "%TMP%"
    exit /b 1
)
echo [OK] %ID% installed to %DST% >> "%LOG%"
exit /b 0
'''


CONFIG_PS1 = '''param(
    [Parameter(Mandatory = $true)] [string] $ConfigPath,
    [string] $Key = 'selected-avatar-id',
    [string] $Value = 'custom:huhu-carrot-office',
    [string] $BackupPath = ''
)
$ErrorActionPreference = 'Stop'
$ValueLine = $Key + ' = "' + $Value + '"'

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Host 'SKIPPED'
    exit 0
}
if ($BackupPath -ne '') {
        # Copy-Item takes the source as -LiteralPath and the target as -Destination.
    # Writing -LiteralPath twice raises ParameterAlreadyBound, which aborted the
    # whole config step before anything was written.
    Copy-Item -LiteralPath $ConfigPath -Destination $BackupPath -Force
}

$lines = @(Get-Content -LiteralPath $ConfigPath)
$hits = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like ('*' + $Key + '*')) { $hits += $i }
}
if ($hits.Count -gt 0) {
    if ($lines[$hits[0]] -like ('*' + $Value + '*')) {
        Write-Host 'ALREADY-SET'
    } else {
        Write-Host 'KEPT-OTHER-VALUE'
    }
    exit 0
}

$desktop = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith('[') -and ($lines[$i] -like '*desktop*')) { $desktop += $i }
}

if ($desktop.Count -eq 0) {
    $out = @($lines) + @('', '[desktop]', $ValueLine)
} else {
    $start = $desktop[$desktop.Count - 1]
    $end = $start
    for ($j = $start + 1; $j -lt $lines.Count; $j++) {
        if ($lines[$j].StartsWith('[')) { break }
        $end = $j
    }
    $tail = @()
    if ($end + 1 -lt $lines.Count) { $tail = @($lines[($end + 1)..($lines.Count - 1)]) }
    $out = @($lines[0..$end]) + @($ValueLine) + $tail
}
$out | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
Write-Host 'WROTE'
'''


UNINSTALL_CMD = '''@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

if "%~1"=="" (
    if defined CODEX_HOME (
        set "PET_DIR=%CODEX_HOME%@BS@pets"
    ) else (
        set "PET_DIR=%USERPROFILE%@BS@.codex@BS@pets"
    )
) else (
    set "PET_DIR=%~1"
)

REM %date% is locale dependent: on a YYYY/MM/DD machine ~0,8 yields
REM 2026/09/ (no day, and with slashes) which landed inside the backup
REM FILENAME and made Copy-Item fail. Get-Date is locale independent.
set "TS=manual"
for /f "delims=" %%T in ('powershell -NoProfile -NoLogo -Command "Get-Date -Format yyyyMMddHHmmss"') do set "TS=%%T"
set "LOG_DIR=%LOCALAPPDATA%@BS@HuhuPet"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG=%LOG_DIR%@BS@huhu-uninstall-!TS!.log"
echo [%date% %time%] uninstall start pets=%PET_DIR% > "%LOG%"

call :remove_pet huhu-carrot
call :remove_pet huhu-carrot-office

set "HOME_DIR=%USERPROFILE%"
if defined CODEX_HOME set "HOME_DIR=%CODEX_HOME%"
set "CFG=%HOME_DIR%@BS@config.toml"
if exist "%CFG%" (
    findstr /C:"selected-avatar-id" "%CFG%" | findstr /C:"custom:huhu-carrot-office" >nul
    if not errorlevel 1 (
        set "BAK="
        for /f "delims=" %%B in ('dir /B /O-D "%CFG%.huhu-*.bak" 2^>nul') do (
            if not defined BAK set "BAK=%HOME_DIR%@BS@%%B"
        )
        if defined BAK (
            copy /Y "!BAK!" "%CFG%" >nul
            echo [OK] config.toml restored from !BAK! >> "%LOG%"
        ) else (
            echo [WARN] no huhu config backup found; unset selected-avatar-id manually >> "%LOG%"
        )
    )
)

del /Q "%LOG_DIR%@BS@huhu-install-*.log" 2>nul
echo.
echo Uninstall finished. Log: %LOG%
exit /b 0

:remove_pet
set "ID=%~1"
set "DST=%PET_DIR%@BS@%ID%"
if exist "%DST%" (
    rmdir /S /Q "%DST%"
    echo [OK] removed %DST% >> "%LOG%"
) else (
    echo [INFO] not installed: %DST% >> "%LOG%"
)
exit /b 0
'''

FILES = {
    'VERSION.txt': lambda: VERSION_TXT,
    'HUHU-EDITION.txt': lambda: EDITION_TXT,
    'README.md': lambda: README_MD,
    'ASSET-NOTICE.md': lambda: ASSET_NOTICE_MD,
    '安装胡胡.cmd': lambda: INSTALL_CMD.replace('@BS@', BS),
    '卸载胡胡-Windows.cmd': lambda: UNINSTALL_CMD.replace('@BS@', BS),
    '_huhu-config.ps1': lambda: CONFIG_PS1,
}


def build_all():
    RELEASE_ROOT.mkdir(parents=True, exist_ok=True)
    for name, make in FILES.items():
        path = RELEASE_ROOT / name
        path.write_text(make(), encoding='utf-8')
    return sorted(path.name for path in RELEASE_ROOT.iterdir() if path.is_file())


def main():
    names = build_all()
    print('release files in', RELEASE_ROOT)
    for name in names:
        print(' ', name)


if __name__ == '__main__':
    main()
