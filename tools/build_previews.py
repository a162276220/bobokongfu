"""Deprecated: 胡胡's preview shelf (still, track GIFs, overview, atlas copy).

Rendered from ``pets/huhu-carrot.json`` by ``tools/petkit`` into ``preview/``.
Whole pipeline: ``python tools/build_pet.py``. ``checkerboard`` stays importable
from here because the preview tests use it.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from petkit.build import build  # noqa: E402
from petkit.emit import checkerboard  # noqa: E402,F401

SPEC = 'huhu-carrot'


def main():
    spec, results = build(SPEC, stages=['previews'])
    preview = results['previews']['dir']
    print('preview files in', preview)
    for child in sorted(preview.iterdir()):
        print(' ', child.name)


if __name__ == '__main__':
    main()
