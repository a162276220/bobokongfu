from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PET_SRC = ROOT / 'pet'
VALIDATOR = ROOT / 'tools' / 'validate_pet.py'
PETS = ('huhu-carrot', 'huhu-carrot-office')
ZIP_NAME = '胡胡-Windows-10-11.zip'
DOWNLOADS = Path(os.environ.get('HUHU_DOWNLOADS', 'C:/Users/HUAWEI/Downloads'))
RELEASE_ROOT = ROOT / 'release' / '胡胡-Windows-10-11'
VERIFY_DIR = ROOT / 'release' / '_verify'


def zip_path():
    return DOWNLOADS / ZIP_NAME


def run_validator(pet_id):
    proc = subprocess.run([sys.executable, str(VALIDATOR), str(PET_SRC / pet_id)],
                          capture_output=True, text=True, encoding='utf-8')
    print(proc.stdout, end='')
    if proc.returncode != 0:
        raise SystemExit('validator failed for ' + pet_id)


def copy_pets():
    target = RELEASE_ROOT / 'pet'
    if target.exists():
        shutil.rmtree(target)
    for pet_id in PETS:
        shutil.copytree(PET_SRC / pet_id, target / pet_id)


def write_checksums():
    rows = []
    for path in sorted(RELEASE_ROOT.rglob('*')):
        if not path.is_file() or path.name == 'CHECKSUMS-SHA256.txt':
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        rows.append(digest + '  ' + path.relative_to(RELEASE_ROOT).as_posix())
    (RELEASE_ROOT / 'CHECKSUMS-SHA256.txt').write_text(
        chr(10).join(rows) + chr(10), encoding='utf-8')
    return len(rows)


def build_package():
    for pet_id in PETS:
        run_validator(pet_id)
    copy_pets()
    count = write_checksums()
    print('packaged files', count)
    return count


def make_zip(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for entry in sorted(RELEASE_ROOT.rglob('*')):
            if not entry.is_file():
                continue
            rel = entry.relative_to(RELEASE_ROOT).as_posix()
            info = zipfile.ZipInfo(rel)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            if any(ord(ch) > 127 for ch in rel):
                info.flag_bits |= 0x800
            zf.writestr(info, entry.read_bytes())
    return path.stat().st_size


def verify_zip(path, src_dir, out_dir):
    problems = []
    if not path.is_file():
        return ['zip not found: ' + str(path)]
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        for name in names:
            if chr(92) in name:
                problems.append('backslash entry: ' + name)
        broken = zf.testzip()
        if broken is not None:
            problems.append('crc error: ' + broken)
        for name in names:
            info = zf.getinfo(name)
            if any(ord(ch) > 127 for ch in name) and not (info.flag_bits & 0x800):
                problems.append('utf8 flag missing: ' + name)
        if out_dir.exists():
            shutil.rmtree(out_dir)
        zf.extractall(out_dir)
    for entry in sorted(src_dir.rglob('*')):
        if not entry.is_file():
            continue
        rel = entry.relative_to(src_dir).as_posix()
        extracted = out_dir / rel
        if not extracted.is_file():
            problems.append('missing after extract: ' + rel)
            continue
        if extracted.read_bytes() != entry.read_bytes():
            problems.append('bytes differ: ' + rel)
    return problems


def main():
    build_package()
    size = make_zip(zip_path())
    problems = verify_zip(zip_path(), RELEASE_ROOT, VERIFY_DIR)
    for problem in problems:
        print('PROBLEM', problem)
    if problems:
        raise SystemExit(1)
    print('zip', zip_path())
    print('bytes', size)
    print('verified ok')


if __name__ == '__main__':
    main()
