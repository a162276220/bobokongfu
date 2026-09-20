# 胡胡桌宠（Huhu Carrot Desk Pet）设计规格

- 日期：2026-09-20
- 状态：待用户复核
- 工作区：D:/桌宠
- 目标构建号：1
- 约定：文中 Windows 路径统一用正斜杠书写（cmd.exe 同样接受）

## 1. 背景与目标

用户提供一张胡萝卜毛绒玩偶实拍图，要求"以这张图片做一个桌面宠物、类似卜卜这样"。

已确认的三个决策：

1. 形态走 C 路线：先做插件式（复用现成宠物引擎），跑通后再评估独立桌宠引擎。本规格只覆盖插件式这一期。
2. 采用双宿主兼容方案：源资产是一份帧序列，构建时同时输出两只宠物，分别服务 DSH 宠物中心与 Codex 客户端。
3. 不引入 gameplay 玩法层（属性条、打工、睡觉、商店、小鱼干经济）——用户明确推迟到 v2。

目标产物：一个可双击安装的 Windows 发布包，装上并在 DSH 或 Codex 的宠物选择器里选中后，桌面上出现会呼吸、眨眼、随会话状态变化的胡萝卜宠物。

## 2. 非目标（v1 明确不做）

- Codex 额度 WPF 面板（卜卜那个 BubuQuotaPanel.ps1）——与新角色无关。
- 音效（唱歌、电吉他 MP3）。
- 悬停放大、双击专属动画、拖拽方向彩蛋、拖动中的专属动画、闲置自动趴桌边。这些需要 gameplay 块或引擎未提供的钩子，推到 v2。
- 右键菜单：引擎原生只有单击（摸头）与拖动，没有右键钩子。悬浮面板替代右键菜单。
- B 部分：独立桌宠引擎（透明置顶窗、自实现动画、拖拽、开机自启）。
- 上线 dsh-market、写 provenance.json。
- 视线跟随行（spriteVersionNumber 等于 2 的 11 行图集）：v1 只出经典 9 行图集。

能力落差如实标注：第 5 节每条行为都标注实现来源；引擎不提供的（悬停、双击、右键）写进本节的非目标，不假装做了。

## 3. 事实基础（勘察结论，含出处）

引擎为 @linxin666/dsh-pet v0.3.23，在本机两个 profile 均已激活：

- C:/Users/HUAWEI/.dsh/profiles/web/node_modules/@linxin666/dsh-pet
- C:/Users/HUAWEI/.dsh/profiles/desktop/node_modules/@linxin666/dsh-pet

两个 profile 的 package.json 均依赖 @linxin666/dsh-web-all（web 为 ^0.3.23，desktop 为 0.3.23），宠物能力经该元包内联生效。

以下条目全部来自 contracts/pet-manifest-v2.schema.json、README.zh.md、lib/types/registry.js、lib/types/voice-pack.js、lib/types/client/renderers/frames2d.js。

### 3.1 宠物等于目录加 pet.json 加资产

不改任何宿主代码即可被加载。

### 3.2 注册表的四个来源

1. 内置 assets 目录。
2. legacy 自定义 pets 目录：路径为 CODEX_HOME 环境变量（未设置时默认 ~/.codex）下的 pets 子目录。
3. 宠物中心用户目录：DSH_HOME 环境变量（未设置时为 ~/.dsh）下的 pets 子目录。
4. 组合注入（PetConfig.pets）。

关键：第 2 项正是卜卜使用的路径，同时被 DSH 宠物中心原生扫描——放进 ~/.codex/pets 的资产在 DSH 里免接线可见。本规格两只宠物都装到这一处，两个宿主都能用。

### 3.3 注册表启动时一次性构建

README 第 89 行：新增或修改宠物后必须重启 dsh web 或 DSH Desktop 才生效。安装器必须显式提示这一点。

### 3.4 清单 v2 结构 fail-closed

schema 顶层 additionalProperties 为 false，允许字段仅：

$schema、petManifestVersion、id、displayName、description、version、author、license、homepage、renderer、sprite2d、live2d、frames2d、sequences、remarks、gameplay

petManifestVersion 固定为 2。renderer 枚举 sprite2d、live2d、frames2d，未知值拒载；renderer 取某个值时对应块必填。

