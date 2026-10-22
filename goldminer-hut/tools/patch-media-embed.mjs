/* 构建期补丁：把新版新媒体工作台嵌进「卜卜小屋」的壳里。

   背景：卜卜小屋的源文件还有另一个写者（phase 系列）会整份重写，不能直接改源文件；
   所以和同步层一样，补丁打在 dist/index.html 上。

   做八件事：
   1. 把 shell 的 media 页面从旧版 renderMedia 换成 renderMediaShell（iframe 嵌入 /newmedia?embed=1）；
   2. 进入 media 时给 body 加 nm-embed-page，让主内容区让出全部高度、避免双层滚动；
   3. 主壳看板/周报/月报/计划日历改读 nm_shell_summary_v1（新版每次落盘写的只读摘要）；
   4. 旧版简版媒体页保留为独立导航项 media-classic（「媒体流水线」），数据仍走 state.media；
   5. 旧版媒体页的本地模板与真实模型提示词去主题绑定（原模板写死少儿选课场景），把关中心预览渲染 Markdown；
   6. 旧版媒体页的 AI 引擎配置不再被版本迁移清空（migrateState 保留 media），部分填写时明确提示缺什么；
   7. 旧版媒体页的灵感候选区支持按来源筛选（全部/微博热搜/小红书热榜…），「全部采纳/忽略」只作用于当前筛选；状态文案更新为四来源；
   8. 旧版媒体页 AI 引擎：打回重写同样走真实模型；直连失败不再静默（原因写进任务/成稿）；新增「测试连接」按钮；AI 未完成时阻止合成成稿，避免把模板稿当成品；
   9. 任何锚点找不到或重复 → 失败退出，不发布「看着正常、其实没嵌进去」的站点。
*/

const MUST_HAVE = [
  'function renderMediaShell()',
  "'media':           () => renderMediaShell(),",
  "'media-classic':   () => renderMedia(),",
  "{ key: 'media-classic', name: '媒体流水线', icon: '🗂️' },",
  "'media-classic':'媒体流水线',",
  '<div class="mh-title">媒体流水线</div>',
  "if (p === 'media' && window.currentPage === 'media-classic') p = 'media-classic';",
  "document.body.classList.toggle('nm-embed-page', page === 'media');",
  'function nmShellMediaItems(s)',
  '.nm-embed-frame',
  'const wip = nmShellMediaItems(s)',
  'const items = nmShellMediaItems(state);',
  'nmShellMediaItems(s).forEach',
  '## 第一层：事实是什么',
  '热度会过去，结构会留下',
  "'<div class=\"mf-pre\">' + mfMd2Html(c.body",
  '短图文产线输出 JSON',
  'newState.media = oldState.media || newState.media;',
  "'已保存 Key · 还差 API Base 才能启用'",
  "MediaAI.cfg().apiKey || MediaAI.cfg().apiBase ? ''",
  "s.spark.platFilter = s.spark.platFilter || 'all';",
  'function sparkPlatOf(src) {',
  'window.sparkPlat = sparkPlat;',
  "'本地模式：定时任务每天 17:00 抓 B站/百度/微博/小红书热搜。'",
  "'<span class=\"spk-plats\">'",
  '.utp-act.on {',
  "const done = function (txt, reason) { if (cb) cb(txt, reason); };",
  "tt.error = 'AI 调用失败：' + (reason || '未知原因')",
  "dd.aiNote = 'AI 调用失败：' + (reason || '未知原因')",
  'onclick="mfTestAI()"',
  'function mfTestAI() {',
  '真实模型还在写，等覆盖完成再点「合成成稿」',
  'cloudFresh: function () { return this.cloud.checked',
  'const target = this.activeCloud()',
  "showToast('✓ 云端代理连接正常",
  'MediaAI.probeCloud(function () {',
  '.mf-task.is-done',
  'class="tk-error"',
  'class="mf-steps"',
  'page-content page-',
  'function ipSyncPets(s)',
  'function ipOpenPets()',
  'class="ip-pet-picker"',
  'ip-avatar-pet',
  'class="ip-badge"',
  'id="ipName2"',
  'function mfGenerateImage(taskId, force)',
  'function mfSpeakText(text)',
  'function mfPetRefDataUrl(petId)',
  '宠物参考图',
  'class="tk-image"',
  'tk-img-error',
  '/api/ai/image',
  'function mfVideoStart(cid)',
  'function mfVideoPoll(cid, n)',
  'mf-video-status',
  '🎬 生成视频',
  'function mfTtsStart(cid)',
  'function mfHydrateTts()',
  'data-tts-id',
  '⬇ 下载语音',
  '/api/ai/tts',
  'function mfListModels()',
  'onclick="mfListModels()"',
];

