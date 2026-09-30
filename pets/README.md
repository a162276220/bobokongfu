# pets/ = 配方；pet/ = 产物

`pet/<id>/` 是引擎真正加载的宠物目录。`pets/<id>.json` 是**一只角色**的构建配方：
一张底图 + 一份配置，描述它有几个宿主产物、每套动作怎么动、清单与台词写什么。
构建、校验、QA 只有一条入口：

```bash
PY="C:/Users/HUAWEI/AppData/Local/Programs/Python/Python312/python.exe"
"$PY" tools/build_pet.py                 # 全部配方，按依赖顺序
"$PY" tools/build_pet.py huhu-carrot     # 只做一只角色
"$PY" tools/build_pet.py --list          # 看看有哪些配方
"$PY" tools/build_pet.py --stage sprite2d --no-qa
```

四个 stage 依次是 `frames2d` → `sprite2d` → `manifests` → `previews`，每个 stage
**只读上一个 stage 落盘的东西**，所以任何一步都能单独重跑（旧的
`tools/build_frames.py` 等脚本现在就是这么用的一行封装）。全部配方跑完会再写一份
跨宠物总览 `preview/gallery.html`（见下文）。

| stage | 读 | 写 |
|---|---|---|
| `frames2d` | `base` + `eyes` + `tracks` | `pet/<id>/frames/**.png`、`assets/derived/frames-spec.json` |
| `sprite2d` | 上面那批帧 + `rows` | `pet/<id>/<spritesheet>`、`assets/derived/atlas-spec.json` |
| `manifests` | 配方本身 | `pet/<id>/pet.json`、`voice.json` |
| `previews` | 帧 + 图集 | `preview/`（classic 款）或 `pet/<id>/preview/`（pack / sheet 款） |

## 新增一只宠物

1. 把底图放成 `assets/derived/base.<名字>.png` —— **192×208 RGBA**，角色站在
   y≈199 的基线上（`tools/extract_base.py` 抠实拍图，`tools/build_dundun_pet.py`
   示范程序化画底图）。
2. 新建 `pets/<名字>.json`，最小可用版本：

```json
{
  "id": "my-pet",
  "displayName": "我的宠物",
  "description": "一句话描述。",
  "base": "assets/derived/base.mypet.png",
  "outputs": {
    "sprite2d": { "spritesheet": "spritesheet.png", "rows": "default" }
  },
  "previews": { "style": "pack", "dir": "pet/my-pet/preview" }
}
```

`rows: "default"` 就是九行标准动作包（呼吸、蹦跳、摇摆、失败塌陷），幅度取自实测
参考动作，因此**不写任何动作也能出成品**。跑一遍 `tools/build_pet.py my-pet` 就有
图集、清单和预览页。
3. 想改动作、加台词、加语音包，就照 `pets/huhu-carrot.json`、`pets/dundun-office.json` 写。

## 顶层字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 必须等于文件名；小写 kebab，≤64 字符 |
| `displayName` / `description` | ✓ | 进 `pet.json`，留空即报错 |
| `base` | 渲染时必填 | 底图路径，相对仓库根；必须是 192×208 RGBA |
| `eyes` | | 眼区 `[[cx,cy,w,h], ...]` 或指向 JSON 文件的路径；眨眼要用它 |
| `outputs` | ✓ | `frames2d` / `sprite2d` 块，至少一个 |
| `version` / `author` / `license` | ✓(frames2d) | 只进 v2 清单，三段式版本号 |
| `remarks` | | 五个槽位 `pet`/`petCooldown`/`feed`/`feedCooldown`/`noTreats` |
| `voice` | | 语音包内容，写进该角色的每个宠物目录 |
| `previews` | | 见下 |

## 动作：channel

每条 track/row 要么给 `poses`（逐帧写死变换参数），要么给 `motion`（一串
channel，按帧求值）。两者只需其中一个；帧数由 `frameMs`/`durations` 的长度决定
（`{"value": ms, "override": {帧号: ms}, "count": n}` 是紧凑写法）。

channel 字段：`target`（`scale`/`dx`/`dy`/`rotate_deg`/`squash_x`/`squash_y`）、
`kind`、`offset`（静止值，缩放类为 1.0、位移旋转类为 0.0）、`amp`、`cycles`、
`phase`、`warp`（仅 `arc`）、`values`（仅 `values`）、`of`（仅 `volume`）。

| kind | 求值 |
|---|---|
| `const` | `offset` |
| `sin` | `offset + amp*sin(2π*cycles*i/n + phase)` |
| `cos` | `offset + amp*cos(...)` |
| `raised-cos` | `offset + amp*(0.5 − 0.5*cos(...))` —— 单向呼吸 |
| `square` | `offset + amp*(cos(...) ≥ 0 ? 1 : 0)` —— 隔帧交替 |
| `arc` | `offset + amp*sin(π*(i/(n−1))**warp)` —— 一次性起跳 |
| `values` | `offset + amp*vectors[name][i]` —— 手绘曲线 |
| `volume` | `offset − amp*(别的 channel − offset)` —— 毛绒挤压的体积补偿 |

`vectors` 是同一 track 内的命名数组（同一个数组可以被多条 channel 共用，例如
`waving` 的 lift 同时驱动 dy 与双向挤压）。`blink` 写 `{帧号: 0..1}` 或逐帧数组；
`blinkStage` 决定闭眼画在变换前（胡胡）还是变换后（墩墩，眼的中心会跟着正向仿射
映射过去）。

## 输出块

`frames2d`：`petId`、`dir`（默认 `frames`）、`defaultFrameMs`、`spec`（写出的
`frames-spec.json` 路径，可省）、`tracks`、`phases`（省掉就按七个相位同名映射）、
`blinkStage`。

