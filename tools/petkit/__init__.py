"""One build entry for every pet in this repo.

`pet/` holds the built pets (one directory per pet the engine loads); `pets/`
holds the recipes. One recipe describes one *character* and every pet directory
built from it, so adding a pet means dropping a 192x208 RGBA base image plus one
JSON file -- nothing in the builder is pet-specific.

    python tools/build_pet.py                 # rebuild every recipe
    python tools/build_pet.py huhu-carrot     # rebuild one character
    python tools/build_pet.py --list          # what the recipes declare

Stage split (a stage only reads what the stage before it wrote, so each one can
be re-run on its own):

    frames2d   base + motion        -> pet/<id>/frames + frames-spec.json
    sprite2d   base + frames        -> pet/<id>/spritesheet + atlas-spec.json
    manifests  specs                -> pet/<id>/pet.json + voice.json
    previews   frames + atlas       -> preview GIFs / contact sheet / page

The ``build`` name is exported as the function *and* is a submodule; inside the
package always import what you need explicitly (``from .build import build_all``)
so the package attribute cannot shadow the module.
"""

from __future__ import annotations

import sys
from pathlib import Path

# tools/ is a flat directory of single-file tools; petkit lives beside them and
# reuses transforms.py, so make tools/ importable however petkit is loaded.
_TOOLS = str(Path(__file__).resolve().parent.parent)
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

from .spec import SpecError, load_spec, pet_dirs, spec_paths  # noqa: E402
from .build import STAGES, build, build_all  # noqa: E402

__all__ = ['STAGES', 'SpecError', 'build', 'build_all', 'load_spec',
           'pet_dirs', 'spec_paths']
