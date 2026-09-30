#!/usr/bin/env python
"""Write one page comparing every pet's states side by side.

    python tools/build_gallery.py                    # every pet in pet/
    python tools/build_gallery.py --out preview/g.html
    python tools/build_gallery.py pet/dundun-office pet/raccoon-typing

Reads the shipped ``pet/<id>/`` directories, never redraws anything, and embeds
one lossless strip image per state. ``build_pet.py`` refreshes the same page
after a full build; this entry is for looking again without rebuilding.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from petkit import gallery  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('pets', nargs='*', help='pet directories (default: every pet in pet/)')
    parser.add_argument('--out', default='preview/gallery.html', help='where to write the page')
    args = parser.parse_args(argv)
    try:
        result = gallery.write_gallery(args.pets or None, args.out)
    except Exception as exc:  # a broken pet directory should read as one line, not a traceback
        print('FAILED %s' % exc)
        return 1
    print('%d pets, %d states, %.1f MB → %s'
          % (len(result['pets']), result['states'], result['bytes'] / 1048576,
             result['path']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