`sprite2d`：`petId`、`spritesheet`、`spec`、`sequences`、`rowNames`（默认九个经典
行名）、`spriteVersionNumber`、`blinkStage`、`rows`。逐行三选一：

- `{"from": "<frames2d track>"}` —— 直接**复制**那个轨道的帧文件（`running-right`
  复用 `tool`），复制而非重渲染，所以图集那一行与帧文件逐字节相同；
- `{"motion": [...]}` / `{"poses": [...]}` —— 从底图现渲染；
- `{"source": "sheet"}`（块级）—— 图集由外部提供，本构建不碰它，只生成清单
  （`打工卜` 的 11 行 `spritesheet.webp` 就是这种）。

清单里的 `tracks` 由 `rows` 推导（`durations`，`loop: false` 的行再加
`fallback`），所以**不要在 `sprite2d` 里另写一份 `tracks`**；只有 `source: "sheet"`
的外部图集才需要手写。

渲染出来的宠物会在清单里声明 `cell`/`columns`/`frames`（这三个值来自它自己的
图集，可回读校验）；外部图集的宠物三者都不声明，走引擎默认值。

`previews`：`style` 三选一，共同点是**预览都从产物自身的像素来，不重画**：

- `classic`（胡胡那套）：2× 静帧、逐轨道 GIF、总览格、图集拷贝、棋盘格透明检查，
  落在仓库根 `preview/`；
- `pack`（墩墩那套）：GIF + contact sheet，从自己刚画出来的图集里切片，所以预览
  不可能与图集走样；
- `sheet`（打工卜那套）：图集是**外部提供**的（`sprite2d.source: "sheet"`），GIF、
  contact sheet 与页面全部从那个文件里切片，构建不碰图集一个字节，因此这个样式
  **不需要底图**。每行的帧数取自清单 `frames`，清单没写就数「这一行画了哪些格」；
  播放类型取自清单 `tracks`（`loop` / `once` / `set`）；每帧时长优先用清单声明的
  `durations`，没有就套引擎对该行名的默认节奏，两样都没有（例如姿态集 `gaze-*`）
  才退到 `frameMs`（默认 200）。

三种样式都会再写一份自制预览页：

- 顶部是状态缩略图排（点一下跳到该状态）；
- 每个状态一张卡片：**状态名 + 帧数 + 循环/一次性 + 总时长**，播放器可暂停、单步、
  拖进度到任意帧，节奏用的是配方里那一帧自己的时长，实时显示「第 n/N 帧 · x ms」，
  下面一排缩略图点一下即可跳帧；一次性状态播到尾会停住，再点播放从头来；
- 底部「叠图检查」面板：选状态与帧，把底图按可调透明度叠在帧上，带 y=199 基线与
  x=96 中心参考线，可切「叠加 / 差值 / 只看帧」三种模式查对齐。

`page` 覆盖页面文件名（classic 默认 `<id>.html`，pack / sheet 默认 `preview.html`）。
`after` 列出预览 GIF 末尾补一帧 idle 的行/轨道，默认是声明了 `loop: false` 的那些；
它也决定页面上把哪些状态标成「一次性」。`atlas` 覆盖预览目录里那份图集拷贝的名字
（sheet 样式按原后缀拷一份，方便肉眼比格位）。页面是一个自包含文件（图片全部内联
data URI），双击就能开，不依赖任何服务器或同级文件。

页面上「叠图检查」那层参考图取的是 hero 里第一张图：渲染出来的宠物是自己的底图，
外部图集的宠物则是它的第一行第一帧（这一张直接复用页面里已经内联的那一帧，不会再
内联一份）。

## 跨宠物总览

全量构建会顺带刷新 `preview/gallery.html`：同一状态同一行，一列一只宠物，用来横向
看出哪只的某个状态几乎不动。只构建某一只（`build_pet.py <id>`）时不会写它，
`--gallery` 可以强制，`--no-gallery` 可以关掉：

```bash
"$PY" tools/build_gallery.py                      # 只刷这一页，不重跑构建
"$PY" tools/build_gallery.py --out preview/g.html
"$PY" tools/build_gallery.py pet/dundun-office pet/raccoon-typing
```

它读的是 `pet/<id>/` 这个**产物**（用 `qa_check.load_grid`，和 QA 同一套读法），
每个状态内联成一条无损 WebP 长图，所以一页一态只有一张图，任何帧都不重画。每格底下
两个数是同一批像素算出来的：**变化像素**（按透明度预乘、任一通道变化超过 16 的像素
占比）与**起伏**（轮廓最低一行的上下位移），每行的「本行最静」标签标的是这一行里变化
像素最少的那只（帧逐字节相同的两只并列）。顶部排行榜只统计九态里该宠物有的那些，
所以胡胡的 frames2d 版（4 态）和图集版（9 态）不是同一个分母。

变化像素低于 **25%**（`gallery.WEAK_SHARE`）的格子会被自动放大 1.14 倍、框成橙色
并标「动作太小」；同一批状态会进「这只该加动作」清单，每个按钮点一下就把对应格子滚到
屏幕中间闪一下。阈值是绝对值而不是各宠物自己的相对值，所以同一个数在每一列含义相同；
一只都没有时，那一行会直接写「没有低于 25% 的状态」。

## 校验

构建完会自动跑 `tools/validate_pet.py`（清单与几何契约）和 `tools/qa_check.py`
（像素级 rubric），逐只宠物目录各写 `validation.json` 与 `qa/review.json`。
`--no-validate` / `--no-qa` 可跳过，`--strict` 把 QA 的警告也算失败。
