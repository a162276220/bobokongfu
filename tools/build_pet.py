#!/usr/bin/env python
"""Build every pet in this repo from its recipe, then validate and QA it.

    python tools/build_pet.py                 # everything, in dependency order
    python tools/build_pet.py huhu-carrot     # one character
    python tools/build_pet.py --list          # what pets/ declares
    python tools/build_pet.py --stage sprite2d

A recipe (pets/<id>.json) names one base image, the motion of every track and
row, the manifest text, and where the outputs go; see pets/README.md. The old
per-stage scripts (build_frames.py, build_atlas.py, build_manifests.py,
build_previews.py) still work and now just run one stage of this pipeline.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from petkit.cli import main  # noqa: E402

if __name__ == '__main__':
    raise SystemExit(main())