const PATCHES = [
  {
    name: '1. 嵌入页样式',
    old: `</style>
</head>`,
    new: `  /* ===== 新媒体工作台（新版）嵌入页：iframe 占满主内容区 ===== */
  body.nm-embed-page .main-content { padding: 0; overflow: hidden; }
  body.nm-embed-page .main-content > .page-content { height: 100%; animation: none; }
  .nm-embed-shell { height: 100%; min-height: 0; background: #f1e9d8; }
  .nm-embed-frame { display: block; width: 100%; height: 100%; border: 0; background: #f1e9d8; }
  @media (max-width: 768px) {
    body.nm-embed-page .main-content { padding: 0 0 calc(66px + env(safe-area-inset-bottom)); }
  }
</style>
</head>`,
  },
  {
    name: '2. 媒体页渲染器改为嵌入页，旧版保留为 media-classic',
    old: `    'media':           () => renderMedia(),`,
    new: `    'media':           () => renderMediaShell(),
    'media-classic':   () => renderMedia(),`,
  },
  {
    name: '3. 进出媒体页时切换全高模式',
    old: `    currentPage = page;
    window.currentPage = page;   // 供外部模块（jianghu.js）判断该不该重渲染`,
    new: `    currentPage = page;
    window.currentPage = page;   // 供外部模块（jianghu.js）判断该不该重渲染
    document.body.classList.toggle('nm-embed-page', page === 'media');`,
  },
  {
    name: '4. 嵌入渲染器与主壳摘要桥',
    old: `  /* ---------------- E. 新媒体工作台 ---------------- */`,
    new: `  /* 新媒体工作台（新版）：整页应用以 iframe 嵌进主内容区，仍走自己的 /api/nm 与 7 张表。
     独立地址 /newmedia 保持可用；embed=1 只收起它自己的侧栏，换成顶部七视图横排。 */
  function renderMediaShell() {
    /* 相对地址在站点与 dist/file:// 下都成立；线上 /newmedia.html 会 307 到 /newmedia（保留 ?embed=1）。 */
    return '<div class="nm-embed-shell"><iframe id="nmEmbedFrame" class="nm-embed-frame" src="newmedia.html?embed=1" title="新媒体工作台" loading="eager"></iframe></div>';
  }

  /* 主壳只读摘要：新工作台每次落盘都会写 nm_shell_summary_v1。
     有摘要就以它为准（ready=true 时即使为空也不再回退旧演示数据）；没有摘要时保持旧数据。 */
  function nmShellMediaItems(s) {
    try {
      var raw = localStorage.getItem('nm_shell_summary_v1');
      var o = raw ? JSON.parse(raw) : null;
      if (o && o.ready && Array.isArray(o.items)) return o.items;
    } catch (e) {}
    return (s.media && s.media.items) || [];
  }

  /* ---------------- E. 新媒体工作台 ---------------- */`,
  },
  {
    name: '5. 首页「内容在制」读新摘要',
    old: `  const wip = (s.media.items || []).filter(it => it.stage !== '已发布').length;`,
    new: `  const wip = nmShellMediaItems(s).filter(it => it.stage !== '已发布').length;`,
  },
  {
    name: '6. 首页「本周节奏」读新摘要',
    old: `  (s.media.items || []).forEach(it => {
    if (it.stage === '已发布' && it.pub && it.pub >= wsIso) cnt[it.plat] = (cnt[it.plat] || 0) + 1;
  });`,
    new: `  nmShellMediaItems(s).forEach(it => {
    if (it.stage === '已发布' && it.pub && it.pub >= wsIso) cnt[it.plat] = (cnt[it.plat] || 0) + 1;
  });`,
  },
  {
    name: '7. 计划日历计数读新摘要',
    old: `    if (p4On(s, 'media')) c.media = ((s.media && s.media.items) || []).filter(function (x) { return x.pub === iso && x.stage !== '已发布'; }).length;`,
    new: `    if (p4On(s, 'media')) c.media = nmShellMediaItems(s).filter(function (x) { return x.pub === iso && x.stage !== '已发布'; }).length;`,
  },
  {
    name: '8. 计划日历条目读新摘要',
    old: `      ((s.media && s.media.items) || []).filter(function (x) { return x.pub === iso && x.stage !== '已发布'; }).forEach(function (x) {`,
    new: `      nmShellMediaItems(s).filter(function (x) { return x.pub === iso && x.stage !== '已发布'; }).forEach(function (x) {`,
  },
  {
    name: '9. 月报新媒体卡读新摘要',
    old: `    const items = (state.media && state.media.items) || [];`,
    new: `    const items = nmShellMediaItems(state);`,
  },
  {
    name: '10. 自动化平台体检读新摘要',
    old: `  function autoHealthSnapshot(s) {
    const today = todayStr();
    const items = mediaItems(s);`,
    new: `  function autoHealthSnapshot(s) {
    const today = todayStr();
    const items = nmShellMediaItems(s);`,
  },
  {
    name: '11. 旧版媒体页导航项',
    old: `    { key: 'media',       name: '新媒体工作台', icon: '📣' },`,
    new: `    { key: 'media',       name: '新媒体工作台', icon: '📣' },
    { key: 'media-classic', name: '媒体流水线', icon: '🗂️' },`,
  },
  {
    name: '12. 旧版媒体页标题',
    old: `'media':'新媒体工作台',`,
    new: `'media':'新媒体工作台', 'media-classic':'媒体流水线',`,
  },
  {
    name: '13. 旧版媒体页内部标题',
    old: `      '<div><div class="mh-title">新媒体工作台</div><div class="mh-desc">每日流水线：选题 → 洗稿 → 制作 → 发布</div></div>' +`,
    new: `      '<div><div class="mh-title">媒体流水线</div><div class="mh-desc">旧版简版工作台：选题 → 洗稿 → 制作 → 发布（数据存本机，不进新版七表）</div></div>' +`,
  },
  {
    name: '14. 旧版媒体页刷新留在旧页',
    old: `  function refreshPage(page) {
    const target = page || window.currentPage || 'dashboard';
    navTo(target);
  }`,
    new: `  function refreshPage(page) {
    /* 旧版媒体页里的页签与动作仍写 refreshPage('media')；media 现在是新版嵌入页，
       当前正停在旧页时必须留在旧页，否则点任何按钮都会跳到新版工作台。 */
    var p = page;
    if (p === 'media' && window.currentPage === 'media-classic') p = 'media-classic';
    const target = p || window.currentPage || 'dashboard';
    navTo(target);
  }`,
  },
  {
    name: '15. 旧版媒体页异步回调也认 media-classic',
    old: `        if (window.currentPage === 'media') refreshPage('media');`,
    new: `        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');`,
  },
  {
    name: '16. 旧版媒体页演示播种后也刷新自己',
    old: `        if (window.currentPage === 'growth' || window.currentPage === 'media') navTo(window.currentPage);`,
    new: `        if (window.currentPage === 'growth' || window.currentPage === 'media' || window.currentPage === 'media-classic') navTo(window.currentPage);`,
  },
  {
    name: '17. 旧版媒体页本地模板去主题绑定',
    old: `    gen: function (line, title, style) {
      const st = style ? ('风格：' + style) : '风格：家长视角';
      const short = String(title || '').length > 12 ? String(title).slice(0, 12) + '…' : String(title || '');
      if (line === 'long_form') {
        return ['# ' + title, '',
          '## 开头：一个家长最常问的问题', '',
          '「' + short + '」这件事，十个人有九种说法。今天我们把它拆成三层看，看完你自己就能判断。', '',
          '## 第一层：孩子真实的课堂体验', '',
          '只看三件事——一节课孩子开口几次、卡住时老师怎么接、下课前能不能自己复述一遍。这三件事比任何宣传册都准。', '',
          '## 第二层：家长怎么判断老师好不好', '',
          '不看头衔，看「纠错方式」。好的老师先接住孩子的答案，再补一刀；差的老师直接说"不对"。**孩子怕的不是错，是当众被否定。**', '',
          '## 第三层：三个月后能看到什么', '',
          '能自己说出本周学了什么、愿意主动练、遇难题先试三次再求助。这三条出现了，钱才没白花。', '',
          '## 结语', '',
          '选课这件事，本质是选一个能把"不会"讲成"还没会"的人。', '',
          '（约 1500 字 · ' + st + ' · 本地模板生成）'].join('\\n');
      }
      if (line === 'short_form') {
        return JSON.stringify({
          cover_main: short,
          cover_sub: '家长必看的 3 条判断标准',
          body: '姐妹们！关于「' + short + '」\\n我整理了 3 条没人告诉你的判断标准👇\\n\\n1️⃣ 看孩子开口次数，不看教室装修\\n2️⃣ 看老师怎么纠错，不看头衔多长\\n3️⃣ 看三个月后的变化，不看当天热不热闹\\n\\n最后一条最狠：愿意主动练，才是真的学进去了。\\n\\n你家娃卡在哪一步？评论区聊聊💬',
        });
      }
      if (line === 'voiceover') {
        return ['【口播稿 · 约 60 秒】', '',
          '「' + short + '」——今天说三点，看完你就不会踩坑。', '',
          '第一，别被环境骗了。真正决定效果的不是教室多大，是孩子一节课开口几次。', '',
          '第二，看老师怎么纠错。接住答案再补一刀，和直接说"不对"，对孩子是两回事。**怕的不是错，是当众被否定。**', '',
          '第三，三个月后看三件事：能复述、愿主动练、遇难题先试三次。', '',
          '记住这句：选课就是选一个能把"不会"讲成"还没会"的人。下条见。'].join('\\n');
      }
      return ['【微短剧剧本 · 6 镜 · 约 60 秒】', '',
        '第1镜｜教室门口。妈妈拽着孩子往里推，孩子扒着门框："我不去。"',
        '第2镜｜前台。老师蹲下来平视孩子："今天不用开口，先看一节课。"',
        '第3镜｜课堂。孩子缩在最后一排，偷看别人举手。',
        '第4镜｜反转。老师抛出一道"故意写错"的题，孩子小声说"老师你写错了"。',
        '第5镜｜老师把笔递过去："那你来改。"孩子走上讲台。',
        '第6镜｜字幕：**让孩子开口的从来不是鼓励，是一次"我可以纠正大人"的机会。**', '',
        '（' + st + '）'].join('\\n');
    },`,
    new: `    gen: function (line, title, style) {
      const st = style ? (' · 风格：' + style) : '';
      const short = String(title || '').length > 12 ? String(title).slice(0, 12) + '…' : String(title || '');
      const tt = short || '这个话题';
      if (line === 'long_form') {
        return ['# ' + (title || '未命名选题'), '',
          '## 开头：先把问题说清楚', '',
          '「' + tt + '」——说法很多，真正站得住的没几个。今天把它拆成三层，看完你自己就能判断。', '',
          '## 第一层：事实是什么', '',
          '别急着下结论，先看三样：有没有可查的依据、有没有反例、有没有被情绪放大的部分。三条都对得上，才值得往下看。', '',
          '## 第二层：影响了谁的什么', '',
          '把「这事和我有什么关系」换成「它改变了谁的什么」。受影响的人、被改变的环节、变化的速度——这三个才是判断它值不值得跟进的标准。', '',
          '## 第三层：接下来会怎么走', '',
          '短期看情绪，中期看动作，长期看结构。能看到第三层的人，不是知道得最多，而是问得最准。', '',
          '## 结语', '',
          '任何热点都一样：追之前先问一句——它到底改变了谁的什么？', '',
          '（约 1500 字' + st + ' · 本地模板生成）'].join('\\n');
      }
      if (line === 'short_form') {
        return JSON.stringify({
          cover_main: short,
          cover_sub: '3 条判断标准 · 建议收藏',
          body: '关于「' + tt + '」\\n我整理了 3 条值得记住的判断标准👇\\n\\n1️⃣ 先看事实，不看情绪\\n2️⃣ 再看它影响了谁，不看声音多大\\n3️⃣ 最后看接下来会怎么走\\n\\n结论：热度会过去，结构会留下。\\n\\n你怎么看？评论区聊聊💬',
        });
      }
      if (line === 'voiceover') {
        return ['【口播稿 · 约 60 秒】', '',
          '「' + tt + '」——今天用一分钟说三点，看完你就知道该怎么看。', '',
          '第一，先看事实。有没有依据、有没有反例，比谁嗓门大更重要。', '',
          '第二，看它影响了谁。把「和我有什么关系」换成「它改变了谁的什么」，答案立刻清楚。', '',
          '第三，看接下来会怎么走。**短期看情绪，中期看动作，长期看结构。**', '',
          '记住这句：热度会过去，结构会留下。下条见。'].join('\\n');
      }
      return ['【微短剧剧本 · 6 镜 · 约 60 秒】', '',
        '第1镜｜客厅 · 夜 · 内。主角刷手机，屏幕弹出「' + tt + '」的消息。',
        '第2镜｜特写。主角盯着屏幕，表情从好奇变成认真。',
        '第3镜｜朋友凑过来："你也看到了？网上吵得挺凶。"主角："吵的不是事实，是谁的声音大。"',
        '第4镜｜主角把三条写下来：事实是什么、影响了谁、接下来会怎么走。',
        '第5镜｜反转。朋友看完愣了两秒："这么一说，确实清楚多了。"',
        '第6镜｜字幕：**热度会过去，结构会留下。**', '',
        '（约 60 秒' + st + '）'].join('\\n');
    },`,
  },
  {
    name: '18. 旧版媒体页真实模型提示词去主题绑定',
    old: `              { role: 'system', content: '你是资深新媒体内容创作者，服务少儿培训机构的家长人群。按给定产线直接输出成品文案，不要解释。' },`,
    new: `              { role: 'system', content: '你是资深新媒体内容创作者。按给定产线直接输出成品文案，不要解释、不要编造数据。短图文产线输出 JSON：{"cover_main":"不超过12字的封面主标题","cover_sub":"封面副标题","body":"正文"}。' },`,
  },
  {
    name: '19. 短图文真实模型返回包回 JSON',
    old: `          const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (t) cb(t);`,
    new: `          const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (!t) return;
          /* 短图文要求 JSON：模型偶发返回纯文本时包回标准结构，预览/导出不破 */
          let out = t;
          if (line === 'short_form') {
            try { JSON.parse(t); } catch (e) {
              out = JSON.stringify({ cover_main: String(title || '').slice(0, 12), cover_sub: '3 条判断标准 · 建议收藏', body: t });
            }
          }
          cb(out);`,
  },
  {
    name: '20. 把关中心预览渲染 Markdown',
    old: `    return '<div class="mf-pre">' + utpEsc(c.body || '（暂无正文）') + '</div>';`,
    new: `    return '<div class="mf-pre">' + mfMd2Html(c.body || '（暂无正文）') + '</div>';`,
  },
  {
    name: '21. 短图文预览保留换行',
    old: `        '<div style="flex:1;min-width:0">' + utpEsc(body) + '</div></div>';`,
    new: `        '<div style="flex:1;min-width:0;white-space:pre-line">' + utpEsc(body) + '</div></div>';`,
  },
  {
    name: '22. 版本迁移保留 media（AI 引擎配置不再被清空）',
    old: `    newState.jianghu = oldState.jianghu || newState.jianghu;
    newState.version = DATA_VERSION;`,
    new: `    newState.jianghu = oldState.jianghu || newState.jianghu;
    /* media 承载媒体流水线（含 AI 引擎配置），版本迁移不能丢 */
    newState.media = oldState.media || newState.media;
    newState.version = DATA_VERSION;`,
  },
  {
    name: '23. AI 引擎标签区分部分填写',
    old: `    label: function () { return this.active() ? ('真实模型 · ' + (this.cfg().model || 'deepseek-chat')) : '本地模板引擎'; },`,
    new: `    label: function () {
      const c = this.cfg();
      if (c.apiBase && c.apiKey) return '真实模型 · ' + (c.model || 'deepseek-chat');
      if (c.apiKey) return '已保存 Key · 还差 API Base 才能启用';
      if (c.apiBase) return '已保存 Base · 还差 API Key 才能启用';
      return '本地模板引擎';
    },`,
  },
  {
    name: '24. 只填了部分字段时不再显示误导性提示',
    old: `      (MediaAI.active() ? '' : '（填 API Key 可切真实大模型，不填也能用）') + '</summary>' +`,
    new: `      (MediaAI.active() || MediaAI.cfg().apiKey || MediaAI.cfg().apiBase ? '' : '（填 API Key 可切真实大模型，不填也能用）') + '</summary>' +`,
  },
  {
    name: '25. 候选区状态加平台筛选位 + 平台提取工具',
    old: `    s.spark.seen = s.spark.seen || [];
    return s.spark;
  }`,
    new: `    s.spark.seen = s.spark.seen || [];
    s.spark.platFilter = s.spark.platFilter || 'all';
    return s.spark;
  }
  /* 候选来源的「平台」= 去掉 #排名 的标签，如 微博热搜 #3 → 微博热搜 */
  function sparkPlatOf(src) {
    return String(src || '').replace(/\\s*#\\d+\\s*$/, '');
  }`,
  },
  {
    name: '26. 全部采纳只作用于当前筛选的平台',
    old: `  function sparkAdoptAll() {
    const sp = sparkData();
    if (!sp.candidates.length) { showToast('候选区是空的', 'warning'); return; }
    const s = getState();
    s.media = s.media || { items: [], kpi: [] };
    s.media.items = s.media.items || [];
    const now = Date.now();
    sp.candidates.forEach(function (c, i) {`,
    new: `  function sparkAdoptAll(plat) {
    const sp = sparkData();
    const picks = (plat && plat !== 'all')
      ? sp.candidates.filter(function (c) { return sparkPlatOf(c.src) === plat; })
      : sp.candidates.slice();
    if (!picks.length) { showToast('候选区是空的', 'warning'); return; }
    const s = getState();
    s.media = s.media || { items: [], kpi: [] };
    s.media.items = s.media.items || [];
    const now = Date.now();
    picks.forEach(function (c, i) {`,
  },
  {
    name: '27. 全部采纳收尾与全部忽略按平台筛选',
    old: `    const n = sp.candidates.length;
    sp.candidates = [];
    saveState();
    showToast('✅ 已把 ' + n + ' 条候选全部采纳进选题池', 'success');
    refreshPage('media');
  }
  /* 清空候选区（全部忽略） */
  function sparkClearAll() {
    const sp = sparkData();
    const n = sp.candidates.length;
    sp.candidates.forEach(function (c) { if (!sp.seen.includes(c._id)) sp.seen.push(c._id); });
    sp.seen = sp.seen.slice(-3000);
    sp.candidates = [];
    saveState();
    refreshPage('media');
    if (n) showToast('已清空 ' + n + ' 条候选', 'info');
  }`,
    new: `    const n = picks.length;
    sp.candidates = (plat && plat !== 'all')
      ? sp.candidates.filter(function (c) { return sparkPlatOf(c.src) !== plat; })
      : [];
    saveState();
    showToast('✅ 已把 ' + n + ' 条候选全部采纳进选题池', 'success');
    refreshPage('media');
  }
  /* 清空候选区（全部忽略），同样只作用于当前筛选的平台 */
  function sparkClearAll(plat) {
    const sp = sparkData();
    const picks = (plat && plat !== 'all')
      ? sp.candidates.filter(function (c) { return sparkPlatOf(c.src) === plat; })
      : sp.candidates.slice();
    picks.forEach(function (c) { if (!sp.seen.includes(c._id)) sp.seen.push(c._id); });
    sp.seen = sp.seen.slice(-3000);
    sp.candidates = (plat && plat !== 'all')
      ? sp.candidates.filter(function (c) { return sparkPlatOf(c.src) !== plat; })
      : [];
    saveState();
    refreshPage('media');
    if (picks.length) showToast('已清空 ' + picks.length + ' 条候选', 'info');
  }
  /* 切换平台筛选（再点一次回到全部） */
  function sparkPlat(plat) {
    const sp = sparkData();
    sp.platFilter = (sp.platFilter === plat) ? 'all' : plat;
    saveState();
    refreshPage('media');
  }`,
  },
  {
    name: '28. 候选区暴露 sparkPlat 到全局',
    old: `  window.sparkAdopt = sparkAdopt;
  window.sparkIgnore = sparkIgnore;
  window.sparkAdoptAll = sparkAdoptAll;
  window.sparkClearAll = sparkClearAll;
  window.sparkPull = sparkPull;`,
    new: `  window.sparkAdopt = sparkAdopt;
  window.sparkIgnore = sparkIgnore;
  window.sparkAdoptAll = sparkAdoptAll;
  window.sparkClearAll = sparkClearAll;
  window.sparkPull = sparkPull;
  window.sparkPlat = sparkPlat;`,
  },
  {
    name: '29. 候选区渲染按平台筛选并加 chips',
    old: `    const blanks = sparkBlanks(10);
    const lastRun = sp.runs.length ? sp.runs[sp.runs.length - 1] : null;

    const rows = cands.slice(0, 40).map(function (c) {`,
    new: `    const blanks = sparkBlanks(10);
    const lastRun = sp.runs.length ? sp.runs[sp.runs.length - 1] : null;
    const plats = [];
    cands.forEach(function (c) {
      const p = sparkPlatOf(c.src);
      if (p && plats.indexOf(p) < 0) plats.push(p);
    });
    const plat = (sp.platFilter !== 'all' && plats.indexOf(sp.platFilter) >= 0) ? sp.platFilter : 'all';
    const vis = plat === 'all' ? cands : cands.filter(function (c) { return sparkPlatOf(c.src) === plat; });

    const rows = vis.slice(0, 40).map(function (c) {`,
  },
  {
    name: '30. 候选区状态文案与筛选 chips、计数按筛选',
    old: `    const tip = '本地模式：定时任务每天 17:00 抓 B站/百度热搜。' +
      (blanks.length ? ' 近 10 天有 <b>' + blanks.length + '</b> 天没抓，双击 <code>立即抓取.bat</code> 补一轮。' : ' 近 10 天抓取完整。');`,
    new: `    const tip = '本地模式：定时任务每天 17:00 抓 B站/百度/微博/小红书热搜。' +
      (blanks.length ? ' 近 10 天有 <b>' + blanks.length + '</b> 天没抓，双击 <code>立即抓取.bat</code> 补一轮。' : ' 近 10 天抓取完整。');`,
  },
  {
    name: '31. 候选区操作行插入平台 chips',
    old: `      '<div class="utp-filters">' +
      '<button class="utp-act" onclick="sparkPull()">🔄 读取最新抓取</button>' +
      '<button class="utp-act" onclick="sparkAdoptAll()">✓ 全部采纳（' + cands.length + '）</button>' +
      '<button class="utp-act danger" onclick="sparkClearAll()">✕ 全部忽略</button>' +
      '</div>' +
      '<div class="spk-list">' + rows + '</div>' +
      (cands.length > 40 ? '<div class="utp-note" style="padding:6px 2px">共 ' + cands.length + ' 条，只显示前 40 条</div>' : '') +`,
    new: `      '<div class="utp-filters">' +
      '<span class="spk-plats">' +
      '<button class="utp-act chip' + (plat === 'all' ? ' on' : '') + '" onclick="sparkPlat(\\'all\\')">全部</button>' +
      plats.map(function (p) {
        return '<button class="utp-act chip' + (plat === p ? ' on' : '') + '" onclick="sparkPlat(\\'' + p + '\\')">' + utpEsc(p) + '</button>';
      }).join('') +
      '</span>' +
      '<button class="utp-act" onclick="sparkPull()">🔄 读取最新抓取</button>' +
      '<button class="utp-act" onclick="sparkAdoptAll(\\'' + plat + '\\')">✓ 全部采纳（' + vis.length + '）</button>' +
      '<button class="utp-act danger" onclick="sparkClearAll(\\'' + plat + '\\')">✕ 全部忽略</button>' +
      '</div>' +
      '<div class="spk-list">' + rows + '</div>' +
      (vis.length > 40 ? '<div class="utp-note" style="padding:6px 2px">共 ' + vis.length + ' 条，只显示前 40 条</div>' : '') +`,
  },
  {
    name: '32. 平台 chips 选中态样式',
    old: `    .utp-act { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--bg-card); color: var(--text-warm); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; transition: all .15s ease; }`,
    new: `    .utp-act { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--bg-card); color: var(--text-warm); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; transition: all .15s ease; }
    .utp-act.on { background: var(--gold-bright); color: #fff; border-color: var(--gold-bright); }
    .spk-plats { display: inline-flex; gap: 6px; flex-wrap: wrap; margin-right: 6px; }`,
  },
  {
    name: '33. AI refine 失败回传原因（不再静默）',
    old: `    refine: function (line, title, style, cb) {
      const c = this.cfg();
      if (!c.apiBase || !c.apiKey) return;
      try {
        fetch(String(c.apiBase).replace(/\\/+$/, '') + '/chat/completions', {`,
    new: `    refine: function (line, title, style, cb) {
      const c = this.cfg();
      if (!c.apiBase || !c.apiKey) return;
      const done = function (txt, reason) { if (cb) cb(txt, reason); };
      try {
        fetch(String(c.apiBase).replace(/\\/+$/, '') + '/chat/completions', {`,
  },
  {
    name: '34. AI refine 的失败分支把原因传回调用方',
    old: `        }).then(function (j) {
          const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (!t) return;
          /* 短图文要求 JSON：模型偶发返回纯文本时包回标准结构，预览/导出不破 */
          let out = t;
          if (line === 'short_form') {
            try { JSON.parse(t); } catch (e) {
              out = JSON.stringify({ cover_main: String(title || '').slice(0, 12), cover_sub: '3 条判断标准 · 建议收藏', body: t });
            }
          }
          cb(out);
        }).catch(function () { /* 直连失败：保留本地模板结果 */ });
      } catch (e) { /* 保持本地模板结果 */ }
    },
  };`,
    new: `        }).then(function (j) {
          const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (!t) { done('', '响应里没有文案'); return; }
          /* 短图文要求 JSON：模型偶发返回纯文本时包回标准结构，预览/导出不破 */
          let out = t;
          if (line === 'short_form') {
            try { JSON.parse(t); } catch (e) {
              out = JSON.stringify({ cover_main: String(title || '').slice(0, 12), cover_sub: '3 条判断标准 · 建议收藏', body: t });
            }
          }
          done(out);
        }).catch(function (e) { done('', (e && e.message) || '网络错误'); });
      } catch (e) { done('', (e && e.message) || '网络错误'); }
    },
  };`,
  },
  {
    name: '35. 写稿步 AI 失败写进任务、成功弹提示',
    old: `    if (t.step === 1) {
      /* 写稿：先本地模板同步出稿，保证断网也有内容 */
      t.body = MediaMock.gen(t.line, t.title, t.style);
      t.text = 'mock';
      /* 配了真实模型就异步覆盖（失败静默） */
      MediaAI.refine(t.line, t.title, t.style, function (txt) {
        const ss = getState();
        const tt = mfTasks(ss).find(function (x) { return x.id === taskId; });
        if (!tt || (tt.step || 0) < 1) return;
        tt.body = txt; tt.text = 'real';
        const cc = mfContents(ss).filter(function (x) { return x.taskId === taskId; })[0];
        if (cc) cc.body = txt;
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
      });
    }`,
    new: `    if (t.step === 1) {
      /* 写稿：先本地模板同步出稿，保证断网也有内容 */
      t.body = MediaMock.gen(t.line, t.title, t.style);
      t.text = 'mock';
      if (MediaAI.active()) {
        /* 配了真实模型就异步覆盖；失败把原因写进任务，让用户知道为什么还是模板 */
        t._aiPending = true;
        MediaAI.refine(t.line, t.title, t.style, function (txt, reason) {
          const ss = getState();
          const tt = mfTasks(ss).find(function (x) { return x.id === taskId; });
          if (!tt || (tt.step || 0) < 1) return;
          tt._aiPending = false;
          if (txt) {
            tt.body = txt; tt.text = 'real';
            const cc = mfContents(ss).filter(function (x) { return x.taskId === taskId; })[0];
            if (cc) cc.body = txt;
            saveState();
            if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
            showToast('✓ 真实模型文案已覆盖', 'success');
          } else {
            tt.error = 'AI 调用失败：' + (reason || '未知原因') + '，已保留本地模板';
            saveState();
            if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
          }
        });
      }
    }`,
  },
  {
    name: '36. AI 未完成时阻止合成成稿',
    old: `    let ipNote = null;  /* 出演的形象（toast 用，须在块外可见） */
    if (t.step === 3) {`,
    new: `    if (t.step === 3 && MediaAI.active() && t.text !== 'real' && t._aiPending) {
      t.step = 2;
      saveState(); refreshPage('media');
      showToast('⏳ 真实模型还在写，等覆盖完成再点「合成成稿」', 'info');
      return;
    }
    let ipNote = null;  /* 出演的形象（toast 用，须在块外可见） */
    if (t.step === 3) {`,
  },
  {
    name: '37. 打回重写同样走真实模型，失败写 aiNote',
    old: `      body: MediaMock.gen(c.line, c.title, '按意见修改：' + n),
      tags: c.tags || [], status: 'pending_review', version: (c.version || 1) + 1,
      reviewNote: n, supersedes: c.id, supersedesBy: null, publishedAt: null,
      createdAt: new Date().toISOString(), demo: false,
    };
    c.supersedesBy = nc.id;
    s.media.contents = mfContents(s).concat([nc]);
    saveState();
    if (typeof closeModal === 'function') closeModal();
    refreshPage('media');
    showToast('已打回，新版 v' + nc.version + ' 按意见重写好了', 'success');
  }`,
    new: `      body: MediaMock.gen(c.line, c.title, '按意见修改：' + n),
      tags: c.tags || [], status: 'pending_review', version: (c.version || 1) + 1,
      reviewNote: n, supersedes: c.id, supersedesBy: null, publishedAt: null,
      createdAt: new Date().toISOString(), demo: false, aiNote: '',
    };
    c.supersedesBy = nc.id;
    s.media.contents = mfContents(s).concat([nc]);
    saveState();
    if (typeof closeModal === 'function') closeModal();
    refreshPage('media');
    showToast(MediaAI.active()
      ? '已打回，新版 v' + nc.version + ' 已生成，真实模型覆盖中…'
      : '已打回，新版 v' + nc.version + ' 按意见重写好了', 'success');
    if (MediaAI.active()) {
      MediaAI.refine(c.line, c.title, '按意见修改：' + n, function (txt, reason) {
        const ss = getState();
        const dd = mfContents(ss).find(function (x) { return x.id === nc.id; });
        if (!dd) return;
        if (txt) { dd.body = txt; dd.aiNote = ''; }
        else { dd.aiNote = 'AI 调用失败：' + (reason || '未知原因') + '，当前为本地模板稿'; }
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
      });
    }
  }`,
  },
  {
    name: '38. 把关卡片显示 AI 失败提示',
    old: `        mfPreviewHtml(c) +
        (c.reviewNote ? '<div class="tk-meta" style="margin-bottom:8px">📝 本版依据意见：' + utpEsc(c.reviewNote) + '</div>' : '') +`,
    new: `        mfPreviewHtml(c) +
        (c.aiNote ? '<div class="tk-meta" style="margin-bottom:8px;color:var(--gold-bright)">⚠️ ' + utpEsc(c.aiNote) + '</div>' : '') +
        (c.reviewNote ? '<div class="tk-meta" style="margin-bottom:8px">📝 本版依据意见：' + utpEsc(c.reviewNote) + '</div>' : '') +`,
  },
  {
    name: '39. AI 引擎配置区加「测试连接」按钮',
    old: `      '<div class="f"><label>&nbsp;</label><button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="mfSaveCfg()">💾 保存</button></div>' +`,
    new: `      '<div class="f"><label>&nbsp;</label><button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="mfSaveCfg()">💾 保存</button>' +
      '<button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="mfTestAI()">🔌 测试连接</button></div>' +`,
  },
  {
    name: '40. 新增 mfTestAI 连接测试函数',
    old: `    saveState(); refreshPage('media');
    showToast(MediaAI.active() ? '✓ 已保存，写稿将走真实模型' : '已保存（未填完整，继续用本地模板）', 'info');
  }

  function mpApprove(cid) {`,
    new: `    saveState(); refreshPage('media');
    showToast(MediaAI.active() ? '✓ 已保存，写稿将走真实模型' : '已保存（未填完整，继续用本地模板）', 'info');
  }

  function mfTestAI() {
    const c = MediaAI.cfg();
    if (!c.apiBase || !c.apiKey) { showToast('先填 API Base 和 API Key 再测试', 'warning'); return; }
    const base = String(c.apiBase).replace(/\\/+$/, '');
    showToast('正在测试连接…', '');
    fetch(base + '/models', { headers: { Authorization: 'Bearer ' + c.apiKey } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        showToast('✓ 连接正常，真实模型可用（模型：' + (c.model || 'deepseek-chat') + '）', 'success');
      })
      .catch(function (e) {
        const m = (e && e.message) || '';
        showToast('连接失败：' + (m && m !== 'Failed to fetch' ? m : '网络错误或浏览器 CORS 拦截'), 'warning');
      });
  }

  function mpApprove(cid) {`,
  },
  {
    name: '41. AI 引擎支持云端代理（探活、状态、真值判断）',
    old: `  const MediaAI = {
    cfg: function () { const s = getState(); return (s.media && s.media.cfg) || {}; },
    active: function () { const c = this.cfg(); return !!(c.apiBase && c.apiKey); },
    label: function () {
      const c = this.cfg();
      if (c.apiBase && c.apiKey) return '真实模型 · ' + (c.model || 'deepseek-chat');
      if (c.apiKey) return '已保存 Key · 还差 API Base 才能启用';
      if (c.apiBase) return '已保存 Base · 还差 API Key 才能启用';
      return '本地模板引擎';
    },`,
    new: `  const MediaAI = {
    cfg: function () { const s = getState(); return (s.media && s.media.cfg) || {}; },
    /* 云端代理：Key 在 Worker Secret 里，浏览器一个密钥都不存。
       探活失败（未登录 / 未配置 / file://）一律回落本机直连或本地模板。 */
    cloud: { checked: false, online: false, model: '', at: 0 },
    cloudFresh: function () { return this.cloud.checked && (this.cloud.online || Date.now() - (this.cloud.at || 0) < 5000); },
    probeCloud: function (cb) {
      const self = this;
      const finish = function (online, model) {
        self.cloud = { checked: true, online: !!online, model: model || '', at: Date.now() };
        if (cb) cb();
      };
      if (typeof fetch !== 'function' || location.protocol === 'file:') { finish(false, ''); return; }
      try {
        fetch('/api/ai/status', { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { finish(j && j.enabled, j && j.model); })
          .catch(function () { finish(false, ''); });
      } catch (e) { finish(false, ''); }
    },
    activeCloud: function () { return !!(this.cloud && this.cloud.online); },
    active: function () { const c = this.cfg(); return this.activeCloud() || !!(c.apiBase && c.apiKey); },
    label: function () {
      const c = this.cfg();
      if (this.activeCloud()) return '云端模型 · ' + (this.cloud.model || '服务端配置');
      if (c.apiBase && c.apiKey) return '真实模型 · ' + (c.model || 'deepseek-chat');
      if (c.apiKey) return '已保存 Key · 还差 API Base 才能启用';
      if (c.apiBase) return '已保存 Base · 还差 API Key 才能启用';
      return '本地模板引擎';
    },`,
  },
  {
    name: '42. refine 优先走云端代理，失败再回本机直连',
    old: `    refine: function (line, title, style, cb) {
      const c = this.cfg();
      if (!c.apiBase || !c.apiKey) return;
      const done = function (txt, reason) { if (cb) cb(txt, reason); };
      try {
        fetch(String(c.apiBase).replace(/\\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },`,
    new: `    refine: function (line, title, style, cb) {
      const self = this;
      const c = this.cfg();
      if (!this.cloudFresh()) {
        this.probeCloud(function () { self.refine(line, title, style, cb); });
        return;
      }
      if (!this.activeCloud() && (!c.apiBase || !c.apiKey)) return;
      const done = function (txt, reason) { if (cb) cb(txt, reason); };
      const target = this.activeCloud()
        ? { url: '/api/ai/chat', headers: { 'Content-Type': 'application/json' } }
        : { url: String(c.apiBase).replace(/\\/+$/, '') + '/chat/completions', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey } };
      try {
        fetch(target.url, {
          method: 'POST',
          headers: target.headers,
          credentials: 'same-origin',`,
  },
  {
    name: '43. 云端代理的错误原因透传到回调',
    old: `        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (j) {`,
    new: `        }).then(function (r) {
          if (!r.ok) {
            return r.json().catch(function () { return null; }).then(function (j) {
              throw new Error((j && j.message) || ('HTTP ' + r.status));
            });
          }
          return r.json();
        }).then(function (j) {`,
  },
  {
    name: '44. 启动时探活云端代理并刷新引擎标签',
    old: `  };

  function mfTagsOf(line, title) {`,
    new: `  };
  MediaAI.probeCloud(function () {
    if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
  });

  function mfTagsOf(line, title) {`,
  },
  {
    name: '45. 测试连接同时覆盖云端代理与本机直连',
    old: `  function mfTestAI() {
    const c = MediaAI.cfg();
    if (!c.apiBase || !c.apiKey) { showToast('先填 API Base 和 API Key 再测试', 'warning'); return; }
    const base = String(c.apiBase).replace(/\\/+$/, '');
    showToast('正在测试连接…', '');
    fetch(base + '/models', { headers: { Authorization: 'Bearer ' + c.apiKey } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        showToast('✓ 连接正常，真实模型可用（模型：' + (c.model || 'deepseek-chat') + '）', 'success');
      })
      .catch(function (e) {
        const m = (e && e.message) || '';
        showToast('连接失败：' + (m && m !== 'Failed to fetch' ? m : '网络错误或浏览器 CORS 拦截'), 'warning');
      });
  }`,
    new: `  function mfTestAI() {
    const c = MediaAI.cfg();
    showToast('正在测试连接…', '');
    MediaAI.probeCloud(function () {
      if (MediaAI.activeCloud()) {
        fetch('/api/ai/models', { credentials: 'same-origin' })
          .then(function (r) {
            if (r.ok) return r.json();
            return r.json().catch(function () { return null; }).then(function (j) {
              throw new Error((j && j.message) || ('HTTP ' + r.status));
            });
          })
          .then(function () {
            showToast('✓ 云端代理连接正常（模型：' + (MediaAI.cloud.model || '服务端配置') + '）', 'success');
          })
          .catch(function (e) {
            showToast('云端代理测试失败：' + ((e && e.message) || '未知原因'), 'warning');
          });
        return;
      }
      if (!c.apiBase || !c.apiKey) { showToast('云端未配置，本机也没填 API Base / Key', 'warning'); return; }
      const base = String(c.apiBase).replace(/\\/+$/, '');
      fetch(base + '/models', { headers: { Authorization: 'Bearer ' + c.apiKey } })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          showToast('✓ 连接正常，真实模型可用（模型：' + (c.model || 'deepseek-chat') + '）', 'success');
        })
        .catch(function (e) {
          const m = (e && e.message) || '';
          showToast('连接失败：' + (m && m !== 'Failed to fetch' ? m : '网络错误或浏览器 CORS 拦截'), 'warning');
        });
    });
  }`,
  },
  {
    name: '46. 引擎配置区说明云端模式',
    old: `      '</div><div class="utp-note" style="margin-top:6px">Key 只存本机 localStorage，不上传。直连失败自动回落本地模板，不会卡住流程。</div></details>';`,
    new: `      '</div><div class="utp-note" style="margin-top:6px">' +
      (MediaAI.activeCloud()
        ? '云端代理已启用：Key 存在服务端，本机无需填写（模型：' + utpEsc(MediaAI.cloud.model || '服务端配置') + '）。'
        : 'Key 只存本机 localStorage，不上传。') +
      '调用失败自动回落本地模板，不会卡住流程。</div></details>';`,
  },
  {
    name: '47. 页面容器带页面 key（媒体页移动端样式作用域）',
    old: `    content.innerHTML = '<div class="page-content"></div>';`,
    new: `    content.innerHTML = '<div class="page-content page-' + page + '"></div>';`,
  },
  {
    name: '48. 媒体任务卡、步骤进度与移动端间距样式',
    old: `  @media (max-width: 768px) {
    body.nm-embed-page .main-content { padding: 0 0 calc(66px + env(safe-area-inset-bottom)); }
  }
</style>`,
    new: `  @media (max-width: 768px) {
    body.nm-embed-page .main-content { padding: 0 0 calc(66px + env(safe-area-inset-bottom)); }
  }
  /* ===== 媒体流水线 · 任务卡与移动端（构建期补丁） ===== */
  .mf-task { position: relative; background: var(--bg-panel); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: 13px 15px 12px; transition: border-color .15s ease, box-shadow .15s ease; }
  .mf-task:hover { border-color: var(--line); box-shadow: 0 4px 14px rgba(31, 26, 18, .05); }
  .mf-task.is-done { border-color: rgba(39, 169, 115, .26); }
  .mf-task.is-failed { border-color: rgba(232, 74, 60, .24); }
  .mf-task .tk-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .mf-task .tk-state { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mf-task .tk-state.ok { color: var(--color-success); font-weight: 700; }
  .mf-task .tk-pct { margin-left: auto; flex: none; font: 700 11px ui-monospace, SFMono-Regular, monospace; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .mf-task .tk-x { flex: none; width: 24px; height: 24px; margin: -2px -4px -2px 0; border: 1px solid transparent; border-radius: 50%; background: transparent; color: var(--text-dim); font-size: 12px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all .15s ease; }
  .mf-task .tk-x:hover { color: var(--color-danger); background: rgba(232, 74, 60, .07); border-color: rgba(232, 74, 60, .24); }
  .mf-task .tk-title { margin-top: 8px; font-size: 14px; font-weight: 800; line-height: 1.5; color: var(--text-cream); overflow-wrap: anywhere; }
  .mf-steps { display: flex; align-items: center; gap: 6px; margin: 10px 0 8px; }
  .mf-steps .st { display: inline-flex; align-items: center; gap: 5px; color: var(--text-dim); font-size: 11px; white-space: nowrap; }
  .mf-steps .st em { font-style: normal; }
  .mf-steps .st i { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-style: normal; font-size: 10px; font-weight: 800; background: var(--line); color: var(--text-muted); }
  .mf-steps .st.done { color: var(--text-muted); }
  .mf-steps .st.done i { background: rgba(39, 169, 115, .14); color: var(--color-success); }
  .mf-steps .st.on { color: var(--gold-bright); font-weight: 700; }
  .mf-steps .st.on i { background: var(--gold); color: #fff; box-shadow: 0 0 0 3px rgba(255, 109, 36, .12); }
  .mf-steps .ln { flex: 1; min-width: 8px; height: 2px; border-radius: 2px; background: var(--line); }
  .mf-steps .ln.done { background: rgba(39, 169, 115, .5); }
  .mf-task .tk-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--text-muted); }
  .mf-task .tk-meta span { display: inline-flex; align-items: center; gap: 3px; }
  .mf-task .tk-error { margin-top: 9px; border: 1px solid rgba(232, 74, 60, .2); border-radius: 8px; background: rgba(232, 74, 60, .05); color: var(--color-danger); font-size: 11.5px; overflow: hidden; }
  .mf-task .tk-error summary { display: flex; align-items: center; gap: 6px; padding: 7px 10px; cursor: pointer; font-weight: 700; list-style: none; }
  .mf-task .tk-error summary::-webkit-details-marker { display: none; }
  .mf-task .tk-error summary::after { content: '展开'; margin-left: auto; font-weight: 400; opacity: .65; }
  .mf-task .tk-error[open] summary::after { content: '收起'; }
  .mf-task .tk-error > div { padding: 0 10px 9px; line-height: 1.65; overflow-wrap: anywhere; }
  .mf-task .mf-ops { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line-soft); }
  .mf-task .mf-ops .utp-act { padding: 5px 12px; font-weight: 700; }
  .mf-task .mf-ops .utp-act:first-child { background: var(--gold); border-color: var(--gold); color: #fff; }
  .mf-task .mf-ops .utp-act:first-child:hover { background: var(--gold-bright); border-color: var(--gold-bright); color: #fff; }
  @media (max-width: 640px) {
    .page-media .module-header, .page-media-classic .module-header { flex-wrap: wrap; gap: 8px; }
    .page-media .module-header .utp-demo-btn, .page-media-classic .module-header .utp-demo-btn { white-space: nowrap; }
    .page-media .utp-card, .page-media-classic .utp-card { padding: 13px 12px; }
    .page-media .utp-card-head, .page-media-classic .utp-card-head { gap: 6px 10px; margin-bottom: 10px; }
    .page-media .utp-notice, .page-media-classic .utp-notice { display: block; padding: 9px 12px; font-size: 12px; line-height: 1.65; margin-bottom: 10px; }
    .page-media .utp-tabs, .page-media-classic .utp-tabs { flex-wrap: nowrap; overflow-x: auto; margin: 0 -4px 12px; padding: 0 4px 3px; scrollbar-width: none; }
    .page-media .utp-tabs::-webkit-scrollbar, .page-media-classic .utp-tabs::-webkit-scrollbar { display: none; }
    .page-media .utp-tab, .page-media-classic .utp-tab { flex: none; padding: 6px 13px; font-size: 12.5px; }
    .page-media .mf-lines, .page-media-classic .mf-lines { grid-template-columns: 1fr; gap: 8px; }
    .page-media .mf-line, .page-media-classic .mf-line { display: flex; align-items: baseline; gap: 3px 8px; flex-wrap: wrap; padding: 10px 12px; }
    .page-media .mf-line .ln-t, .page-media-classic .mf-line .ln-t { margin-bottom: 0; }
    .page-media .mf-line .ln-d, .page-media-classic .mf-line .ln-d { flex: 1 1 160px; }
    .page-media .mf-line .ln-n, .page-media-classic .mf-line .ln-n { margin-top: 0; margin-left: auto; }
    .page-media .mf-task, .page-media-classic .mf-task { padding: 12px 12px 11px; }
    .page-media .mf-task .tk-title, .page-media-classic .mf-task .tk-title { font-size: 13.5px; }
    .page-media .mf-steps, .page-media-classic .mf-steps { gap: 4px; }
    .page-media .mf-steps .st, .page-media-classic .mf-steps .st { gap: 4px; font-size: 10.5px; }
    .page-media .mf-steps .st i, .page-media-classic .mf-steps .st i { width: 16px; height: 16px; font-size: 9px; }
    .page-media .mf-steps .ln, .page-media-classic .mf-steps .ln { min-width: 4px; }
    .page-media .mf-task .mf-ops .utp-act, .page-media-classic .mf-task .mf-ops .utp-act { flex: 1; justify-content: center; padding: 8px 12px; }
    .page-media .mf-task .tk-error > div, .page-media-classic .mf-task .tk-error > div { max-height: 96px; overflow: auto; }
    .page-media .mf-cfg, .page-media-classic .mf-cfg { padding: 11px 12px; }
    .page-media .mf-cfg .utp-form, .page-media-classic .mf-cfg .utp-form { grid-template-columns: 1fr; }
    .page-media .mf-cfg .utp-form .f.wide, .page-media-classic .mf-cfg .utp-form .f.wide { grid-column: auto; }
  }
  .ip-avatar .ip-face { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
  .ip-avatar-pet { background: linear-gradient(160deg, #f7ecd7, #efe0c8); }
  .ip-avatar-pet .ip-face > img, .ip-avatar-pet .ip-face > div { max-width: 100%; max-height: 100%; }
  .ip-card .ip-badge { display: inline-flex; align-items: center; padding: 1px 6px; margin-left: 4px; border-radius: 999px; font-size: 10px; font-weight: 700; color: var(--color-success); background: rgba(39, 169, 115, .12); vertical-align: middle; }
  .ip-pet-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; max-height: min(60vh, 480px); overflow: auto; padding: 2px; }
  .ip-pet-pick { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-panel); color: inherit; cursor: pointer; font-family: inherit; }
  .ip-pet-pick:hover { border-color: var(--gold); background: rgba(255, 109, 36, .05); }
  .ip-pet-pick:disabled { opacity: .55; cursor: default; }
  .ip-pet-thumb { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; }
  .ip-pet-name { font-size: 12px; font-weight: 700; color: var(--text-warm); text-align: center; line-height: 1.35; }
  .ip-pet-state { font-size: 10.5px; color: var(--text-dim); }
  .ip-pet-pick.on .ip-pet-state { color: var(--color-success); }
  @media (max-width: 640px) { .ip-pet-picker { grid-template-columns: repeat(2, 1fr); } }
  .mf-task .tk-image { margin-top: 9px; border: 1px solid var(--line-soft); border-radius: 8px; overflow: hidden; background: var(--bg-card); }
  .mf-task .tk-image img { display: block; width: 100%; max-height: 190px; object-fit: cover; }
  .mf-task .tk-image.pending { padding: 16px; text-align: center; font-size: 11.5px; color: var(--text-muted); border-style: dashed; }
  .mf-task .tk-img-error { margin-top: 7px; font-size: 11px; line-height: 1.6; color: var(--color-danger); overflow-wrap: anywhere; }
  .mf-pre.cover .mf-cover img { display: block; width: 100%; height: auto; }
  .mf-video { margin: 10px 0; display: flex; flex-direction: column; gap: 8px; }
  .mf-video video { width: 100%; max-height: 420px; border-radius: 10px; background: #000; }
  .mf-video .utp-act { align-self: flex-start; }
  .mf-video-status { margin: 8px 0; padding: 8px 10px; border: 1px dashed var(--line); border-radius: 8px; font-size: 11.5px; color: var(--text-muted); }
  .mf-video-status.err { color: var(--color-danger); border-color: rgba(232, 74, 60, .3); background: rgba(232, 74, 60, .04); }
  .mf-tts { margin: 10px 0; display: flex; flex-direction: column; gap: 8px; }
  .mf-tts audio { width: 100%; }
  .mf-tts .utp-act { align-self: flex-start; }
  .utp-act:disabled { opacity: .6; cursor: default; }
  @media (max-width: 640px) {
    .page-media .mf-task .tk-image img, .page-media-classic .mf-task .tk-image img { max-height: 160px; }
    .mf-video video { max-height: 360px; }
  }
</style>`,
  },
  {
    name: '49. 制作任务卡改为标题+步骤进度+可折叠错误',
    old: `    const taskRows = tasks.slice().sort(function (a, b) {
      return (b.step < 3 ? 1 : 0) - (a.step < 3 ? 1 : 0);
    }).map(function (t) {
      const line = mfLineOf(t.line);
      const step = Math.min(3, t.step || 0);
      const pct = Math.round(step / 3 * 100);
      const ops = [];
      if (t.status === 'failed') {
        ops.push('<button class="utp-act" onclick="mfRetry(\\'' + t.id + '\\')">↺ 重试</button>');
      } else if (step < 3) {
        ops.push('<button class="utp-act" onclick="mfAdvance(\\'' + t.id + '\\')">▸ ' + MF_STEPS[step + 1] + '</button>');
      }
      ops.push('<button class="utp-act danger" onclick="mfDelTask(\\'' + t.id + '\\')">✕</button>');
      return '<div class="mf-task"><div class="tk-h"><span class="utp-tag">' + line.n + '</span>' +
        '<span class="tk-t">' + utpEsc(t.title) + '</span>' +
        (t.ipId ? '<span class="tk-meta">🎭 ' + utpEsc(ipNameOf(s, t.ipId)) + '</span>' : '') +
        '<span class="tk-meta">' + (step >= 3 ? '✓ 已成稿' : MF_STEPS[step]) + (t.text === 'real' ? ' · 真实模型' : '') + '</span></div>' +
        '<div class="mf-bar"><div class="tr"><i style="width:' + pct + '%"></i></div><span class="vv">' + pct + '%</span></div>' +
        (t.error ? '<div class="tk-meta" style="color:var(--color-danger);margin-top:6px">⚠ ' + utpEsc(t.error) + '</div>' : '') +
        '<div class="mf-ops" style="margin-top:8px">' + ops.join('') + '</div></div>';
    }).join('') || '<div class="mf-empty">队列空着。<br>上面挑一条「已采用」的选题点开工，三步产出成品。</div>';`,
    new: `    const taskRows = tasks.slice().sort(function (a, b) {
      return (b.step < 3 ? 1 : 0) - (a.step < 3 ? 1 : 0);
    }).map(function (t) {
      const line = mfLineOf(t.line);
      const step = Math.min(3, t.step || 0);
      const pct = Math.round(step / 3 * 100);
      const done = step >= 3;
      const failed = !!t.error;
      const statusText = done ? '已成稿' : (t._aiPending ? 'AI 正在写稿' : (t._imgPending ? '生成配图中' : (step === 0 ? '排队中' : MF_STEPS[step] + '完成')));
      const stepNames = ['写稿', '配图/分镜', '合成成稿'];
      const stepsHtml = stepNames.map(function (name, i) {
        const n = i + 1;
        const cls = step >= n ? ' done' : (step + 1 === n ? ' on' : '');
        return '<span class="st' + cls + '"><i>' + (step >= n ? '✓' : n) + '</i><em>' + name + '</em></span>' +
          (i < 2 ? '<span class="ln' + (step >= n ? ' done' : '') + '"></span>' : '');
      }).join('');
      const ops = [];
      if (t.status === 'failed') {
        ops.push('<button class="utp-act" onclick="mfRetry(\\'' + t.id + '\\')">↺ 重试</button>');
      } else if (step < 3) {
        ops.push('<button class="utp-act" onclick="mfAdvance(\\'' + t.id + '\\')">▸ ' + MF_STEPS[step + 1] + '</button>');
      }
      if (step >= 2) {
        ops.push('<button class="utp-act" onclick="mfGenerateImage(\\'' + t.id + '\\', ' + (t.image ? 'true' : 'false') + ')">' + (t.image ? '🖼 重画配图' : '🖼 生成配图') + '</button>');
      }
      const meta = [];
      if (t.ipId) meta.push('<span>🎭 ' + utpEsc(ipNameOf(s, t.ipId)) + '</span>');
      if (step >= 1) meta.push('<span>' + (t.text === 'real' ? '⚡ 真实模型' : '🧩 本地模板') + '</span>');
      if (t.image && t.image.ref) meta.push('<span>🐾 宠物参考图</span>');
      const imgSrc = t.image && t.image.src;
      const imgHtml = imgSrc
        ? '<div class="tk-image"><img src="' + utpEsc(imgSrc) + '" alt="AI 配图" loading="lazy"></div>'
        : (t._imgPending ? '<div class="tk-image pending">🖼 正在生成配图…</div>' : '');
      const imgErr = t.imageError ? '<div class="tk-img-error">⚠ ' + utpEsc(t.imageError) + '</div>' : '';
      return '<div class="mf-task' + (done ? ' is-done' : '') + (failed ? ' is-failed' : '') + '">' +
        '<div class="tk-top"><span class="utp-tag">' + line.n + '</span>' +
        '<span class="tk-state' + (done ? ' ok' : '') + '">' + statusText + '</span>' +
        '<span class="tk-pct">' + pct + '%</span>' +
        '<button class="tk-x" title="删除任务" aria-label="删除任务" onclick="mfDelTask(\\'' + t.id + '\\')">✕</button></div>' +
        '<div class="tk-title">' + utpEsc(t.title) + '</div>' +
        '<div class="mf-steps">' + stepsHtml + '</div>' +
        (meta.length ? '<div class="tk-meta">' + meta.join('') + '</div>' : '') +
        imgHtml + imgErr +
        (failed ? '<details class="tk-error"><summary>⚠ AI 调用失败，已保留本地模板</summary><div>' + utpEsc(t.error) + '</div></details>' : '') +
        (ops.length ? '<div class="mf-ops">' + ops.join('') + '</div>' : '') +
        '</div>';
    }).join('') || '<div class="mf-empty">队列空着。<br>上面挑一条「已采用」的选题点开工，三步产出成品。</div>';`,
  },
  {
    name: '50. 渲染媒体页时把已领养宠物同步进形象库',
    old: `  function renderMedia() {
    utpCleanStaleTopics();
    const s = getState();`,
    new: `  function renderMedia() {
    utpCleanStaleTopics();
    const s = getState();
    ipSyncPets(s);`,
  },
  {
    name: '51. 宠物角色自动入库与宠物角色选择器',
    old: `  function ipsOf(s) { return (s.media && s.media.ips) || []; }
  function ipActive(s) { return ipsOf(s).filter(function (x) { return x.status !== 'disabled'; }); }`,
    new: `  function ipsOf(s) { return (s.media && s.media.ips) || []; }
  function ipPetPersona(name, type) {
    return '矿工小屋的宠物角色「' + name + '」（' + type + '）。自动同步自宠物角色库，可继续补充语气、穿搭与内容定位。';
  }
  /* 已领养宠物自动对应一个 IP，名字跟随宠物、头像用宠物图集首帧；
     同一只宠物只建一次，后续改名会同步，人设编辑不会被覆盖。 */
  function ipSyncPets(s) {
    const pets = (s && Array.isArray(s.pets)) ? s.pets : [];
    if (!pets.length) return;
    s.media = s.media || {};
    s.media.ips = s.media.ips || [];
    let changed = false;
    pets.forEach(function (pet) {
      if (!pet || !pet.id || !pet.petId) return;
      const id = 'ip_pet_' + pet.id;
      let ip = s.media.ips.find(function (x) { return x.id === id; });
      const name = String(pet.name || pet.type || '宠物角色');
      const type = String(pet.type || name);
      if (!ip) {
        const n = s.media.ips.length;
        s.media.ips.push({
          id: id, name: name, persona: ipPetPersona(name, type),
          glyph: '🐾', g1: IP_GRADS[n % IP_GRADS.length][0], g2: IP_GRADS[n % IP_GRADS.length][1],
          status: 'active', videoCount: 0, createdAt: dmNowIso(), demo: false,
          petId: pet.petId, petRef: pet.id, source: 'pet',
        });
        changed = true;
        return;
      }
      if (ip.source !== 'pet') { ip.source = 'pet'; changed = true; }
      if (ip.petId !== pet.petId) { ip.petId = pet.petId; changed = true; }
      if (ip.petRef !== pet.id) { ip.petRef = pet.id; changed = true; }
      if (!ip.customName && ip.name !== name) { ip.name = name; changed = true; }
    });
    if (changed) saveState();
  }
  function ipActive(s) {
    const pets = (s && Array.isArray(s.pets)) ? s.pets : [];
    const alive = {};
    pets.forEach(function (p) { if (p && p.id) alive[p.id] = true; });
    const list = ipsOf(s).filter(function (x) {
      if (x.status === 'disabled') return false;
      if (x.source === 'pet' && x.petRef && !alive[x.petRef]) return false;
      return true;
    });
    const hasPetIp = list.some(function (x) { return !!x.petId; });
    return list.filter(function (x) { return !(hasPetIp && x.demo); }).sort(function (a, b) {
      return (b.petId ? 1 : 0) - (a.petId ? 1 : 0);
    });
  }
  function ipPetCatalog() { return (SHOP_DATA && SHOP_DATA.pets) || []; }
  function ipPetThumb(petId, size) {
    return (typeof PetManager !== 'undefined' && petId) ? (PetManager.thumb(petId, size) || '') : '';
  }
  function ipHasPet(petId) {
    return ipsOf(getState()).some(function (x) { return x.petId === petId; });
  }
  function ipPetPickerHtml() {
    const pets = ipPetCatalog();
    if (!pets.length) return '<div class="utp-empty">没有可用的宠物角色</div>';
    return pets.map(function (p) {
      const has = ipHasPet(p.petId);
      return '<button type="button" class="ip-pet-pick' + (has ? ' on' : '') + '"' + (has ? ' disabled' : '') + ' onclick="ipImportPet(\\'' + p.id + '\\')">' +
        '<span class="ip-pet-thumb">' + ipPetThumb(p.petId, 56) + '</span>' +
        '<span class="ip-pet-name">' + utpEsc(p.name) + '</span>' +
        '<span class="ip-pet-state">' + (has ? '✓ 已加入' : '＋ 加入') + '</span></button>';
    }).join('');
  }
  function ipOpenPets() {
    showModal('🐾 从宠物角色导入',
      '<div class="utp-note" style="margin-bottom:10px">选一只宠物作为口播/微短剧的固定角色；导入后可在形象库编辑人设。</div>' +
      '<div class="ip-pet-picker">' + ipPetPickerHtml() + '</div>');
  }
  function ipImportPet(shopId) {
    const item = ipPetCatalog().find(function (p) { return p.id === shopId; });
    if (!item) { showToast('宠物角色不存在', 'warning'); return; }
    const s = getState();
    if (ipHasPet(item.petId)) { showToast('这个宠物角色已在形象库', 'warning'); return; }
    s.media = s.media || {};
    s.media.ips = ipsOf(s);
    const n = s.media.ips.length;
    s.media.ips.push({
      id: 'ip_pet_import_' + item.petId, name: item.name,
      persona: ipPetPersona(item.name, item.name),
      glyph: '🐾', g1: IP_GRADS[n % IP_GRADS.length][0], g2: IP_GRADS[n % IP_GRADS.length][1],
      status: 'active', videoCount: 0, createdAt: dmNowIso(), demo: false,
      petId: item.petId, source: 'pet', imported: true,
    });
    saveState();
    if (typeof closeModal === 'function') closeModal();
    refreshPage('media');
    showToast('✓ 已加入形象库：' + item.name, 'success');
  }`,
  },
  {
    name: '52. 形象卡使用宠物头像并增加导入入口',
    old: `    const cards = ips.map(function (ip) {
      const locked = ip.status === 'locked';
      const ops = locked
        ? '<button class="utp-act" onclick="ipEditOpen(\\'' + ip.id + '\\')">✎ 人设</button>'
        : '<button class="utp-act" onclick="ipEditOpen(\\'' + ip.id + '\\')">✎ 人设</button>' +
          '<button class="utp-act danger" onclick="ipDisable(\\'' + ip.id + '\\')">⏸ 停用</button>';
      return '<div class="ip-card">' +
        '<div class="ip-avatar" style="background:linear-gradient(160deg,' + ip.g1 + ',' + ip.g2 + ')">' +
        (locked ? '<span class="ip-lock">🔒 已锁定</span>' : '') + '<span>' + ip.glyph + '</span></div>' +
        '<div class="ip-n">' + utpEsc(ip.name) + '</div>' +
        '<div class="ip-p">' + utpEsc(ip.persona) + '</div>' +
        '<div class="ip-meta"><span class="utp-tag">出演 ' + (ip.videoCount || 0) + ' 条</span>' +
        '<span class="pub-ops">' + ops + '</span></div></div>';
    }).join('');
    const newCard = '<div class="ip-card" style="border-style:dashed;align-items:center;justify-content:center;text-align:center;cursor:pointer;min-height:150px" onclick="ipOpenCreate()">' +
      '<div style="font-size:30px">＋</div><div style="font-size:13.5px;font-weight:800;color:var(--text-warm)">创建新形象</div>' +
      '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.7">本地生成定妆图候选<br>不满意就重开换一批</div></div>';
    return '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">🎭 形象库</span>' +
      '<span class="utp-note">' + ips.length + ' 个可用 · 口播/微短剧「开工」时选角</span></div>' +
      '<div class="ip-grid">' + cards + newCard + '</div></div>' +`,
    new: `    const cards = ips.map(function (ip) {
      const locked = ip.status === 'locked';
      const isPet = !!ip.petId;
      const ops = '<button class="utp-act" onclick="ipEditOpen(\\'' + ip.id + '\\')">✎ 人设</button>' +
        (!isPet && !locked ? '<button class="utp-act danger" onclick="ipDisable(\\'' + ip.id + '\\')">⏸ 停用</button>' : '');
      const face = isPet
        ? (ipPetThumb(ip.petId, 72) || '<span>' + ip.glyph + '</span>')
        : '<span>' + ip.glyph + '</span>';
      return '<div class="ip-card">' +
        '<div class="ip-avatar' + (isPet ? ' ip-avatar-pet' : '') + '"' + (isPet ? '' : ' style="background:linear-gradient(160deg,' + ip.g1 + ',' + ip.g2 + ')"') + '>' +
        (locked ? '<span class="ip-lock">🔒 已锁定</span>' : '') + '<span class="ip-face">' + face + '</span></div>' +
        '<div class="ip-n">' + utpEsc(ip.name) + (isPet ? ' <span class="ip-badge">🐾 宠物</span>' : '') + '</div>' +
        '<div class="ip-p">' + utpEsc(ip.persona) + '</div>' +
        '<div class="ip-meta"><span class="utp-tag">出演 ' + (ip.videoCount || 0) + ' 条</span>' +
        '<span class="pub-ops">' + ops + '</span></div></div>';
    }).join('');
    const newCard = '<div class="ip-card" style="border-style:dashed;align-items:center;justify-content:center;text-align:center;cursor:pointer;min-height:150px" onclick="ipOpenCreate()">' +
      '<div style="font-size:30px">＋</div><div style="font-size:13.5px;font-weight:800;color:var(--text-warm)">创建新形象</div>' +
      '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.7">本地生成定妆图候选<br>不满意就重开换一批</div></div>';
    const petCard = '<div class="ip-card" style="border-style:dashed;align-items:center;justify-content:center;text-align:center;cursor:pointer;min-height:150px" onclick="ipOpenPets()">' +
      '<div style="font-size:30px">🐾</div><div style="font-size:13.5px;font-weight:800;color:var(--text-warm)">从宠物角色导入</div>' +
      '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.7">用胡胡、墩墩等宠物形象<br>当口播 / 微短剧角色</div></div>';
    const petN = ips.filter(function (x) { return !!x.petId; }).length;
    return '<div class="utp-card"><div class="utp-card-head"><span class="utp-card-title">🎭 形象库</span>' +
      '<span class="utp-note">' + ips.length + ' 个可用' + (petN ? ' · 🐾 ' + petN + ' 个宠物角色' : '') + ' · 口播/微短剧「开工」时选角</span></div>' +
      '<div class="ip-grid">' + cards + petCard + newCard + '</div></div>' +`,
  },
  {
    name: '53. 形象编辑支持改角色名（宠物可命名为矿工老爹）',
    old: `  function ipEditOpen(id) {
    const s = getState();
    const ip = ipsOf(s).find(function (x) { return x.id === id; });
    if (!ip) return;
    showModal('✎ 编辑人设 · ' + utpEsc(ip.name),
      '<div class="utp-form" style="grid-template-columns:1fr">' +
      '<div class="f full"><label>人设描述（至少 10 字）' + (ip.status === 'locked' ? ' · 定妆图已🔒锁定' : '') + '</label>' +
      '<textarea id="ipPersona2" rows="3">' + utpEsc(ip.persona) + '</textarea></div></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="utp-act" onclick="closeModal()">取消</button>' +
      '<button class="utp-act" onclick="ipSavePersona(\\'' + id + '\\', (document.getElementById(\\'ipPersona2\\')||{}).value)">保存</button></div>');
  }

  function ipSavePersona(id, text) {
    const s = getState();
    const ip = ipsOf(s).find(function (x) { return x.id === id; });
    if (!ip) return;
    const p = String(text == null ? '' : text).trim();
    if (p.length < 10) { showToast('人设描述至少 10 个字', 'warning'); return; }
    ip.persona = p;
    ip.updatedAt = dmNowIso();
    saveState();
    if (typeof closeModal === 'function') closeModal();
    refreshPage('media');
    showToast('✓ 人设已保存', 'success');
  }`,
    new: `  function ipEditOpen(id) {
    const s = getState();
    const ip = ipsOf(s).find(function (x) { return x.id === id; });
    if (!ip) return;
    showModal('✎ 编辑形象 · ' + utpEsc(ip.name),
      '<div class="utp-form" style="grid-template-columns:1fr">' +
      '<div class="f full"><label>角色名称</label><input id="ipName2" value="' + utpEsc(ip.name) + '"></div>' +
      '<div class="f full"><label>人设描述（至少 10 字）' + (ip.status === 'locked' ? ' · 定妆图已🔒锁定' : '') + '</label>' +
      '<textarea id="ipPersona2" rows="3">' + utpEsc(ip.persona) + '</textarea></div></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="utp-act" onclick="closeModal()">取消</button>' +
      '<button class="utp-act" onclick="ipSavePersona(\\'' + id + '\\', (document.getElementById(\\'ipPersona2\\')||{}).value, (document.getElementById(\\'ipName2\\')||{}).value)">保存</button></div>');
  }

  function ipSavePersona(id, text, name) {
    const s = getState();
    const ip = ipsOf(s).find(function (x) { return x.id === id; });
    if (!ip) return;
    const p = String(text == null ? '' : text).trim();
    const n = String(name == null ? '' : name).trim();
    if (!n) { showToast('名称不能为空', 'warning'); return; }
    if (p.length < 10) { showToast('人设描述至少 10 个字', 'warning'); return; }
    if (ipsOf(s).some(function (x) { return x.id !== id && x.name === n && x.status !== 'disabled'; })) {
      showToast('名称已存在', 'warning'); return;
    }
    ip.persona = p;
    if (n !== ip.name) { ip.name = n; ip.customName = true; }
    ip.updatedAt = dmNowIso();
    saveState();
    if (typeof closeModal === 'function') closeModal();
    refreshPage('media');
    showToast('✓ 形象已保存', 'success');
  }`,
  },
  {
    name: '54. 自动配图（Agnes 图片模型）与本机 TTS 试听',
    old: `  const MF_STEPS = ['排队中', '写稿', '配图/分镜', '合成成稿'];`,
    new: `  const MF_STEPS = ['排队中', '写稿', '配图/分镜', '合成成稿'];
  function mfImageRatio(line) {
    if (line === 'short_form') return '3:4';
    if (line === 'voiceover' || line === 'drama') return '9:16';
    return '16:9';
  }
  function mfImagePrompt(t, line, ip, ratio) {
    const shape = ratio === '9:16' ? '竖屏' : (ratio === '16:9' ? '横屏' : '竖版');
    const bits = [
      '为一条中文' + line.n + '内容生成' + shape + '封面配图。',
      '标题：' + t.title + '。',
      '风格：' + (t.style || '干净、专业、有质感') + '。',
    ];
    if (ip) {
      bits.push('画面角色：' + ip.name + '，' + String(ip.persona || '').slice(0, 200) + '。');
      if (ip.petId) bits.push('以参考图中的宠物角色为主角，保持它的外观、颜色、帽子和表情特征，不要改变角色设定。');
    }
    bits.push('适合中文社交媒体，构图留白，不要出现文字、水印、logo。');
    return bits.join('').slice(0, 1800);
  }
  function mfFetchDataUrl(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        const fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { resolve(''); };
        fr.readAsDataURL(blob);
      });
    }).catch(function () { return ''; });
  }
  /* 宠物图集首帧 → data URI，作为图生图参考；拿不到就退回纯文字生成。 */
  function mfPetRefDataUrl(petId) {
    if (!petId || typeof PetManager === 'undefined' || !PetManager.thumb) return Promise.resolve('');
    const html = PetManager.thumb(petId, 1) || '';
    const m = html.match(/src="([^"]+)"/);
    if (!m) return Promise.resolve('');
    return mfFetchDataUrl(m[1]).then(function (data) {
      return (data && data.indexOf('data:image/') === 0 && data.length < 400 * 1024) ? data : '';
    });
  }
  function mfCompressImage(src, maxW) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        try {
          const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) { resolve(src); return; }
          const scale = Math.min(1, maxW / w0);
          const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) { resolve(src); }
      };
      img.onerror = function () { resolve(src); };
      img.src = src;
    });
  }
  function mfGenerateImage(taskId, force) {
    const s = getState();
    const t = mfTasks(s).find(function (x) { return x.id === taskId; });
    if (!t || (t.step || 0) < 2) return;
    if (t._imgPending) return;
    if (t.image && !force) return;
    if (!MediaAI.activeCloud()) {
      if (force) showToast('云端 AI 未启用，先用本地封面', 'warning');
      return;
    }
    const line = mfLineOf(t.line);
    const ip = t.ipId ? ipsOf(s).find(function (x) { return x.id === t.ipId; }) : null;
    const ratio = mfImageRatio(t.line);
    const prompt = mfImagePrompt(t, line, ip, ratio);
    t._imgPending = true;
    t.imageError = '';
    saveState();
    if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
    const send = function (ref) {
      return fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ prompt: prompt, ratio: ratio, ref: ref || '' }),
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status));
          return j;
        });
      });
    };
    const apply = function (j) {
      const src = j && j.image && j.image.src;
      if (!src) throw new Error('没有返回图片');
      return mfCompressImage(src, 900).then(function (small) {
        const ss = getState();
        const tt = mfTasks(ss).find(function (x) { return x.id === taskId; });
        if (!tt) return;
        tt._imgPending = false;
        tt.imageError = '';
        tt.image = { src: small, ratio: ratio, model: (j.image && j.image.model) || '', prompt: prompt, ref: !!(j.image && j.image.ref), at: new Date().toISOString() };
        const cc = mfContents(ss).filter(function (x) { return x.taskId === taskId; })[0];
        if (cc) cc.image = tt.image;
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
        showToast('✓ 配图已生成' + (tt.image.ref ? '（含宠物参考图）' : '') + '（' + ((j.image && j.image.model) || '云端') + '）', 'success');
      });
    };
    const attempt = function (ref) { return send(ref).then(apply); };
    const fail = function (e) {
      const ss = getState();
      const tt = mfTasks(ss).find(function (x) { return x.id === taskId; });
      if (tt) {
        tt._imgPending = false;
        tt.imageError = '配图生成失败：' + ((e && e.message) || '未知原因');
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
      }
      showToast('配图生成失败：' + ((e && e.message) || '未知原因'), 'warning');
    };
    if (ip && ip.petId) {
      mfPetRefDataUrl(ip.petId).then(function (ref) {
        if (!ref) return attempt('');
        return attempt(ref).catch(function () {
          showToast('宠物参考图未被接受，改用纯文字重试', 'warning');
          return attempt('');
        });
      }).catch(fail);
    } else {
      attempt('').catch(fail);
    }
  }
  function mfSpeakText(text) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      showToast('当前浏览器不支持语音合成', 'warning'); return;
    }
    const clean = String(text || '')
      .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, ' ')
      .replace(/[#>*_\`]/g, '')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 1500);
    if (!clean) { showToast('没有可朗读的正文', 'warning'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'zh-CN';
    u.rate = 1.02;
    const zh = window.speechSynthesis.getVoices().filter(function (v) { return /zh|Chinese/i.test(v.lang + ' ' + v.name); })[0];
    if (zh) u.voice = zh;
    window.speechSynthesis.speak(u);
    showToast('🔊 正在朗读（本机语音）', 'info');
  }
  function mfSpeak(cid) {
    const c = mfContents(getState()).find(function (x) { return x.id === cid; });
    if (!c) return;
    let body = c.body || '';
    if (c.line === 'short_form') {
      try { const j = JSON.parse(body); body = j.body || body; } catch (e) {}
    }
    mfSpeakText(body);
  }
  const _mfVideoTimers = {};
  function mfVideoPrompt(c) {
    const line = mfLineOf(c.line);
    const ip = c.ipId ? ipsOf(getState()).find(function (x) { return x.id === c.ipId; }) : null;
    let body = c.body || '';
    if (c.line === 'short_form') {
      try { const j = JSON.parse(body); body = j.body || body; } catch (e) {}
    }
    const bits = [
      '为一条中文' + line.n + '内容生成 5 秒竖屏短视频。',
      '标题：' + c.title + '。',
      '内容基调：' + String(body).replace(/[#*_\`>\\n]+/g, ' ').slice(0, 300) + '。',
    ];
    if (ip) bits.push('画面角色：' + ip.name + '，' + String(ip.persona || '').slice(0, 160) + '。');
    bits.push('竖屏 9:16，画面干净有质感，镜头运动自然，不要出现文字、水印、logo。');
    return bits.join('').slice(0, 1800);
  }
  function mfVideoHtml(c) {
    const v = c && c.video;
    if (!v) return '';
    if (v.status === 'processing') {
      return '<div class="mf-video-status">🎬 视频生成中' + (v.progress ? ' · ' + v.progress + '%' : '') + '，可离开页面，回来会继续查询</div>';
    }
    if (v.status === 'failed') {
      return '<div class="mf-video-status err">⚠ ' + utpEsc(v.error || '视频生成失败') + '</div>';
    }
    if (v.url) {
      return '<div class="mf-video"><video controls preload="metadata" src="' + utpEsc(v.url) + '"></video>' +
        '<a class="utp-act" href="' + utpEsc(v.url) + '" target="_blank" rel="noopener" download>⬇ 下载视频</a></div>';
    }
    return '';
  }
  function mfVideoButton(c) {
    const v = c.video || {};
    const busy = v.status === 'processing';
    const label = busy ? '🎬 视频生成中…' : (v.url ? '🎬 重生成视频' : (v.status === 'failed' ? '🎬 重试视频' : '🎬 生成视频'));
    return '<button class="utp-act"' + (busy ? ' disabled' : '') + ' onclick="mfVideoStart(\\'' + c.id + '\\')">' + label + '</button>';
  }
  function mfVideoStart(cid) {
    const s = getState();
    const c = mfContents(s).find(function (x) { return x.id === cid; });
    if (!c) return;
    if (!MediaAI.activeCloud()) { showToast('云端 AI 未启用', 'warning'); return; }
    if (c.video && c.video.status === 'processing') { showToast('视频正在生成，稍等', 'info'); return; }
    if (mfContents(s).some(function (x) { return x.id !== cid && x.video && x.video.status === 'processing'; })) {
      showToast('已有视频在生成，稍后再试', 'info'); return;
    }
    const prompt = mfVideoPrompt(c);
    c.video = { status: 'processing', videoId: '', progress: 0, error: '', startedAt: new Date().toISOString(), prompt: prompt };
    saveState();
    if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
    fetch('/api/ai/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ prompt: prompt }),
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status));
        return j;
      });
    }).then(function (j) {
      const ss = getState();
      const cc = mfContents(ss).find(function (x) { return x.id === cid; });
      if (!cc || !cc.video) return;
      cc.video.videoId = j.videoId || '';
      cc.video.status = 'processing';
      saveState();
      if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
      mfVideoPoll(cid, 0);
    }).catch(function (e) {
      const ss = getState();
      const cc = mfContents(ss).find(function (x) { return x.id === cid; });
      if (cc && cc.video) {
        cc.video.status = 'failed';
        cc.video.error = '创建视频任务失败：' + ((e && e.message) || '未知原因');
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
      }
      showToast('视频生成失败：' + ((e && e.message) || '未知原因'), 'warning');
    });
  }
  function mfVideoPoll(cid, n) {
    if (_mfVideoTimers[cid]) return;
    _mfVideoTimers[cid] = setTimeout(function () {
      _mfVideoTimers[cid] = null;
      const s = getState();
      const c = mfContents(s).find(function (x) { return x.id === cid; });
      if (!c || !c.video || c.video.status !== 'processing' || !c.video.videoId) return;
      fetch('/api/ai/video?video_id=' + encodeURIComponent(c.video.videoId), { credentials: 'same-origin' })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (j) {
            if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status));
            return j;
          });
        })
        .then(function (j) {
          const ss = getState();
          const cc = mfContents(ss).find(function (x) { return x.id === cid; });
          if (!cc || !cc.video) return;
          const st = String(j.status || '').toLowerCase();
          if (typeof j.progress === 'number') cc.video.progress = j.progress;
          if (j.url) cc.video.url = j.url;
          if (['succeeded', 'success', 'completed', 'done'].indexOf(st) >= 0 && j.url) {
            cc.video.status = 'succeeded';
            cc.video.doneAt = new Date().toISOString();
            saveState();
            if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
            showToast('✓ 视频已生成', 'success');
            return;
          }
          if (['failed', 'error', 'cancelled'].indexOf(st) >= 0) {
            cc.video.status = 'failed';
            cc.video.error = j.message || '视频生成失败';
            saveState();
            if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
            showToast('视频生成失败：' + (j.message || '未知原因'), 'warning');
            return;
          }
          cc.video.status = 'processing';
          saveState();
          if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
          if (n < 120) mfVideoPoll(cid, n + 1);
          else {
            cc.video.status = 'failed';
            cc.video.error = '视频生成超时，请稍后重试';
            saveState();
            if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
          }
        })
        .catch(function (e) {
          if (n < 120) { mfVideoPoll(cid, n + 1); return; }
          const ss = getState();
          const cc = mfContents(ss).find(function (x) { return x.id === cid; });
          if (cc && cc.video) {
            cc.video.status = 'failed';
            cc.video.error = '视频状态查询失败：' + ((e && e.message) || '网络错误');
            saveState();
            if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
          }
        });
    }, n === 0 ? 1500 : 5000);
  }
  function mfResumeVideoPolls(s) {
    mfContents(s).forEach(function (c) {
      if (c.video && c.video.status === 'processing' && c.video.videoId && !_mfVideoTimers[c.id]) {
        mfVideoPoll(c.id, 0);
      }
    });
  }
  const _mfTtsUrls = {};
  function mfTtsDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('浏览器不支持本地音频缓存')); return; }
      const req = indexedDB.open('bubu-media-tts', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function mfTtsStore(mode, fn) {
    return mfTtsDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction('files', mode);
        const req = fn(tx.objectStore('files'));
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function mfTtsPut(id, blob) {
    return mfTtsStore('readwrite', function (st) { return st.put(blob, id); });
  }
  function mfTtsGet(id) {
    return mfTtsStore('readonly', function (st) { return st.get(id); });
  }
  function mfTtsText(c) {
    let body = c.body || '';
    if (c.line === 'short_form') {
      try { const j = JSON.parse(body); body = j.body || body; } catch (e) {}
    }
    const clean = String(body)
      .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, ' ')
      .replace(/[#>*_\`]/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
    return clean.slice(0, 1200);
  }
  function mfTtsButton(c) {
    const t = c.tts || {};
    const busy = t.status === 'processing';
    const label = busy ? '🎙 语音生成中…' : (t.status === 'ready' ? '🎙 重新生成语音' : (t.status === 'failed' ? '🎙 重试语音' : '🎙 生成语音'));
    return '<button class="utp-act"' + (busy ? ' disabled' : '') + ' onclick="mfTtsStart(\\'' + c.id + '\\')">' + label + '</button>';
  }
  function mfTtsHtml(c) {
    const t = c && c.tts;
    if (!t) return '';
    if (t.status === 'processing') return '<div class="mf-video-status">🎙 语音生成中…</div>';
    if (t.status === 'failed') return '<div class="mf-video-status err">⚠ ' + utpEsc(t.error || '语音生成失败') + '</div>';
    if (t.status === 'ready') {
      return '<div class="mf-tts" data-tts-id="' + c.id + '" data-tts-name="' + utpEsc(String(c.title || '口播').slice(0, 30)) + '"></div>';
    }
    return '';
  }
  function mfTtsStart(cid) {
    const s = getState();
    const c = mfContents(s).find(function (x) { return x.id === cid; });
    if (!c) return;
    const text = mfTtsText(c);
    if (!text) { showToast('没有可朗读的正文', 'warning'); return; }
    if (c.tts && c.tts.status === 'processing') return;
    c.tts = { status: 'processing', at: new Date().toISOString(), textLen: text.length };
    saveState();
    if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
    fetch('/api/ai/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ text: text, title: c.title }),
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return null; }).then(function (j) {
          throw new Error((j && j.message) || ('HTTP ' + r.status));
        });
      }
      return r.blob();
    }).then(function (blob) {
      if (!blob || !blob.size) throw new Error('没有返回音频');
      return mfTtsPut(cid, blob).catch(function () { return null; }).then(function () {
        const ss = getState();
        const cc = mfContents(ss).find(function (x) { return x.id === cid; });
        if (!cc) return;
        if (_mfTtsUrls[cid] && _mfTtsUrls[cid].url) {
          try { URL.revokeObjectURL(_mfTtsUrls[cid].url); } catch (e) {}
        }
        _mfTtsUrls[cid] = { url: URL.createObjectURL(blob), mime: blob.type || 'audio/mpeg' };
        cc.tts = { status: 'ready', mime: blob.type || 'audio/mpeg', bytes: blob.size, at: new Date().toISOString() };
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
        setTimeout(mfHydrateTts, 0);
        showToast('✓ 语音已生成，可试听或下载', 'success');
      });
    }).catch(function (e) {
      const ss = getState();
      const cc = mfContents(ss).find(function (x) { return x.id === cid; });
      if (cc) {
        cc.tts = { status: 'failed', error: '语音生成失败：' + ((e && e.message) || '未知原因'), at: new Date().toISOString() };
        saveState();
        if (window.currentPage === 'media' || window.currentPage === 'media-classic') refreshPage('media');
      }
      showToast('语音生成失败：' + ((e && e.message) || '未知原因'), 'warning');
    });
  }
  function mfHydrateTts() {
    const nodes = document.querySelectorAll('.mf-tts[data-tts-id]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.getAttribute('data-hydrated')) continue;
      el.setAttribute('data-hydrated', '1');
      const cid = el.getAttribute('data-tts-id');
      const name = el.getAttribute('data-tts-name') || '口播';
      const paint = function (url, mime) {
        if (!url) return;
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = url;
        audio.style.width = '100%';
        const a = document.createElement('a');
        a.className = 'utp-act';
        a.href = url;
        a.download = name + (/wav/i.test(mime) ? '.wav' : '.mp3');
        a.textContent = '⬇ 下载语音';
        el.innerHTML = '';
        el.appendChild(audio);
        el.appendChild(a);
      };
      const cached = _mfTtsUrls[cid];
      if (cached) { paint(cached.url, cached.mime); continue; }
      mfTtsGet(cid).then(function (blob) {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        _mfTtsUrls[cid] = { url: url, mime: blob.type || 'audio/mpeg' };
        paint(url, blob.type || 'audio/mpeg');
      }).catch(function () {});
    }
  }`,
  },
  {
    name: '55. 配图生成中禁止直接合成',
    old: `    const step = t.step || 0;
    if (step >= 3) return;
    t.step = step + 1;`,
    new: `    const step = t.step || 0;
    if (step >= 3) return;
    if (step === 2 && t._imgPending) { showToast('配图还在生成，稍等', 'info'); return; }
    t.step = step + 1;`,
  },
  {
    name: '56. 成稿时把配图一起带入内容',
    old: `        ipId: ipNote ? ipNote.id : (t.ipId || null),
        status: 'pending_review', version: 1, reviewNote: '',`,
    new: `        ipId: ipNote ? ipNote.id : (t.ipId || null),
        image: t.image || null,
        status: 'pending_review', version: 1, reviewNote: '',`,
  },
  {
    name: '57. 进入配图/分镜阶段自动生成配图',
    old: `    saveState();
    refreshPage('media');
    if (t.step === 3) showToast('✓ 已成稿，进「把关中心」待处理' + (ipNote ? ' · 🎭 ' + ipNote.name + ' 出演 +1（定妆图已锁定）' : ''), 'success');
  }`,
    new: `    saveState();
    refreshPage('media');
    if (t.step === 2 && !t.image) mfGenerateImage(t.id);
    if (t.step === 3) showToast('✓ 已成稿，进「把关中心」待处理' + (ipNote ? ' · 🎭 ' + ipNote.name + ' 出演 +1（定妆图已锁定）' : ''), 'success');
  }`,
  },
  {
    name: '58. 成稿预览优先显示 AI 配图',
    old: `  function mfPreviewHtml(c) {
    if (c.line === 'short_form') {
      let j = null;
      try { j = JSON.parse(c.body || ''); } catch (e) { j = null; }
      const main = j ? j.cover_main : c.title;
      const sub = j ? j.cover_sub : '';
      const body = j ? j.body : (c.body || '');
      return '<div class="mf-pre cover"><div class="mf-cover">' + mfCoverSvg(main, sub) + '</div>' +
        '<div style="flex:1;min-width:0;white-space:pre-line">' + utpEsc(body) + '</div></div>';
    }
    return '<div class="mf-pre">' + mfMd2Html(c.body || '（暂无正文）') + '</div>';
  }`,
    new: `  function mfPreviewHtml(c) {
    const img = c && c.image && c.image.src;
    const imgBox = img
      ? '<div class="mf-cover"><img src="' + utpEsc(img) + '" alt="AI 配图" style="display:block;width:100%;height:auto"></div>'
      : '';
    if (c.line === 'short_form') {
      let j = null;
      try { j = JSON.parse(c.body || ''); } catch (e) { j = null; }
      const main = j ? j.cover_main : c.title;
      const sub = j ? j.cover_sub : '';
      const body = j ? j.body : (c.body || '');
      return '<div class="mf-pre cover">' + (imgBox || '<div class="mf-cover">' + mfCoverSvg(main, sub) + '</div>') +
        '<div style="flex:1;min-width:0;white-space:pre-line">' + utpEsc(body) + '</div></div>';
    }
    if (imgBox) {
      return '<div class="mf-pre cover">' + imgBox +
        '<div style="flex:1;min-width:0">' + mfMd2Html(c.body || '（暂无正文）') + '</div></div>';
    }
    return '<div class="mf-pre">' + mfMd2Html(c.body || '（暂无正文）') + '</div>';
  }`,
  },
  {
    name: '59. 公众号封面对优先用 AI 位图',
    old: `  function mfCoverPng(c) {
    return new Promise(function (resolve) {
      try {`,
    new: `  function mfCoverPng(c) {
    return new Promise(function (resolve) {
      if (c && c.image && /^data:image\\//.test(c.image.src || '')) { resolve(c.image.src); return; }
      try {`,
  },
  {
    name: '60. 把关中心增加本机语音试听',
    old: `      const ops = isReady
        ? '<button class="utp-act" onclick="mpPublish(\\'' + c.id + '\\')">🚀 发布</button>' +
          '<button class="utp-act" onclick="mpEditOpen(\\'' + c.id + '\\')">✎ 编辑</button>' +
          '<button class="utp-act danger" onclick="mpDel(\\'' + c.id + '\\')">✕ 删除</button>'
        : '<button class="utp-act" onclick="mpApprove(\\'' + c.id + '\\')">✓ 通过</button>' +
          '<button class="utp-act" onclick="mpRejectOpen(\\'' + c.id + '\\')">↩ 打回</button>' +
          '<button class="utp-act" onclick="mpEditOpen(\\'' + c.id + '\\')">✎ 编辑</button>' +
          '<button class="utp-act danger" onclick="mpDel(\\'' + c.id + '\\')">✕</button>';`,
    new: `      const ops = '<button class="utp-act" onclick="mfSpeak(\\'' + c.id + '\\')">🔊 试听口播</button>' + mfVideoButton(c) + mfTtsButton(c) +
        (isReady
          ? '<button class="utp-act" onclick="mpPublish(\\'' + c.id + '\\')">🚀 发布</button>' +
            '<button class="utp-act" onclick="mpEditOpen(\\'' + c.id + '\\')">✎ 编辑</button>' +
            '<button class="utp-act danger" onclick="mpDel(\\'' + c.id + '\\')">✕ 删除</button>'
          : '<button class="utp-act" onclick="mpApprove(\\'' + c.id + '\\')">✓ 通过</button>' +
            '<button class="utp-act" onclick="mpRejectOpen(\\'' + c.id + '\\')">↩ 打回</button>' +
            '<button class="utp-act" onclick="mpEditOpen(\\'' + c.id + '\\')">✎ 编辑</button>' +
            '<button class="utp-act danger" onclick="mpDel(\\'' + c.id + '\\')">✕</button>');`,
  },
  {
    name: '61. 导出配图与语音函数到全局',
    old: `  window.mfOpenTask = mfOpenTask; window.mfSubmit = mfSubmit; window.mfAdvance = mfAdvance;`,
    new: `  window.mfOpenTask = mfOpenTask; window.mfSubmit = mfSubmit; window.mfAdvance = mfAdvance;
  window.mfGenerateImage = mfGenerateImage; window.mfSpeak = mfSpeak;
  window.mfVideoStart = mfVideoStart; window.mfVideoPoll = mfVideoPoll;
  window.mfTtsStart = mfTtsStart; window.mfHydrateTts = mfHydrateTts;
  window.mfListModels = mfListModels;`,
  },
  {
    name: '64. AI 引擎面板查看服务端可用模型',
    old: `  function mfTestAI() {`,
    new: `  function mfListModels() {
    showToast('正在读取可用模型…', '');
    fetch('/api/ai/models', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status));
          return j;
        });
      })
      .then(function (j) {
        const ids = (j && j.models) || [];
        const videos = ids.filter(function (id) { return /video/i.test(id); });
        const images = ids.filter(function (id) { return /image/i.test(id); });
        const rows = ids.map(function (id) {
          const cur = id === j.model ? '文本' : (id === j.imageModel ? '图片' : (id === j.videoModel ? '视频' : ''));
          return '<div class="utp-row"><span class="utp-tag' + (cur ? ' t-done' : '') + '">' + (cur || '—') + '</span>' +
            '<div class="rt" style="word-break:break-all">' + utpEsc(id) + '</div></div>';
        }).join('') || '<div class="utp-empty">接口没有返回模型列表</div>';
        showModal('📋 可用模型',
          '<div class="utp-note">当前配置：文本 ' + utpEsc(j.model || '—') + ' · 图片 ' + utpEsc(j.imageModel || '—') + ' · 视频 ' + utpEsc(j.videoModel || '—') + ' · 语音 ' + utpEsc(j.ttsModel || '—') + '</div>' +
          '<div class="utp-notice" style="margin:10px 0">视频模型：' + (videos.length ? utpEsc(videos.join('、')) : '当前分组没有视频模型') +
          (images.length ? '<br>图片模型：' + utpEsc(images.join('、')) : '') + '</div>' +
          '<div class="utp-rows" style="max-height:52vh;overflow:auto">' + rows + '</div>');
      })
      .catch(function (e) {
        showToast('读取模型列表失败：' + ((e && e.message) || '未知原因'), 'warning');
      });
  }
  function mfTestAI() {`,
  },
  {
    name: '65. 配图按钮区增加模型列表入口',
    old: `'<button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="mfTestAI()">🔌 测试连接</button></div>' +`,
    new: `'<button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="mfTestAI()">🔌 测试连接</button>' +
      '<button class="utp-act" style="justify-content:center;padding:8px 16px" onclick="mfListModels()">📋 模型列表</button></div>' +`,
  },
  {
    name: '62. 把关页恢复未完成的视频轮询',
    old: `  function mfDraftHtml(s) {
    const contents = mfContents(s);`,
    new: `  function mfDraftHtml(s) {
    setTimeout(function () { mfResumeVideoPolls(getState()); mfHydrateTts(); }, 0);
    const contents = mfContents(s);`,
  },
  {
    name: '63. 把关卡片插入视频播放器与语音播放器',
    old: `        mfPreviewHtml(c) +
        (c.aiNote ?`,
    new: `        mfPreviewHtml(c) +
        mfVideoHtml(c) +
        mfTtsHtml(c) +
        (c.aiNote ?`,
  },
];

export function applyMediaEmbed(html) {
  const report = [];
  /* 源文件是 CRLF，补丁字面量按 LF 写；先统一换行，避免多行锚点全部 MISS。 */
  let text = html.replace(/\r\n?/g, '\n');
  let failed = false;

  if (text.includes('function renderMediaShell()')) {
    return { text, report: ['SKIP 已经嵌入过新媒体工作台'], failed: false };
  }

  for (const patch of PATCHES) {
    const first = text.indexOf(patch.old);
    if (first < 0) {
      report.push(`MISS ${patch.name}`);
      failed = true;
      continue;
    }
    if (text.indexOf(patch.old, first + patch.old.length) >= 0) {
      report.push(`AMBIG ${patch.name}`);
      failed = true;
      continue;
    }
    text = text.slice(0, first) + patch.new + text.slice(first + patch.old.length);
    report.push(`OK ${patch.name}`);
  }

  const missing = MUST_HAVE.filter((marker) => !text.includes(marker));
  if (missing.length) {
    report.push(`MUST_HAVE 缺失：${missing.join(' / ')}`);
    failed = true;
  } else {
    report.push('复检：嵌入标记全部存在');
  }

  return { text, report, failed };
}
