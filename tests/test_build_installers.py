import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import build_installers as BI

ROOT = Path(__file__).resolve().parent.parent
PKG = BI.RELEASE_ROOT

VERSION_LINES = {
    'Package: Huhu Windows',
    'Version: 1',
    'System: Windows 10/11',
    'Architecture: x64 + ARM64',
    'Pets: huhu-carrot (frames2d), huhu-carrot-office (sprite2d v1 compat)',
}


def test_all_seven_package_files_exist():
    for name in ['VERSION.txt', 'HUHU-EDITION.txt', 'README.md', 'ASSET-NOTICE.md',
                 '安装胡胡.cmd', '卸载胡胡-Windows.cmd', '_huhu-config.ps1']:
        assert (PKG / name).is_file(), name


def test_version_txt_has_exactly_the_five_declared_lines():
    text = (PKG / 'VERSION.txt').read_text(encoding='utf-8')
    assert set(l for l in text.splitlines() if l.strip()) == VERSION_LINES


def test_edition_marker_matches_the_installer_check():
    marker = (PKG / 'HUHU-EDITION.txt').read_text(encoding='utf-8')
    assert 'edition=huhu-carrot-v1' in marker


def test_asset_notice_covers_provenance_and_the_engine():
    text = (PKG / 'ASSET-NOTICE.md').read_text(encoding='utf-8')
    assert '个人使用' in text
    assert '@linxin666/dsh-pet' in text
    assert 'Apache-2.0' in text
    assert '不修改' in text


def test_readme_states_the_restart_requirement_and_the_config_key():
    text = (PKG / 'README.md').read_text(encoding='utf-8')
    assert '重启' in text
    assert 'selected-avatar-id' in text
    assert 'custom:huhu-carrot-office' in text
    assert 'huhu-carrot' in text


def test_installer_has_every_guard_the_spec_requires():
    text = (PKG / '安装胡胡.cmd').read_text(encoding='utf-8')
    for marker in ['HUHU-EDITION.txt', 'edition=huhu-carrot-v1', 'robocopy',
                   '-installing', 'ren "%TMP%" "%ID%"', 'HUHU_YES', 'pause',
                   'CODEX_HOME', 'xcopy', '_huhu-config.ps1', 'chcp 65001']:
        assert marker in text, marker
    assert '@BS@' not in text
    assert chr(92) in text


def test_uninstaller_restores_the_config_backup():
    text = (PKG / '卸载胡胡-Windows.cmd').read_text(encoding='utf-8')
    for marker in ['rmdir /S /Q', 'selected-avatar-id', 'custom:huhu-carrot-office',
                   '.huhu-*.bak', 'CODEX_HOME']:
        assert marker in text, marker
    assert '@BS@' not in text


def test_config_default_points_at_the_dot_codex_home_like_the_pet_dir():
    for name in ['安装胡胡.cmd', '卸载胡胡-Windows.cmd']:
        text = (PKG / name).read_text(encoding='utf-8')
        assert 'set "HOME_DIR=%USERPROFILE%\\.codex"' in text, name
        assert 'set "HOME_DIR=%USERPROFILE%"' not in text, name


def test_config_script_reports_each_outcome_distinctly():
    text = (PKG / '_huhu-config.ps1').read_text(encoding='utf-8')
    for marker in ['param(', '$ConfigPath', "$Key = 'selected-avatar-id'",
                   "$Value = 'custom:huhu-carrot-office'", 'WROTE', 'ALREADY-SET',
                   'KEPT-OTHER-VALUE', 'SKIPPED']:
        assert marker in text, marker
    assert 'Set-Content' not in text


def test_config_script_writes_without_bom_and_keeps_line_endings():
    text = (PKG / '_huhu-config.ps1').read_text(encoding='utf-8')
    assert 'Set-Content' not in text
    assert 'WriteAllText' in text
    assert '[System.Text.UTF8Encoding]::new($false)' in text
