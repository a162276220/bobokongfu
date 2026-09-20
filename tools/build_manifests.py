from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRAMES_SPEC = ROOT / 'assets' / 'derived' / 'frames-spec.json'
ATLAS_SPEC = ROOT / 'assets' / 'derived' / 'atlas-spec.json'

DISPLAY_NAME = '胡胡'
DESCRIPTION = '胡萝卜毛绒玩偶；会呼吸、眨眼，并随会话状态变化。'
VERSION = '1.0.0'
AUTHOR = 'a162276220'
LICENSE = 'User-supplied source; personal use only'
SPRITESHEET = 'spritesheet-win-1.png'

PHASES = {
    'idle': 'idle',
    'waiting': 'waiting',
    'thinking': 'thinking',
    'tool': 'tool',
    'review': 'review',
    'done': 'done',
    'failed': 'failed',
}
SEQUENCES = {'idle': ['idle', 'idle', 'waving', 'idle', 'running-left']}
REMARKS = {
    'pet': ['胡萝卜脑袋被你摸到了～', '嘿嘿，别蹭我叶子啦。', '再摸一下嘛，就一下。'],
    'petCooldown': ['刚才被摸过啦，歇一会儿。'],
    'feed': ['这不是小鱼干，但我不挑。', '谢谢投喂，胡萝卜味的。'],
    'feedCooldown': ['吃不下了，今天糖分超标。'],
    'noTreats': ['我自带糖分，不用投喂啦。'],
}
VOICE = {
    '$schema': 'https://schemas.linxin666.org/dsh-pet/voice-pack-v1.schema.json',
    'voicePackVersion': 1,
    'status': {
        'prepare': ['准备开工，叶子精神得很。', '深呼吸，开始吧。'],
        'waiting': ['在这儿等你下命令。', '暂停待命中，随时出发。'],
        'thinking': ['正在想事情……', '胡萝卜里也在思考。'],
        'review': ['我在检查，别催。', '再过一遍更稳。'],
        'toolResult': ['收到结果了，继续。', '这一步有数了。'],
        'done': ['搞定！撒个小欢。', '完成，今天糖分满分。'],
        'failed': ['哎呀，没做成。', '再来一次说不定就成了。'],
    },
    'whispers': {
        'categories': {
            'thinking': ['脑子转起来了。', '有点头绪了。'],
            'writing': ['一笔一笔地写。', '慢慢来，别急。'],
            'reading': ['我在看，看得挺慢。', '这段有点绕。'],
        },
        'results': {
            'pass': ['过了，稳。', '验收通过，开心。'],
            'fail': ['没过……我看看。', '再来一轮。'],
            'done': ['收工，撒个欢。'],
        },
    },
    'panel': {
        'labels': {'feed': '投喂', 'rename': '改名', 'hide': '先躲起来', 'confirm': '确定'},
        'stats': {'rank': '胡萝卜等级 {rank}', 'treats': '小鱼干 {n} 条',
                  'points': '{points} 分'},
        'actions': ['feed', 'rename', 'hide'],
    },
}


def _frames2d_tracks():
    spec = json.loads(FRAMES_SPEC.read_text(encoding='utf-8'))
    tracks = {}
    for name, data in spec.items():
        entry = {'frames': list(data['frames']), 'frameMs': list(data['frameMs']),
                 'loop': bool(data['loop'])}
        if data['fallback'] is not None:
            entry['fallback'] = data['fallback']
        tracks[name] = entry
    return tracks


def frames2d_manifest():
    return {
        '$schema': 'https://schemas.linxin666.org/dsh-pet/pet-manifest-v2.schema.json',
        'petManifestVersion': 2,
        'id': 'huhu-carrot',
        'displayName': DISPLAY_NAME,
        'description': DESCRIPTION,
        'version': VERSION,
        'author': AUTHOR,
        'license': LICENSE,
        'renderer': 'frames2d',
        'frames2d': {'dir': 'frames', 'defaultFrameMs': 200,
                     'tracks': _frames2d_tracks(), 'phases': PHASES},
        'remarks': REMARKS,
    }


def sprite2d_manifest():
    spec = json.loads(ATLAS_SPEC.read_text(encoding='utf-8'))
    return {
        'id': 'huhu-carrot-office',
        'displayName': DISPLAY_NAME,
        'description': DESCRIPTION,
        'spritesheetPath': SPRITESHEET,
        'cell': {'width': spec['cell']['width'], 'height': spec['cell']['height']},
        'columns': spec['columns'],
        'frames': list(spec['frames']),
        'tracks': spec['tracks'],
        'sequences': SEQUENCES,
        'remarks': REMARKS,
    }


def write_json(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + chr(10), encoding='utf-8')


def main():
    write_json(ROOT / 'pet' / 'huhu-carrot' / 'pet.json', frames2d_manifest())
    write_json(ROOT / 'pet' / 'huhu-carrot' / 'voice.json', VOICE)
    write_json(ROOT / 'pet' / 'huhu-carrot-office' / 'pet.json', sprite2d_manifest())
    write_json(ROOT / 'pet' / 'huhu-carrot-office' / 'voice.json', VOICE)
    print('wrote pet/huhu-carrot/pet.json and voice.json')
    print('wrote pet/huhu-carrot-office/pet.json and voice.json')


if __name__ == '__main__':
    main()
