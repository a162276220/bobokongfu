import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# package_release reads HUHU_DOWNLOADS at import time and defaults to the real
# Downloads folder, which the sandbox can refuse and which a test should not
# touch. Pin it to the workspace so the test is hermetic.
os.environ['HUHU_DOWNLOADS'] = str(ROOT / 'release')
sys.path.insert(0, str(ROOT / 'tools'))
import package_release as PR

RELEASE = PR.RELEASE_ROOT
EXCLUDED = ['preview', 'tools', 'assets', 'docs', '__pycache__', '.git', '.pytest_cache']


def test_package_holds_both_pets_with_their_assets():
    assert (RELEASE / 'pet' / 'huhu-carrot' / 'pet.json').is_file()
    assert (RELEASE / 'pet' / 'huhu-carrot' / 'validation.json').is_file()
    assert (RELEASE / 'pet' / 'huhu-carrot' / 'frames' / 'idle' / 'f00.png').is_file()
    assert (RELEASE / 'pet' / 'huhu-carrot-office' / 'pet.json').is_file()
    assert (RELEASE / 'pet' / 'huhu-carrot-office' / 'spritesheet-win-1.png').is_file()


def test_build_dirs_are_kept_out_of_the_package():
    for name in EXCLUDED:
        assert not (RELEASE / name).exists(), name


def test_checksum_file_lists_and_verifies_every_shipped_file():
    text = (RELEASE / 'CHECKSUMS-SHA256.txt').read_text(encoding='utf-8')
    entries = [line.split('  ', 1) for line in text.splitlines() if line.strip()]
    assert len(entries) > 20
    for digest, rel in entries:
        assert len(digest) == 64
        assert chr(92) not in rel
        target = RELEASE / rel
        assert target.is_file(), rel
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest


def test_zip_entries_are_slash_paths_with_the_utf8_flag():
    with zipfile.ZipFile(PR.zip_path()) as zf:
        names = zf.namelist()
        assert all(chr(92) not in n for n in names)
        assert zf.testzip() is None
        # ZipInfo has no is_file(); is_dir() is the ZipInfo method.
        infos = {i.filename: i for i in zf.infolist() if not i.is_dir()}
        assert 'pet/huhu-carrot/pet.json' in infos
        chinese = [n for n in infos if any(ord(c) > 127 for c in n)]
        assert chinese, 'package must ship the chinese-named cmd files'
        assert all(i.flag_bits & 0x800 for i in infos.values() if any(ord(c) > 127 for c in i.filename))


def test_zip_round_trip_matches_the_package_dir(tmp_path):
    problems = PR.verify_zip(PR.zip_path(), RELEASE, tmp_path / 'out')
    assert problems == [], problems


def test_installer_runs_end_to_end_against_a_sandbox(tmp_path):
    pets = tmp_path / 'pets'
    config = tmp_path / 'config.toml'
    config.write_bytes(b'[desktop]\ntheme = "dark"\n\n[other]\nx = 1\n')
    env = os.environ.copy()
    env['HUHU_YES'] = '1'
    env['CODEX_HOME'] = str(tmp_path)
    env['LOCALAPPDATA'] = str(tmp_path / 'local')
    cmd = RELEASE / '安装胡胡.cmd'
    proc = subprocess.run(['cmd', '/c', str(cmd), str(pets)],
                          capture_output=True, text=True, encoding='utf-8', env=env)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert (pets / 'huhu-carrot' / 'pet.json').is_file()
    assert (pets / 'huhu-carrot-office' / 'spritesheet-win-1.png').is_file()
    assert not (pets / '.huhu-carrot-installing').exists()
    assert not (pets / '.huhu-carrot-office-installing').exists()
    text = config.read_text(encoding='utf-8')
    assert 'selected-avatar-id = "custom:huhu-carrot-office"' in text
    assert '[other]' in text and 'x = 1' in text
    assert list(config.parent.glob(config.name + '.huhu-*.bak')), 'config backup missing'
    raw = config.read_bytes()
    assert not raw.startswith(b'\xef\xbb\xbf'), 'installer must not add a UTF-8 BOM'
    assert b'\r\n' not in raw, 'installer must preserve the file line endings'
    import tomllib
    parsed = tomllib.loads(raw.decode('utf-8'))
    assert parsed['desktop']['selected-avatar-id'] == 'custom:huhu-carrot-office'
    assert parsed['other']['x'] == 1


def test_installer_refuses_a_directory_without_the_edition_marker(tmp_path):
    fake = tmp_path / 'fake'
    fake.mkdir()
    shutil.copyfile(RELEASE / '安装胡胡.cmd', fake / '安装胡胡.cmd')
    env = os.environ.copy()
    env['HUHU_YES'] = '1'
    env['LOCALAPPDATA'] = str(tmp_path / 'local')
    proc = subprocess.run(['cmd', '/c', str(fake / '安装胡胡.cmd'), str(tmp_path / 'pets')],
                          capture_output=True, text=True, encoding='utf-8', env=env)
    assert proc.returncode == 1
    assert not (tmp_path / 'pets' / 'huhu-carrot').exists()
