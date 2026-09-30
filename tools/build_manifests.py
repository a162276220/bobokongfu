"""Deprecated: manifest and voice pack generation.

The manifest text (remarks, voice, phases) now lives in ``pets/huhu-carrot.json``
and is written by ``tools/petkit``. Whole pipeline: ``python tools/build_pet.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from petkit.build import build  # noqa: E402

SPEC = 'huhu-carrot'


def main():
    spec, results = build(SPEC, stages=['manifests'])
    for directory in results['manifests']['dirs']:
        print('wrote', directory / 'pet.json')
        if results['manifests']['voice']:
            print('wrote', directory / 'voice.json')


if __name__ == '__main__':
    main()
