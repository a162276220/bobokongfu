"""Command line for the pet builder.

Building a pet and checking it are one act, so ``build_pet.py`` runs the two
shipped checkers (validate_pet for the manifest/geometry contract, qa_check for
the pixel half of the rubric) on every pet directory it just wrote, in a
subprocess, exactly as if they had been run by hand.
"""

from __future__ import annotations

import argparse
import subprocess
import sys

from . import spec as S
from .build import STAGES, build_all

VALIDATOR = S.ROOT / 'tools' / 'validate_pet.py'
QA_CHECK = S.ROOT / 'tools' / 'qa_check.py'


def _run_tool(tool, pet_dir, extra=()):
    # Decoded leniently: a checker run on a cp936 console may print a pet name in
    # the local code page rather than UTF-8.
    return subprocess.run([sys.executable, str(tool), str(pet_dir)] + list(extra),
                          capture_output=True, text=True, encoding='utf-8',
                          errors='replace')


def _check(tool, pet_dir, extra=(), out=print):
    proc = _run_tool(tool, pet_dir, extra)
    text = (proc.stdout or '') + (proc.stderr or '')
    for line in text.splitlines():
        if line.strip() and ('ok' in line or 'FAIL' in line or 'WARN' in line):
            out('    ' + line.strip())
    return proc.returncode == 0


def list_recipes(out=print):
    for path in S.spec_paths():
        try:
            spec = S.load_spec(path)
        except S.SpecError as exc:
            out('%-20s BROKEN  %s' % (path.stem, str(exc).replace('\n', ' ')))
            continue
        outputs = ', '.join('%s (%s)' % (block.get('petId', spec['id']), kind)
                           for kind, block in spec['outputs'].items())
        out('%-20s %-6s %s' % (spec['id'], spec['displayName'], outputs))


def _relative(path):
    return str(path.relative_to(S.ROOT)) if path is not None else ''


def _line(stage, result):
    if 'skipped' in result:
        return 'skipped: ' + result['skipped']
    if stage == 'frames2d':
        frames = result['frames']
        return '%d tracks, %d frames → %s' % (len(frames), sum(frames.values()),
                                              _relative(result['dir']))
    if stage == 'sprite2d':
        if result.get('built') is False:
            return 'supplied sheet kept → %s' % _relative(result['sheet'])
        return 'atlas %d rows %s, %d bytes → %s' % (
            len(result['frames']), result['frames'], result['sheet'].stat().st_size,
            _relative(result['sheet']))
    if stage == 'manifests':
        return '%s%s' % (', '.join(_relative(d) for d in result['dirs']),
                         ' + voice.json' if result['voice'] else '')
    return _relative(result['dir'])


def _report(spec, results, out):
    ids = ', '.join('%s (%s)' % (pet_id, kind) for kind, pet_id, _ in S.pet_dirs(spec))
    out('%s  %s  →  %s' % (spec['id'], spec['displayName'], ids))
    for stage in STAGES:
        if stage in results:
            out('    %-10s %s' % (stage, _line(stage, results[stage])))


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Build every pet from its recipe in pets/, then check it.')
    parser.add_argument('character', nargs='*',
                        help='recipe ids (default: every recipe in pets/)')
    parser.add_argument('--list', action='store_true',
                        help='show the recipes and what they build, build nothing')
    parser.add_argument('--stage', action='append', choices=STAGES,
                        help='run only this stage (repeatable)')
    parser.add_argument('--no-validate', action='store_true',
                        help='skip validate_pet on what was just built')
    parser.add_argument('--no-qa', action='store_true',
                        help='skip qa_check on what was just built')
    parser.add_argument('--strict', action='store_true',
                        help='pass --strict through to qa_check')
    parser.add_argument('--gallery', dest='gallery', action='store_true',
                        help='also refresh the cross-pet state overview page')
    parser.add_argument('--no-gallery', dest='gallery', action='store_false',
                        help='skip the overview page even on a full build')
    parser.set_defaults(gallery=None)
    args = parser.parse_args(argv)

    if args.list:
        list_recipes()
        return 0

    built, failed = build_all(args.character or None, args.stage)
    for path, message in failed:
        print('FAILED %s' % path.name)
        for line in message.splitlines():
            print('  ' + line)
    for spec, results in built:
        _report(spec, results, print)

    # The overview compares every pet, so it is only meaningful (and only
    # written) when the whole set was just built; --gallery forces it either way.
    wanted = args.gallery if args.gallery is not None else not args.character
    gallery_ok = True
    if wanted:
        from . import gallery as gallery_page
        try:
            page = gallery_page.write_gallery()
            print('  gallery  %s (%d pets, %d states, %.1f MB)' % (
                _relative(page['path']), len(page['pets']), page['states'],
                page['bytes'] / 1048576))
        except Exception as exc:
            print('FAILED gallery: %s' % exc)
            gallery_ok = False

    checks = []
    for spec, _ in built:
        for _, _, pet_dir in S.pet_dirs(spec):
            if not args.no_validate:
                print('  validate %s' % pet_dir.relative_to(S.ROOT))
                checks.append(_check(VALIDATOR, pet_dir))
            if not args.no_qa:
                print('  qa       %s' % pet_dir.relative_to(S.ROOT))
                checks.append(_check(QA_CHECK, pet_dir,
                                     ('--strict',) if args.strict else ()))
    return 1 if failed or not all(checks) or not gallery_ok else 0