字段约束：id 匹配小写数字字母加连字符（首字符为字母或数字）且长度不超过 64；version 必须为三段数字（形如 1.0.0）；displayName 必填且不超过 64；description 不超过 500；author 不超过 128；license 长度 1 到 128；homepage 不超过 500。

结构错误直接拒载（宠物不出现）；sequences 与 remarks 的内容错误才是 warn-and-drop——registry.js 的 normalizeSequences 对未知 phase、项数不足、未知动画名逐条告警丢弃。

### 3.5 命名与路径安全

registry.js 中 PET_NAME_MAX_LENGTH 为 80；PET_ID_PATTERN 为小写数字字母加连字符；PATH_SEGMENT_PATTERN 只允许字母、数字、点、连字符、下划线——图集文件名必须符合后者。

### 3.6 frames2d 契约（schema properties.frames2d）

- dir：帧根目录，相对清单目录，默认当前目录，仅允许安全路径段。
- defaultFrameMs：整数，16 到 5000，默认 200。
- tracks：对象，1 到 64 个命名轨道；轨道名为 lowercase kebab、不超过 32 字符；additionalProperties 为 false。每条轨道字段：
  - frames：字符串数组，1 到 64 项，元素为轨道目录内的帧文件名（不含路径段）；省略则按文件名顺序列举目录。
  - frameMs：整数数组，每项 16 到 5000；要求 frames 列表显式给出且长度相同。
  - loop：布尔，默认 true；false 表示停在最后一帧后进入 fallback。
  - fallback：轨道名；非循环轨道结束后的目标，默认回落 idle 映射的轨道。
- phases：对象，additionalProperties 为 false，required 仅 idle。键为七个 ActivityPhase（idle、waiting、thinking、tool、review、done、failed），值为轨道名。未映射相位回落 idle。phases.idle 必须指向存在的轨道，否则客户端 validateFrames2dConfig 抛错拒载。

### 3.7 frames2d 的关键限制（frames2d.js 文件头注释）

原文：The pet center picks the track from the ActivityPhase stream (phase to track map, idle fallback); the gameplay driver may force a track through the handle's setState override (drag/work/sleep/shop...).

推论：frames2d 只播放 phases 里映射到的轨道，其余轨道永不播放；额外动画只能通过 gameplay 的 setState 强制（drag、work、sleep、shop），而 gameplay 已明确排除。

因此 frames2d 侧只保留 7 条轨道（每相位一条），眨眼烘焙进 idle 轨道内部。

### 3.8 sprite2d 契约与 Codex 兼容

- 单元格尺寸默认即 Codex 契约 192x208（schema properties.sprite2d.cell.description 原文如此）。
- columns 默认 8，范围 1 到 32；atlasRows 由 spriteVersionNumber 决定：等于 2 时 11 行（经典 9 行加 2 行视线跟随），否则经典 9 行。
- 行序固定（PET_ROW_ORDER）：
  0 idle、1 running-right、2 running-left、3 waving、4 jumping、5 failed、6 waiting、7 running、8 review。
- frames：每行已用帧数，数组最多 32 项、每项 0 到 32；registry.js 的 buildTracks 用 finiteInt 把每行封顶到 columns（默认 8）——**每行最多 8 帧**。
- tracks：每轨道节奏覆盖（durations、loop、fallback），v1 结构不变。
- 缺省契约表（spriteVersionNumber 与 frames 均缺省时）为 [6,8,8,4,5,8,6,6,6]。

卜卜实际 pet.json 极简：仅 id、displayName、description、spriteVersionNumber（值为 2）、spritesheetPath，未声明 cell、columns、frames、tracks、sequences、remarks，全部走缺省。胡胡的 Codex 兼容版沿用这个极简形态，只额外声明 frames 与 tracks。

### 3.9 相位到动画的映射（state.ts 的 animationForPhase）

thinking 到 running（行 7）；tool 到 running-right（行 1）；review 到 review（行 8）；waiting 到 waiting（行 6）；done 到 jumping（行 4）；failed 到 failed（行 5）；idle 到 idle（行 0）。

因此行 2 running-left 与行 3 waving 不被任何相位选中，只能经 sequences 覆盖触达。

