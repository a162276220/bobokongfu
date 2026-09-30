/* ============================================================
   桌宠播放器 · 为淘金矿工小屋·自律工作台提供真实桌宠动画
   ------------------------------------------------------------
   1. 为什么内联契约：工作台以 file:// 打开，fetch()/import 会被
      CORS 拦截，无法运行时读取 pet/ 下的 pet.json。故渲染契约
      由人工从 pet.json 摘取，内联于此常量。改 pet/ 后需手工同步。
   2. 双渲染器，统一接口 mount/play/stop/dispose：
      - Frames2DPlayer：胡胡，50 个独立 PNG，换 <img>.src 驱动
      - SheetPlayer：图集（顿顿/胡胡办公版/打工卜），background-position 驱动
   3. 轨道使用工作台语义名（idle/waiting/thinking/tool/review/done/failed/cheer），
      每只宠物经 PET_SPECS[id].map 映射到自己的资源轨道，缺失回落 idle。
   ============================================================ */
(function (global) {
  'use strict';

  // 资产根目录（相对工作台 HTML；工作台在 淘金矿工小屋/ 下）
  var PET_BASE = '../pet/';

  // 各轨道默认帧时长（无数据时兜底，ms）
  var DEFAULT_FRAME_MS = 200;

  /* ---------- 渲染契约（从 pet/<id>/pet.json 手工摘取） ---------- */
  var PET_SPECS = {
    // 胡胡：frames2d，50 帧 / 7 轨
    'huhu-carrot': {
      name: '胡胡',
      kind: 'frames2d',
      cells: { w: 192, h: 208 },
      frames2d: {
        dir: 'huhu-carrot/frames',
        defaultFrameMs: 200,
        tracks: {
          idle:     { frames: ['f00.png','f01.png','f02.png','f03.png','f04.png','f05.png','f06.png','f07.png','f08.png','f09.png','f10.png','f11.png','f12.png','f13.png','f14.png','f15.png'], ms: [260,260,260,260,260,260,260,260,260,260,260,150,150,260,260,260], loop: true },
          waiting:  { frames: ['f00.png','f01.png','f02.png','f03.png','f04.png','f05.png'], ms: [180,180,180,180,180,180], loop: true },
          thinking: { frames: ['f00.png','f01.png','f02.png','f03.png','f04.png','f05.png'], ms: [140,140,140,140,140,140], loop: true },
          tool:     { frames: ['f00.png','f01.png','f02.png','f03.png','f04.png','f05.png','f06.png','f07.png'], ms: [110,110,110,110,110,110,110,110], loop: true },
          review:   { frames: ['f00.png','f01.png','f02.png','f03.png','f04.png','f05.png'], ms: [160,160,160,160,160,160], loop: true },
          done:     { frames: ['f00.png','f01.png','f02.png','f03.png'], ms: [130,130,130,130], loop: false, fallback: 'idle' },
          failed:   { frames: ['f00.png','f01.png','f02.png','f03.png'], ms: [150,150,150,150], loop: false, fallback: 'idle' }
        }
      },
      map: { idle: 'idle', waiting: 'waiting', thinking: 'thinking', tool: 'tool', review: 'review', done: 'done', failed: 'failed', cheer: 'done' }
    },

    // 墩墩：sprite2d 图集，8 列 × 9 行
    'dundun-office': {
      name: '墩墩',
      kind: 'sheet',
      cells: { w: 192, h: 208 },
      sheet: {
        file: 'dundun-office/spritesheet-dundun.png',
        cols: 8,
        frames: [8, 8, 6, 6, 4, 4, 6, 6, 6],
        rowNames: ['idle','running-right','running-left','waving','jumping','failed','waiting','running','review'],
        tracks: {
          idle:          { ms: [400,400,400,400,400,400,400,400] },
          'running-right':{ ms: [110,110,110,110,110,110,110,110] },
          'running-left': { ms: [160,160,160,160,160,160] },
          waving:        { ms: [140,140,140,140,140,140] },
          jumping:       { ms: [130,130,130,130] },
          failed:        { ms: [150,150,150,150], loop: false, fallback: 'idle' },
          waiting:       { ms: [180,180,180,180,180,180] },
          running:       { ms: [140,140,140,140,140,140] },
          review:        { ms: [160,160,160,160,160,160] }
        }
      },
      map: { idle: 'idle', waiting: 'waiting', thinking: 'running', tool: 'running', review: 'review', done: 'waving', failed: 'failed', cheer: 'jumping' }
    },

    // 胡胡·办公：sprite2d 图集，8 列 × 9 行（同一套图集行序）
    'huhu-carrot-office': {
      name: '胡胡·办公',
      kind: 'sheet',
      cells: { w: 192, h: 208 },
      sheet: {
        file: 'huhu-carrot-office/spritesheet-win-1.png',
        cols: 8,
        frames: [8, 8, 6, 6, 4, 4, 6, 6, 6],
        rowNames: ['idle','running-right','running-left','waving','jumping','failed','waiting','running','review'],
        tracks: {
          idle:          { ms: [400,400,400,400,400,400,400,400] },
          'running-right':{ ms: [110,110,110,110,110,110,110,110] },
          'running-left': { ms: [160,160,160,160,160,160] },
          waving:        { ms: [140,140,140,140,140,140] },
          jumping:       { ms: [130,130,130,130] },
          failed:        { ms: [150,150,150,150], loop: false, fallback: 'idle' },
          waiting:       { ms: [180,180,180,180,180,180] },
          running:       { ms: [140,140,140,140,140,140] },
          review:        { ms: [160,160,160,160,160,160] }
        }
      },
      map: { idle: 'idle', waiting: 'waiting', thinking: 'running', tool: 'running', review: 'review', done: 'waving', failed: 'failed', cheer: 'jumping' }
    },

    // 打工卜：webp 图集，11 行（含 gaze）；无逐行帧数/时长，运行时按图集尺寸推导
    'raccoon-typing': {
      name: '打工卜',
      kind: 'sheet',
      cells: { w: 192, h: 208 },
      sheet: {
        file: 'raccoon-typing/spritesheet.webp',
        cols: null,        // 运行时从 naturalWidth/cell.w 推导
        frames: null,      // 缺失 → 每行默认 cols 帧
        rowNames: ['idle','running-right','running-left','waving','jumping','failed','waiting','running','review','gaze-1','gaze-2'],
        tracks: {}
      },
      map: { idle: 'idle', waiting: 'waiting', thinking: 'running', tool: 'running', review: 'review', done: 'waving', failed: 'failed', cheer: 'jumping' }
    }
  };

  /* ============================================================
     Frames2DPlayer —— 散图换 src
     ============================================================ */
  function Frames2DPlayer(spec) {
    this.spec = spec;              // PET_SPECS[id]
    this.cells = spec.cells;
    this.dir = spec.frames2d.dir;
    this.tracks = spec.frames2d.tracks;
    this.map = spec.map || {};
    this.el = null;
    this.img = null;
    this.timer = null;
    this.currentTrack = null;
    this.cache = {};               // frameName -> Image
  }

  Frames2DPlayer.prototype.mount = function (el) {
    this.el = el;
    if (!this.img) {
      this.img = document.createElement('img');
      this.img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;image-rendering:auto;';
    }
    el.innerHTML = '';
    el.appendChild(this.img);
  };

  Frames2DPlayer.prototype._file = function (trackName, frameName) {
    return PET_BASE + this.dir + '/' + trackName + '/' + frameName;
  };

  Frames2DPlayer.prototype._image = function (src) {
    if (this.cache[src]) return this.cache[src];
    var im = new Image();
    im.src = src;
    this.cache[src] = im;
    return im;
  };

  Frames2DPlayer.prototype.play = function (semanticTrack, fallbackSemantic) {
    var raw = this.map[semanticTrack] || 'idle';
    var track = this.tracks[raw];
    if (!track) { track = this.tracks.idle; raw = 'idle'; }
    this.currentTrack = raw;
    var self = this;
    var frames = track.frames;
    var ms = track.ms || [];
    var i = 0;

    function step() {
      if (!self.el || !self.img) return;
      // 容器已离开文档（切页整体重渲染）：停掉定时器，避免在游离节点上空转累积
      if (!self.el.isConnected) { self.stopTimer(); return; }
      var src = self._file(raw, frames[i]);
      var im = self._image(src);
      im.onload = (function (fr) { return function () { if (self.img) self.img.src = fr; }; })(src);
      if (im.complete) self.img.src = src; // 已缓存则立即
      var dur = ms[i] != null ? ms[i] : DEFAULT_FRAME_MS;
      i = (i + 1) % frames.length;
      if (!track.loop && i === 0) {
        // once 型播完：落回当前状态（fallbackSemantic 优先），否则用 spec 固定回落
        var fbRaw = fallbackSemantic ? self.map[fallbackSemantic] : track.fallback;
        if (fbRaw && fbRaw !== raw && self.tracks[fbRaw]) { self.play(fbRaw); return; }
        self.stop(); return;
      }
      self.timer = setTimeout(step, dur);
    }

    self.stopTimer();
    if (frames.length === 1) { step(); return; }
    step();
  };

  Frames2DPlayer.prototype.stopTimer = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  };

  Frames2DPlayer.prototype.stop = function () { this.stopTimer(); this.currentTrack = null; };

  Frames2DPlayer.prototype.dispose = function () {
    this.stopTimer();
    if (this.chainTimer) { clearTimeout(this.chainTimer); this.chainTimer = null; }
    if (this.bumpTimer) { clearTimeout(this.bumpTimer); this.bumpTimer = null; }
    this.img = null; this.el = null; this.cache = {};
  };

  /* ============================================================
     SheetPlayer —— 图集 background-position
     ============================================================ */
  function SheetPlayer(spec) {
    this.spec = spec;
    this.cells = spec.cells;
    this.sheet = spec.sheet;
    this.map = spec.map || {};
    this.el = null;
    this.img = null;               // 底层 <img> 用于推导 natural 尺寸
    this.bg = null;                // 动画背景层
    this.timer = null;
    this.currentTrack = null;
    this.cols = this.sheet.cols || 8;
    this.rows = this.sheet.rowNames.length;
    this.framesPerRow = this.sheet.frames || null;
    this.loaded = false;
    this.naturalW = 0;
    this.naturalH = 0;
    this.scale = 1;
  }

  SheetPlayer.prototype.mount = function (el) {
    this.el = el;
    if (!this.bg) {
      var img = document.createElement('img');
      img.src = PET_BASE + this.sheet.file;
      img.style.cssText = 'opacity:0;position:absolute;left:-9999px;top:-9999px;pointer-events:none;';
      this.img = img;
      document.body.appendChild(img);

      var bg = document.createElement('div');
      bg.style.cssText = 'width:100%;height:100%;background-repeat:no-repeat;background-image:url("' + (PET_BASE + this.sheet.file) + '");';
      this.bg = bg;
    }
    this._measure();
    el.innerHTML = '';
    el.style.overflow = 'hidden';
    el.appendChild(this.bg);
    this._layout();
  };

  SheetPlayer.prototype._measure = function () {
    if (!this.img) return;
    var w = this.img.naturalWidth;
    var h = this.img.naturalHeight;
    if (w && h) {
      this.naturalW = w;
      this.naturalH = h;
      this.cols = this.sheet.cols || Math.round(w / this.cells.w);
      this.rows = Math.round(h / this.cells.h);
      this.loaded = true;
      this._layout();
    }
  };

  // 把整张图集缩放到「单个单元格恰好 contain 进容器」的尺寸，再按列/行偏移选帧；
  // 否则 192×208 的单元格在 76px 的容器里只会被裁掉一角。
  SheetPlayer.prototype._layout = function () {
    if (!this.bg || !this.el) return;
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    var nw = this.naturalW || (this.cols * this.cells.w);
    var nh = this.naturalH || (this.rows * this.cells.h);
    if (!nw || !nh) return;
    var scale = Math.min(w / this.cells.w, h / this.cells.h);
    this.scale = scale;
    this.bg.style.backgroundSize = (nw * scale) + 'px ' + (nh * scale) + 'px';
  };

  SheetPlayer.prototype._frameCount = function (rowIndex) {
    if (this.framesPerRow && this.framesPerRow[rowIndex] != null) return this.framesPerRow[rowIndex];
    return this.cols || 8;
  };

  SheetPlayer.prototype._raw = function (semanticTrack) {
    var raw = this.map[semanticTrack] || 'idle';
    var idx = this.sheet.rowNames.indexOf(raw);
    return { raw: raw, index: idx < 0 ? 0 : idx };
  };

  SheetPlayer.prototype.play = function (semanticTrack, fallbackSemantic) {
    var self = this;
    var r = this._raw(semanticTrack);
    var row = this._frameCount(r.index);
    var track = this.sheet.tracks[r.raw];
    var loop = true, fallback = null, ms = null;
    if (track) {
      if (track.loop === false) loop = false;
      if (track.fallback) fallback = track.fallback;
      if (track.ms) ms = track.ms;
    }
    var frameCount = row;
    var i = 0;

    function step() {
      if (!self.el || !self.bg) return;
      // 容器已离开文档（切页整体重渲染）：停掉定时器，避免在游离节点上空转累积
      if (!self.el.isConnected) { self.stopTimer(); return; }
      var dur = (ms && ms[i] != null) ? ms[i] : DEFAULT_FRAME_MS;
      var s = self.scale || 1;
      var x = -((i % self.cols) * self.cells.w * s);
      var y = -(r.index * self.cells.h * s);
      self.bg.style.backgroundPosition = x + 'px ' + y + 'px';
      i = (i + 1) % frameCount;
      if (!loop && i === 0) {
        var fb = fallbackSemantic ? self.map[fallbackSemantic] : fallback;
        if (fb && fb !== r.raw && self.map[fb]) { self.play(fb); return; }
        self.stop(); return;
      }
      self.timer = setTimeout(step, dur);
    }

    self.stopTimer();
    self.currentTrack = r.raw;
    if (!self.loaded) {
      // 图集未加载完成：等 onload 后播
      this.img.onload = function () { self._measure(); if (self.currentTrack === r.raw) self.play(semanticTrack); };
      return;
    }
    if (frameCount === 1) { step(); return; }
    step();
  };

  SheetPlayer.prototype.stopTimer = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  };

  SheetPlayer.prototype.stop = function () { this.stopTimer(); this.currentTrack = null; };

  SheetPlayer.prototype.dispose = function () {
    this.stopTimer();
    if (this.chainTimer) { clearTimeout(this.chainTimer); this.chainTimer = null; }
    if (this.bumpTimer) { clearTimeout(this.bumpTimer); this.bumpTimer = null; }
    if (this.bg && this.bg.parentNode) this.bg.parentNode.removeChild(this.bg);
    if (this.img && this.img.parentNode) this.img.parentNode.removeChild(this.img);
    this.bg = null; this.img = null; this.el = null;
  };

  /* ============================================================
     渲染器工厂
     ============================================================ */
  function createPlayer(petId) {
    var spec = PET_SPECS[petId];
    if (!spec) return null;
    return spec.kind === 'frames2d' ? new Frames2DPlayer(spec) : new SheetPlayer(spec);
  }

  /* ============================================================
     PetManager —— 模块级单例，管理所有播放实例
     ------------------------------------------------------------
     关键：实例按 petId 存于 Map，与 DOM 分离。工作台 navTo 会整体
     重渲染，重渲染后按 petId 复用实例，只重新 mount 到新容器。
     切页不会重置动画，也不会累积 setTimeout。
     ============================================================ */
  var players = {};           // petId -> player（一个 petId 一个实例）

  // 状态 → 语义轨道解析（优先级从高到低，对应设计 §6）
  function resolveTrack(pet, anyCheckedToday) {
    if (pet.hunger < 30 || pet.mood < 30 || pet.health < 50) return 'failed';
    if (!anyCheckedToday) return 'waiting';
    return 'idle';
  }

  function mount(rootEl, ctx) {
    if (!rootEl) return;
    var pets = ctx.pets || [];
    var anyCheckedToday = !!ctx.anyCheckedToday;
    var stages = rootEl.querySelectorAll('[data-petid]');
    Array.prototype.forEach.call(stages, function (stage) {
      var petId = stage.getAttribute('data-petid');
      var pet = pets.find(function (p) { return p.petId === petId; });
      if (!pet) return;
      var player = players[petId];
      if (!player) { player = createPlayer(petId); players[petId] = player; }
      if (!player) return;
      player.mount(stage);
      player.play(resolveTrack(pet, anyCheckedToday));
    });
  }

  // 语义轨道是否为 loop 型（done/failed 是 once，其余默认 loop）
  function _trackLoop(player, semantic) {
    var raw = player.map ? (player.map[semantic] || 'idle') : semantic;
    var t = null;
    if (player.tracks) t = player.tracks[raw];                 // Frames2DPlayer
    else if (player.sheet && player.sheet.tracks) t = player.sheet.tracks[raw]; // SheetPlayer
    return t ? t.loop !== false : true;
  }

  // 播放一次瞬时轨道（喂食 done / 抚摸 review / 打卡 done）
  // pet 是 state.pets 里的条目（含 petId/hunger/mood/health），播完落回当前状态
  function playTransient(pet, track, anyCheckedToday) {
    var player = players[pet.petId];
    if (!player) return;
    var base = resolveTrack(pet, anyCheckedToday);
    player.play(track, base);
    // once 型轨道（done/failed）会自行落回 base；loop 型（review/thinking/tool）不会，限时拉回
    if (_trackLoop(player, track)) {
      if (player.bumpTimer) clearTimeout(player.bumpTimer);
      player.bumpTimer = setTimeout(function () {
        player.bumpTimer = null;
        player.play(base);
      }, 1600);
    }
  }

  // 打卡成功动画链：thinking → tool → done → 落回当前状态
  // 每只宠物只保留一个 chainTimer，重复触发会先清掉旧的，避免定时器累积
  function playChain(pet, anyCheckedToday) {
    var player = players[pet.petId];
    if (!player) return;
    if (player.chainTimer) clearTimeout(player.chainTimer);
    if (player.bumpTimer) { clearTimeout(player.bumpTimer); player.bumpTimer = null; }
    var base = resolveTrack(pet, anyCheckedToday);
    var stage = 0;
    player.play('thinking', base);
    function advance() {
      stage++;
      if (stage === 1) player.play('tool', base);
      else if (stage === 2) { player.play('done', base); player.chainTimer = null; return; }
      player.chainTimer = setTimeout(advance, 1200);
    }
    player.chainTimer = setTimeout(advance, 1200);
  }

  function destroy(petId) {
    var player = players[petId];
    if (player) { player.dispose(); delete players[petId]; }
  }

  // 静态缩略图：商城格子 / 命名弹窗用（桌宠在未领养前不在 state.pets 里，无法挂动画播放器）
  function thumb(petId, size) {
    var spec = PET_SPECS[petId];
    if (!spec) return '';
    if (spec.kind === 'frames2d') {
      return '<img src="' + PET_BASE + spec.frames2d.dir + '/idle/f00.png" alt="" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;display:block;margin:0 auto;">';
    }
    var cellW = spec.cells.w, cellH = spec.cells.h;
    var cols = spec.sheet.cols || 8;
    var rows = spec.sheet.rowNames.length;
    var scale = Math.min(size / cellW, size / cellH);
    return '<div style="width:' + size + 'px;height:' + size + 'px;background-image:url(\'' + PET_BASE + spec.sheet.file + '\');background-size:' + (cellW * cols * scale) + 'px ' + (cellH * rows * scale) + 'px;background-position:0 0;background-repeat:no-repeat;display:block;margin:0 auto;"></div>';
  }

  global.PetManager = { mount: mount, playTransient: playTransient, playChain: playChain, destroy: destroy, resolveTrack: resolveTrack, createPlayer: createPlayer, thumb: thumb, specs: PET_SPECS, players: players };

})(window);
