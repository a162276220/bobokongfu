"""Run a recipe's stages, in order, one stage at a time.

Each stage reads what the stage before it wrote, so any of them can be re-run on
its own (that is how the old per-stage tools now work). Frames 胡胡's sprite2d
rows copy out of the frames2d files on disk rather than re-rendering them, which
is what keeps the atlas row byte-identical to the frame file the tests compare
it against -- and it means the sprite2d stage fails loudly instead of silently
inventing frames if the frames2d stage was never run.
"""

from __future__ import annotations

from . import emit, motion, render
from . import spec as S

STAGES = S.STAGE_NAMES


def default_stages(spec):
    """Everything the recipe asks for: one render per declared output, then the
    manifests, then previews if it wants them."""
    stages = [kind for kind in S.OUTPUT_KINDS if S.output(spec, kind)]
    stages.append('manifests')
    if spec.get('previews'):
        stages.append('previews')
    return stages


def declares(spec, stage):
    """Whether a recipe has anything to say about a stage."""
    if stage == 'manifests':
        return True
    if stage == 'previews':
        return bool(spec.get('previews'))
    return S.output(spec, stage) is not None


def pet_dir_of(spec, kind):
    block = _block(spec, kind)
    return S.PET_DIR / block.get('petId', spec['id'])


def _block(spec, kind):
    block = S.output(spec, kind)
    if block is None:
        raise S.SpecError('%s does not declare a %s output, so it has no %s to '
                          'build' % (spec['id'], kind, kind))
    return block


def _copied_row(spec, track_name, count):
    """Frames for a sprite2d row that reuses a frames2d track."""
    block = S.output(spec, 'frames2d')
    if block is None:
        raise S.SpecError('a row copies the frames2d track %r, but this recipe has '
                          'no frames2d output' % track_name)
    tracks = block['tracks']
    if track_name not in tracks:
        raise S.SpecError('a row copies the unknown frames2d track %r' % track_name)
    expected = motion.count_of(tracks[track_name], 'frameMs')
    if expected != count:
        raise S.SpecError('a row copies %r, which has %d frames, but its own '
                          'durations declare %d' % (track_name, expected, count))
    directory = pet_dir_of(spec, 'frames2d') / block.get('dir', 'frames') / track_name
    if not directory.is_dir():
        raise S.SpecError('frames for track %r are missing at %s; run the frames2d '
                          'stage first' % (track_name, directory))
    return render.load_frames(directory, count)


def run_frames2d(spec):
    block = _block(spec, 'frames2d')
    pet_dir = pet_dir_of(spec, 'frames2d')
    base, eyes = S.base_of(spec), S.eyes_of(spec)
    stage = block.get('blinkStage', 'before')
    root = pet_dir / block.get('dir', 'frames')
    counts = {}
    for name, track in block['tracks'].items():
        frames = render.render_track(base, eyes, track, 'frameMs', stage)
        render.save_frames(frames, root / name)
        counts[name] = len(frames)
    record = S.path_of(block, 'spec')
    if record is not None:
        emit.write_json(record, emit.frames_spec(spec))
    return {'dir': pet_dir, 'frames': counts, 'record': record}


def run_sprite2d(spec):
    block = _block(spec, 'sprite2d')
    pet_dir = pet_dir_of(spec, 'sprite2d')
    if block.get('source') == 'sheet':
        return {'dir': pet_dir, 'sheet': pet_dir / block['spritesheet'], 'built': False}
    rows = motion.declared_rows(block)
    names = render.row_names(block)
    base, eyes = S.base_of(spec), S.eyes_of(spec)
    fallback_stage = block.get('blinkStage', 'before')
    painted = []
    for name in names:
        row = rows[name]
        if row.get('from') is not None:
            painted.append(_copied_row(spec, row['from'], render.row_count(row)))
        else:
            stage = row.get('blinkStage', fallback_stage)
            painted.append(render.render_track(base, eyes, row, 'durations', stage))
    atlas = render.build_atlas(painted, block.get('columns', 8))
    pet_dir.mkdir(parents=True, exist_ok=True)
    sheet = pet_dir / block['spritesheet']
    atlas.save(sheet, format='PNG', optimize=True)
    record = S.path_of(block, 'spec')
    if record is not None:
        emit.write_json(record, emit.atlas_spec(block))
    return {'dir': pet_dir, 'sheet': sheet, 'built': True,
            'frames': [len(row) for row in painted], 'record': record}