### 3.10 sequences（registry.js 的 normalizeSequences）

- 顶层字段，键必须是七个 ActivityPhase 之一，否则告警丢弃。
- 值为数组，至少 5 项。
- 每项必须是 PET_ROW_ORDER 中的动画名，否则整条丢弃。
- 它只被挂到 sprite2d（及 live2d）的 PetDefinition 上——**frames2d 不使用 sequences**。

这是 sprite2d 变体独有的红利：可用 sequences.idle 把 waving 与 jumping 编进待机循环，实现偶尔挥手、偶尔蹦一下。

### 3.11 引擎原生交互

- 单击：摸头互动等于气泡反馈加亲密度加 1，冷却 10 秒。**不是动画触发器**。
- 拖动：按住拖动换位置，位置持久化。全部宠物通用。
- 隐藏与召唤：悬浮面板按钮。
- 喂食、小鱼干经济、亲密度：引擎自带。
- frames2d 的专属 drag 轨道由 gameplay.dragState 驱动（默认值 drag），不声明 gameplay 就没有拖动动画。

### 3.12 台词：remarks 与 voice.json

- remarks（pet.json 内）覆盖五个槽位：pet、petCooldown、feed、feedCooldown、noTreats。
- voice.json 是宠物目录内的可选文件，另有全局覆盖文件 DSH_HOME/pets/.voice.json。VOICE_PACK_KEYS 为：$schema、voicePackVersion、status、tools、toolRemaining、whispers、panel、remarks、ranks。
- status 池按场景 id（七个 ActivityPhase）逐键覆盖内置池。
- whispers 分 categories 与 results 两个子对象；legacy 的 generic 与 rules 通道已移除。
- panel 含 labels、stats、actions；占位符白名单为 stats 内的 rank、n、points。
- 上限：每池不超过 64 行，每行不超过 160 字符。结构错误 fail-closed，内容错误 warn-and-drop。

### 3.13 官方 CLI 不可用

README 提到 node scripts/dsh-pet validate 与 install，但 package.json 的 files 白名单不含 scripts 目录，已安装的包内没有该 CLI。因此本项目自带校验脚本，对齐 schema 与 registry.js 的判定逻辑。

### 3.14 本机现状

~/.codex/pets/ 下已有 bubu-office 与 taotao-office；~/.codex/config.toml 的 desktop 段当前没有 selected-avatar-id（未选中任何宠物，可安全写入）；~/.dsh/pets/ 不存在。

### 3.15 工具链已验证

Python 3.12.10；Pillow 12.3.0（WEBP 可用）；numpy 2.4.4；GIF 多帧读写可用（参考卜卜 preview 目录的默认办公.gif，6 帧、每帧 280ms）；zipfile 可用。

## 4. 总体架构与产物

单份源资产（帧序列）经构建脚本派生两个宠物目录，再打成单一发布包。脚本全部用 Python 标准库加 Pillow 加 numpy，无其他依赖。

目录布局：

    D:/桌宠/                                   <- 工作区（源）
    +- assets/source/carrot.png               <- 用户实拍图副本（唯一输入）
    +- assets/derived/base.huhu.png          <- 抠好的透明底角色
    +- assets/derived/eye-regions.json       <- 眼区标定（眨眼用）
    +- assets/frames/huhu-carrot/<track>/fNN.webp   <- frames2d 用帧
    +- assets/frames/huhu-carrot-office/spritesheet-win-1.webp  <- sprite2d 图集
    +- tools/
    |  +- extract_base.py    抠图
    |  +- build_frames.py    帧生成
    |  +- build_atlas.py     拼 sprite2d 兼容图集
    |  +- build_manifests.py 生成 pet.json 与 voice.json
    |  +- build_previews.py  预览 GIF 与总览图
    |  +- validate_pet.py    清单与资产校验（对齐 manifest-v2.ts 与 registry.js）
    |  +- package_release.py 打 zip
    +- 胡胡-Windows-10-11/                    <- 发布包根目录
    |  +- pet/huhu-carrot/
    |  +- pet/huhu-carrot-office/
    |  +- 安装胡胡.cmd
    |  +- 卸载胡胡-Windows.cmd
    |  +- VERSION.txt
    |  +- README.md
    |  +- ASSET-NOTICE.md
    +- docs/superpowers/specs/                <- 本文件

