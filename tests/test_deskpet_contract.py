"""The workbench's pet contract is generated, so nothing may drift from it.

deskpet-players.js cannot fetch pet.json at runtime (the workbench opens over
file://), so the contract is inlined -- which only stays true if a build step
writes it. These tests are that guarantee: the block matches the manifests, the
moods a pet is asked to play exist in that pet's atlas, and the shop never
sells a pet the player cannot render.
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

import build_deskpet_contract as C  # noqa: E402

PLAYERS = ROOT / '淘金矿工小屋' / 'deskpet-players.js'
WORKBENCH = ROOT / '淘金矿工小屋' / '淘金矿工小屋·自律工作台.html'


def test_the_player_script_parses_as_javascript():
    """A path glob written inside a block comment closes the comment early and
    turns the rest of the header into code -- only the parser catches that."""
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not on PATH')
    proc = subprocess.run([node, '--check', str(PLAYERS)],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[:400]


def _block():
    return C.replaced(PLAYERS.read_text(encoding='utf-8'))


def test_the_inlined_contract_matches_the_manifests():
    assert _block() == PLAYERS.read_text(encoding='utf-8'), \
        'PET_SPECS is stale -- run tools/build_deskpet_contract.py'


def test_every_built_pet_is_in_the_contract():
    shipped = {path.parent.name for path in (ROOT / 'pet').glob('*/pet.json')}
    listed = set(re.findall(r'^    "?([\w-]+)"?: \{$',
                            PLAYERS.read_text(encoding='utf-8'), re.M))
    assert shipped <= listed, sorted(shipped - listed)


def test_each_pet_answers_every_mood_with_a_row_it_has():
    specs = C.specs()
    assert specs
    for pet_id, spec in specs.items():
        available = set(spec.get('sheet', {}).get('rowNames')
                        or spec['frames2d']['tracks'])
        for mood, row in spec['map'].items():
            assert row in available, (pet_id, mood, row)
        assert set(spec['map']) == set(C.MAP_CANDIDATES), pet_id


def test_the_contract_points_at_files_that_exist():
    for pet_id, spec in C.specs().items():
        if spec['kind'] == 'sheet':
            path = ROOT / 'pet' / spec['sheet']['file']
            assert path.exists(), (pet_id, str(path))
            continue
        # A frames2d pet's loose frames are build output (petkit regenerates
        # them), so only check the pixels when they have been built.
        directory = ROOT / 'pet' / spec['frames2d']['dir']
        if not directory.exists():
            continue
        for track, entry in spec['frames2d']['tracks'].items():
            assert entry['frames'], (pet_id, track)
            for frame in entry['frames']:
                assert (directory / track / frame).exists(), (pet_id, track, frame)


def test_the_sheet_frame_counts_match_the_atlas():
    for pet_id, spec in C.specs().items():
        if spec['kind'] != 'sheet':
            continue
        sheet = spec['sheet']
        assert len(sheet['frames']) == len(sheet['rowNames']), pet_id
        assert all(1 <= count <= sheet['cols'] for count in sheet['frames']), pet_id


def test_the_shop_only_sells_pets_the_player_can_render():
    html = WORKBENCH.read_text(encoding='utf-8')
    sellers = set(re.findall(r"petId: '([\w-]+)'", html))
    assert sellers, 'the shop lost its pet shelf'
    missing = sellers - set(C.specs())
    assert not missing, 'shop sells pets with no contract: %s' % sorted(missing)


def test_every_adoptable_pet_has_a_shop_entry():
    html = WORKBENCH.read_text(encoding='utf-8')
    sellers = set(re.findall(r"petId: '([\w-]+)'", html))
    assert sellers == set(C.specs()), \
        'pets in the contract but not the shop: %s' % sorted(
            set(C.specs()) - sellers)
