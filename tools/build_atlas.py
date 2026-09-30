"""Deprecated: 胡胡's sprite2d atlas stage.

The atlas is built from ``pets/huhu-carrot.json`` by ``tools/petkit``, out of
the frames the frames2d stage wrote (rows that reuse a track copy those files
byte for byte). Whole pipeline: ``python tools/build_pet.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from petkit.build import build  # noqa: E402

SPEC = 'huhu-carrot'


def main():
    spec, results = build(SPEC, stages=['sprite2d'])
    built = results['sprite2d']
    print('atlas', built['sheet'], built['sheet'].stat().st_size, 'bytes')
    print('frames', built['frames'])
    print('wrote', built['record'])


if __name__ == '__main__':
    main()