发布产物：C:/Users/HUAWEI/Downloads/Huhu-Windows-10-11-1.zip

## 5. 资产管线

### 5.1 源资产

源图为 C:/Users/HUAWEI/.dsh/attachments/v1/objects/08/08e9829a0b59994c060967865de297091232b26ffa78ecee7066138b346d277a（590x537 PNG，无扩展名），复制为 assets/source/carrot.png，全程不再改动原图。

### 5.2 抠图（extract_base.py）

角色是橙色球体加顶部绿叶，背景是绿草地加蓝天，颜色对比强，可程序化分割：

1. HSV 分割：橙色主体 H 在 5 到 30 且 S 不小于 90、V 不小于 90；绿叶 H 在 40 到 90 且 S 不小于 70、V 不小于 80。
2. 形态学开闭运算清噪，取最大连通域为主体，丢弃吊牌（白色）与木棍（左下角）。
3. 主体 mask 高斯模糊 1.2 像素做软边缘，避免硬锯齿。
4. 以主体包围盒裁切，输出 RGBA。

验收：build_previews.py 同时输出一张透明底（棋盘格底纹）预览 PNG，必须肉眼确认无草地或蓝天残留、无主体缺失后才进入下一步。不达标则退化为手动框选加羽化（坐标写死在脚本里，可复现）。

### 5.3 帧生成（build_frames.py）

统一画布 192x208（对齐 Codex 单元格契约）。以 2 倍即 384x416 做变换、再用 LANCZOS 下采样到 192x208 抗锯齿；全部 WEBP lossless、RGBA、透明区域 RGB 清零。所有变换的 pivot 在画布底部中心（96, 208），保证角色站在同一基线上。

frames2d 侧只保留 7 条轨道（见 3.7：未被 phases 映射的轨道永不播放）：

| 轨道 | 帧数 | 帧时长 | loop | 效果 | 实现来源 |
|---|---|---|---|---|---|
| idle | 16 | 前 11 帧 260ms，第 12、13 帧 150ms，后 3 帧 260ms | true | 呼吸缩放 0.985 到 1.015（正弦）加 y 起伏 正负 2 像素；第 12、13 帧烘焙闭眼 | 程序变换 |
| waiting | 6 | 180ms | true | 慢呼吸加左右微移 正负 3 像素（期待姿态） | 程序变换 |
| thinking | 6 | 140ms | true | 轻微后仰负 4 度加慢呼吸 | 程序变换 |
| tool | 8 | 110ms | true | 快速小步（连续微缩加位移，表现忙碌） | 程序变换 |
| review | 6 | 160ms | true | 慢速左右摆 正负 4 度 | 程序变换 |
| done | 4 | 130ms | false，fallback 为 idle | 抛物线小跳加上升拉伸、落地压扁（欢呼） | 程序变换 |
| failed | 4 | 150ms | false，fallback 为 idle | 缩到 0.96 加抖动 正负 1.5 度（丧） | 程序变换 |

帧文件命名 f00.webp 到 fNN.webp，字典序即播放序；清单里显式声明 frames 列表（frameMs 要求 frames 显式给出且等长，见 3.6），不依赖目录列举顺序。

眨眼不是相位（引擎只有 7 个相位），因此烘焙进 idle 轨道内部：idle 循环约 3.94 秒一次，其中约 300 毫秒闭眼，眨眼周期约 3.9 秒。这是唯一无法做到不规则间隔的妥协，如实记录。

### 5.4 sprite2d 兼容图集（build_atlas.py）

按固定行序拼成 8 列 x 9 行 x 192x208 即 1536x1872 的 WEBP lossless 图集，未用格保持全透明：

| 行 | 动画名 | 帧数 | 内容 | 是否被相位选中 |
|---|---|---|---|---|
| 0 | idle | 8 | 呼吸；第 6 帧烘焙闭眼 | 是（idle） |
| 1 | running-right | 8 | tool 轨道内容（忙碌小步） | 是（tool） |
| 2 | running-left | 6 | 左右摇摆 | 否，仅经 sequences 触达 |
| 3 | waving | 6 | 上下轻跳 | 否，仅经 sequences 触达 |
| 4 | jumping | 4 | done 轨道内容（小跳欢呼） | 是（done） |
| 5 | failed | 4 | failed 轨道内容 | 是（failed） |
| 6 | waiting | 6 | waiting 轨道内容 | 是（waiting） |
| 7 | running | 6 | thinking 轨道内容 | 是（thinking） |
| 8 | review | 6 | review 轨道内容 | 是（review） |

