/* 构建期补丁：把新版新媒体工作台嵌进「卜卜小屋」的壳里。

   背景：卜卜小屋的源文件还有另一个写者（phase 系列）会整份重写，不能直接改源文件；
   所以和同步层一样，补丁打在 dist/index.html 上。

   做六件事：
   1. 把 shell 的 media 页面从旧版 renderMedia 换成 renderMediaShell（iframe 嵌入 /newmedia?embed=1）；
   2. 进入 media 时给 body 加 nm-embed-page，让主内容区让出全部高度、避免双层滚动；
   3. 主壳看板/周报/月报/计划日历改读 nm_shell_summary_v1（新版每次落盘写的只读摘要）；
   4. 旧版简版媒体页保留为独立导航项 media-classic（「媒体流水线」），数据仍走 state.media；
   5. 旧版媒体页的本地模板与真实模型提示词去主题绑定（原模板写死少儿选课场景），把关中心预览渲染 Markdown；
   6. 任何锚点找不到或重复 → 失败退出，不发布「看着正常、其实没嵌进去」的站点。
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