def run_manifests(spec):
    voice = emit.voice_doc(spec)
    written = []
    frames2d = S.output(spec, 'frames2d')
    if frames2d:
        pet_dir = pet_dir_of(spec, 'frames2d')
        pet_dir.mkdir(parents=True, exist_ok=True)
        emit.write_json(pet_dir / 'pet.json', emit.frames2d_manifest(spec, frames2d))
        if voice:
            emit.write_json(pet_dir / 'voice.json', voice)
        written.append(pet_dir)
    sprite2d = S.output(spec, 'sprite2d')
    if sprite2d:
        pet_dir = pet_dir_of(spec, 'sprite2d')
        pet_dir.mkdir(parents=True, exist_ok=True)
        emit.write_json(pet_dir / 'pet.json', emit.flat_manifest(spec, sprite2d))
        if voice:
            emit.write_json(pet_dir / 'voice.json', voice)
        written.append(pet_dir)
    return {'dirs': written, 'voice': bool(voice)}


def run_previews(spec):
    block = spec.get('previews')
    if block is None:
        raise S.SpecError('%s does not declare previews' % spec['id'])
    sprite2d = S.output(spec, 'sprite2d')
    if block['style'] == 'sheet':
        # A supplied atlas is previewed off its own pixels, so this style needs
        # no base image at all.
        return {'dir': emit.sheet_previews(spec, block, _block(spec, 'sprite2d'))}
    base = S.base_of(spec)
    if block['style'] == 'classic':
        frames_dir = pet_dir_of(spec, 'frames2d') / _block(spec, 'frames2d').get('dir', 'frames')
        if sprite2d is None:
            # The classic shelf publishes a copy of the atlas, so it needs one.
            raise S.SpecError('previews.style classic also needs a sprite2d output '
                              'to publish its atlas copy')
        atlas = pet_dir_of(spec, 'sprite2d') / sprite2d['spritesheet']
        return {'dir': emit.classic_previews(spec, block, base, frames_dir, atlas)}
    if sprite2d is None:
        raise S.SpecError('previews.style pack needs a sprite2d output')
    atlas = pet_dir_of(spec, 'sprite2d') / sprite2d['spritesheet']
    return {'dir': emit.pack_previews(spec, block, sprite2d, base, atlas)}


RUNNERS = {'frames2d': run_frames2d, 'sprite2d': run_sprite2d,
           'manifests': run_manifests, 'previews': run_previews}


def build(source, stages=None):
    """Build one recipe. Returns (spec, {stage: result}).

    With an explicit stage list, a stage a recipe does not declare is skipped
    rather than failed -- ``--stage previews`` across the repo should not die on
    the one pet whose atlas is supplied instead of built.
    """
    spec = S.load_spec(source)
    explicit = stages is not None
    wanted = list(stages) if explicit else default_stages(spec)
    unknown = [stage for stage in wanted if stage not in STAGES]
    if unknown:
        raise S.SpecError('unknown stages: ' + ', '.join(unknown))
    results = {}
    for stage in wanted:
        if explicit and not declares(spec, stage):
            results[stage] = {'skipped': '%s does not declare this stage' % spec['id']}
            continue
        results[stage] = RUNNERS[stage](spec)
    return spec, results


def build_all(sources=None, stages=None):
    """Build every recipe named, or every recipe on disk.

    Returns ([(spec, results)], [(path, message)]) so a caller can report all the
    bad recipes at once instead of dying on the first.
    """
    paths = [S.spec_file(source) for source in sources] if sources else S.spec_paths()
    built, failed = [], []
    for path in paths:
        try:
            built.append(build(path, stages))
        except (S.SpecError, OSError) as exc:
            failed.append((path, str(exc)))
    return built, failed