清单声明 frames 为 [8, 8, 6, 6, 4, 4, 6, 6, 6]，每项不超过 32 且不超过 columns 即 8，符合 schema 与 registry.js 的 finiteInt 封顶逻辑。

sprite2d 没有独立眨眼轨道，行 0 的第 6 帧即闭眼帧；idle 轨道的 durations 设为约 400ms，使整个循环约 3.2 秒，眨眼周期随之约 3.2 秒。

sprite2d 变体独有的红利：声明 sequences.idle 为 idle、idle、waving、idle、running-left（5 项，全部是 PET_ROW_ORDER 成员），使待机过程中偶发一次轻跳与一次摇摆。frames2d 变体没有这个能力。

### 5.5 预览产物（build_previews.py）

- preview/huhu-static.png：静帧，2 倍放大，Lanczos。
- preview/每轨道一张循环 GIF：非循环轨道末尾接一帧 idle 过渡。
- preview/胡胡动作总览.png：所有轨道首帧拼成的网格总览，对齐卜卜 preview 目录的卜卜动作总览.png 形式。
- preview/atlas-huhu-carrot-office.webp：兼容图集本身，便于肉眼校验格位。
- preview/huhu-transparent-check.png：棋盘格底纹上的抠图结果，专用于 5.2 的验收。

## 6. 行为清单（用户已确认）

| 行为 | 是否实现 | 实现来源 |
|---|---|---|
| 待机呼吸 | 是 | idle 轨道程序变换 |
| 眨眼 | 是，周期约 3.2 到 3.9 秒 | 烘焙进 idle 轨道 |
| 鼠标悬停放大 | 否 | 引擎无悬停钩子，见第 2 节 |
| 单击 | 是，气泡加亲密度加 1 | 引擎原生摸头互动 |
| 双击蹦一下 | 否 | 引擎无双击钩子 |
| 左键拖动换位 | 是，位置持久化 | 引擎原生拖动 |
| 右键菜单 | 否，改由悬浮面板替代 | 引擎无右键钩子 |
| 随机台词气泡 | 是 | voice.json 的 status 池加 remarks |
| 拖拽方向彩蛋 | 否 | 需要 gameplay.dragState，见第 2 节 |
| 跟随会话状态 | 是，七个相位全覆盖 | phases 映射加相位到动画映射 |
| 闲置自动趴桌边 | 否 | 需要 gameplay.idleDirector，见第 2 节 |
| 待机时偶发轻跳与摇摆 | 仅 sprite2d 变体 | sequences.idle |

## 7. 清单契约

### 7.1 pet/huhu-carrot/pet.json（v2 / frames2d / DSH 宠物中心）

| 字段 | 值 |
|---|---|
| $schema | https://schemas.linxin666.org/dsh-pet/pet-manifest-v2.schema.json |
| petManifestVersion | 2 |
| id | huhu-carrot |
| displayName | 胡胡 |
| description | 橙色胡萝卜毛绒玩偶，星星眼、张大嘴；会呼吸、眨眼，并随会话状态变化。 |
| version | 1.0.0 |
| author | a162276220 |
| license | User-supplied source; personal use only |
| homepage | 不声明 |
| renderer | frames2d |
| frames2d.dir | frames |
| frames2d.defaultFrameMs | 200 |
| frames2d.tracks | 七条：idle、waiting、thinking、tool、review、done、failed，逐条参数见 5.3 |
| frames2d.phases | 七个键全部映射到同名轨道：idle 到 idle、waiting 到 waiting、thinking 到 thinking、tool 到 tool、review 到 review、done 到 done、failed 到 failed |
| sequences | 不声明（frames2d 不使用 sequences，见 3.10） |
| remarks | 声明五个槽位，见 7.3 |
| live2d / sprite2d / gameplay | 不声明 |

要点：

- 顶层字段全部落在 3.4 列出的允许清单内，满足 additionalProperties 为 false 的结构 fail-closed 要求。
- phases 显式映射全部七个相位，idle 必填项有值，避免客户端 validateFrames2dConfig 抛错拒载。
- 每条轨道的 frames 与 frameMs 等长显式给出，满足 3.6 的等长要求。
- loop 为 false 的轨道（done、failed）都声明 fallback 为 idle。
- 轨道名全部为 lowercase kebab 且不超过 32 字符；帧文件名 f00.webp 等符合 PATH_SEGMENT_PATTERN。
- 不声明 gameplay、不声明 live2d 与 sprite2d 块。

### 7.2 pet/huhu-carrot-office/pet.json（v1 / sprite2d / Codex 兼容）

刻意不带 petManifestVersion，与卜卜 bubu-office/pet.json 同构，保证 Codex 客户端与 DSH 的 v1 兼容读路径都能吃：

| 字段 | 值 |
|---|---|
| id | huhu-carrot-office |
| displayName | 胡胡 |
| description | 橙色胡萝卜毛绒玩偶，星星眼、张大嘴；会呼吸、眨眼，并随会话状态变化。 |
| spritesheetPath | spritesheet-win-1.webp |
| cell | 不声明（默认即 Codex 契约 192x208） |
| columns | 不声明（默认 8） |
| spriteVersionNumber | 不声明（走经典 9 行契约，不做视线跟随行） |
| frames | [8, 8, 6, 6, 4, 4, 6, 6, 6] |
| tracks | idle 的 durations 约 400ms 使循环约 3.2 秒；jumping 与 failed 设 loop 为 false 且 fallback 为 idle；其余按 5.3 的帧时长 |
| sequences | idle 为 idle、idle、waving、idle、running-left |
| remarks | 与 7.1 相同的五个槽位 |

要点：

- 行 0 即 idle（含烘焙眨眼），行 2 与行 3 仅经 sequences.idle 触达。
- sequences.idle 五项全部是 PET_ROW_ORDER 成员，满足 normalizeSequences 的两条校验（键合法、每项合法、长度不小于 5）。
- durations 是数组，对齐 registry.js 的 DEFAULT_TRACK_PATTERNS 结构与 README 第 47 行示例。
- 图集文件名 spritesheet-win-1.webp 符合 PATH_SEGMENT_PATTERN。

### 7.3 台词设计

remarks（写在 pet.json 内，覆盖引擎的摸头与喂食槽位）：

| 槽位 | 内容 |
|---|---|
| pet | 胡胡的脑袋被你摸到了；嘿嘿，别蹭我叶子啦；再来一次；叶子要竖起来啦 |
| petCooldown | 刚被摸过啦，歇一会儿 |
| feed | 这不是鱼干，但我不挑；谢谢投喂，胡萝卜味的 |
| feedCooldown | 吃不下了，今天糖分超标 |
| noTreats | 我自带糖分，不用投喂啦 |

voice.json（宠物目录内的独立文件，覆盖状态池，实现随机换台词）：

VOICE_PACK_KEYS 为 $schema、voicePackVersion、status、tools、toolRemaining、whispers、panel、remarks、ranks。本规格只声明 voicePackVersion、status、whispers、panel。

- voicePackVersion 为 1。
- status 按七个场景各给 3 到 4 句，全部为胡萝卜语境，不含任何占位符（占位符只允许在 tools 与 stats 内）。
- whispers 分 categories 与 results 两个子对象，只放少量句子；不使用已移除的 legacy generic 与 rules 通道。
- panel.labels 覆盖 feed、hide、rename、confirm 四个按钮标签；panel.stats 使用白名单占位符 rank、n、points；panel.actions 保留 feed、rename、hide 三个动作。
- 每个池不超过 64 行，每行不超过 160 字符。

两只宠物各一份相同内容的 voice.json。

## 8. 发布包与安装器

### 8.1 包结构

zip 根目录即 胡胡-Windows-10-11/，与卜卜约定一致：

    胡胡-Windows-10-11/
    +- pet/huhu-carrot/                    pet.json、voice.json、validation.json、frames 目录下的各轨道帧
    +- pet/huhu-carrot-office/             pet.json、voice.json、validation.json、spritesheet-win-1.webp
    +- 安装胡胡.cmd
    +- 卸载胡胡-Windows.cmd
    +- VERSION.txt
    +- README.md
    +- ASSET-NOTICE.md

排除项：preview、tools、assets、docs、__pycache__、.git、.workbuddy。

VERSION.txt 五行：Package 为 Huhu Windows；Version 为 1；System 为 Windows 10/11；Architecture 为 x64 加 ARM64；Pets 为 huhu-carrot 即 frames2d 与 huhu-carrot-office 即 sprite2d v1 兼容。

ASSET-NOTICE.md：说明角色来自用户提供的一张实拍图，衍生资产仅供个人使用，不含任何第三方代码或资产；宠物引擎属 @linxin666/dsh-pet（Apache-2.0），本项目不修改、不分发该引擎。

### 8.2 安装胡胡.cmd

对齐卜卜 Install-Bubu.cmd 的阶段化加校验纪律：

1. 检测安装器版本标记文件（新增 HUHU-EDITION.txt，内容为一行 edition 等于 huhu-carrot-v1），缺失即拒绝继续。
2. 提示并等待用户关闭正在运行的 DSH 与 Codex（注册表在宿主启动时一次性构建，不重启不生效，见 3.3）；用 pause 让用户手动关闭后按回车继续。
3. 目标目录为 CODEX_HOME 环境变量（未设置时默认 %USERPROFILE%/.codex）下的 pets 子目录；日志放 %LOCALAPPDATA%/HuhuPet/。
4. 对每只宠物：先拷到目标目录下带前导点的临时目录（形如 .%ID%-installing），用 fc.exe /B 字节比对源与目标，全部通过才原子改名到位；失败则删除临时目录并报错，绝不覆盖可用的旧宠物。
5. 写 config.toml：仅当 desktop 段存在或可创建时写入 selected-avatar-id 等于 custom:huhu-carrot-office；写入前先备份为 config.toml.huhu-时间戳.bak。若该键已存在其他值，保留原值并在日志提示已在设置中手动选择其他宠物，不覆盖。
6. 输出到桌面一份脱敏安装日志。

### 8.3 卸载胡胡-Windows.cmd

删除 pets 下的 huhu-carrot 与 huhu-carrot-office 两个目录；若 selected-avatar-id 当前值等于我们写入的值，则还原最近的 huhu 备份（否则不动）；删除日志。

### 8.4 打包纪律

沿用已踩过的坑：用 Python zipfile 打 zip（正斜杠条目名加 UTF-8 flag 0x800），不用 .NET CreateFromDirectory（会写反斜杠条目名导致 unzip 失败）。含中文名，解压校验也用 Python 而非 MSYS unzip。

## 9. 校验与验收

### 9.1 validate_pet.py 检查项

对两只宠物目录各跑一遍，输出 validation.json，ok 为 true 才算通过。检查项：

- 清单结构：字段全部落在 schema 允许集合内（模拟 3.4 的结构 fail-closed）；id 正则与长度；version 三段数字；必填项存在；renderer 枚举合法且对应块存在。
- frames2d：phases 含 idle 且指向存在的轨道；其余六个相位若声明也必须指向存在的轨道；每条轨道 frames 与 frameMs 等长且文件真实存在；frameMs 每项在 16 到 5000；loop 为 false 的轨道 fallback 指向存在且 loop 为 true 的轨道；轨道名符合 lowercase kebab 且不超过 32 字符。
- sprite2d：图集尺寸等于 8 列 x 9 行 x 192x208 即 1536x1872；格式为 WEBP 且模式为 RGBA；每格已用帧的 nontransparent_pixels 大于 0；透明格的 RGB 残差像素等于 0；每行帧数不超过 8；行序与 5.4 表一致。
- sequences：每条至少 5 项，每项都在 PET_ROW_ORDER 内。
- voice.json：合法 JSON、根为对象、字段都在 VOICE_PACK_KEYS 内、status 无非法占位符、每池不超过 64 行、每行不超过 160 字符。
- 帧文件名与图集文件名符合 PATH_SEGMENT_PATTERN。

### 9.2 验收证据清单（交付时逐条附上）

1. 透明底抠图预览 PNG——肉眼确认无背景残留、无主体缺失。
2. 七张轨道 GIF 加一张动作总览 PNG。
3. validate_pet.py 对两只目录均输出 ok 为 true，且各自 validation.json 可读。
4. 两个宠物目录的文件清单加 sha256（CHECKSUMS-SHA256.txt）。
5. zip 用 Python 解压校验，确认正斜杠条目名与中文名不乱码。
6. 装完后 DSH 设置的宠物里出现胡胡，Codex 宠物选择器里也出现胡胡——这一条需要用户重启宿主后确认。

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 抠图残留背景 | 角色四周有绿色或蓝色毛边，观感崩 | 5.2 的透明底预览 PNG 先肉眼验；不达标退化手动框选加羽化 |
| 单张图做动画，动作活但呆 | 没有新表情，只有姿态变化 | 已在设计阶段承认；用 sequences（sprite2d 侧）加 voice.json 台词弥补 |
| v2 清单结构 fail-closed，字段写错就被拒载 | 宠物在 DSH 里不出现且几乎无提示 | 自带 validate_pet.py 对齐 schema 与 registry.js 判定；只把 remarks 与 sequences 的内容错误留给 warn-and-drop |
| frames2d 未映射轨道永不播放 | 多做的动画白做 | 3.7 已明确，frames2d 侧只保留七条轨道 |
| sprite2d 每行超过 8 帧被静默封顶 | 帧被丢弃、动作错乱 | validate_pet.py 校验每行帧数不超过 8 |
| 装完不重启宿主看不到 | 用户以为装失败 | 安装器显式提示；README 第一条就是必须重启 DSH 或 Codex |
| 覆盖用户已有的 Codex 宠物选择 | 静默改回胡胡，用户困惑 | 仅在键不存在时写入；已存在其他值则保留并日志提示；写前备份 |
| zip 中文名乱码或解压失败 | 用户装不上 | Python zipfile；解压校验用 Python 而非 MSYS unzip |
| Codex 客户端不认 v1 清单或缺少 11 行视线行 | 胡胡在 Codex 里不显示 | 走与卜卜同构的极简 v1 形态；缺失视线行只影响视线跟随，不影响播放 |
| 视线跟随行缺失 | 无影响 | 不声明 spriteVersionNumber，走经典 9 行契约 |

## 11. v2 展望

- gameplay 玩法层：dragState 实现拖动专属动画、idleDirector 实现随机小动作、touch 触摸分区实现摸头与摸身体分支、work 与 sleep 循环、passiveIncome、shop。代价：声明 gameplay 后浏览器半侧会自动渲染玩法菜单卡。
- 悬停放大、双击专属动画、拖拽方向彩蛋：需要引擎提供钩子或走 gameplay。
- skins 多皮肤：frames2d.skins 支持 id、label、idleTrack、clickActions，可出叶子乱版等皮肤加概率点击彩蛋台词。
- 语音包扩展：voice.json 的 tools 池可加入工具族文案，toolRemaining 加 n 占位符。
- 11 行视线跟随图集：声明 spriteVersionNumber 为 2，补两行视线跟随帧。
- B 部分：独立桌宠引擎，透明置顶窗加自实现动画、拖拽、开机自启，完全不依赖宿主 App。
- 上线 dsh-market：补 provenance.json。

## 12. 复核要点

请重点看这几处，其余都是勘察事实的直接转录：

1. 第 3 节的事实是否有误——尤其是 3.7（frames2d 只播 phases 映射的轨道）与 3.10（sequences 仅 sprite2d 可用），这两条直接决定了轨道数量与两只宠物的能力差异。
2. 第 5.3 与 5.4 的轨道表、帧数与帧时长是否合理，眨眼周期约 3.2 到 3.9 秒是否可接受。
3. 第 6 节的能力落差标注是否符合预期，被砍掉的行为（悬停、双击、拖拽彩蛋、自动趴桌边）是否需要重新评估。
4. 第 7 节两份清单的字段是否齐全，license 写 User-supplied source; personal use only 是否合适。
5. 第 8 节安装器写 config.toml 的策略（仅键不存在时写入、写前备份、已存在其他值则保留）是否可接受。

