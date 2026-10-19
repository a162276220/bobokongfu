/* 构建期补丁：把「云端账号」改造的前端改动打进工作台 HTML。

   为什么是补丁，而不是直接改源文件：
   源文件 `淘金矿工小屋/淘金矿工小屋·自律工作台.html` 还有另一个写者（phase 系列）在按它
   自己的基线整份重写，直接改会被整层抹掉 —— 已经发生过两次（17:33、07:37）。所以同步层
   在这里以「锚点补丁」的形式存在：build-dist.mjs 先把源文件拷成 dist/index.html，
   再对它打补丁。源文件归那个写者，dist 归构建，两边不打架。

   三条硬规矩：
   1. 幂等：已经改过的条目自动跳过，可以反复跑。
   2. 不许静默漏打：锚点找不到或出现多次 → MISS/AMBIG → 调用方必须失败退出。
      漏打的后果是「站点看着正常、其实没有云同步」，比构建失败坏得多。
   3. 打完还要复检关键标记，防止补丁互相覆盖后留下半成品。

   用法：
     node goldminer-hut/tools/patch-sync.mjs [目标文件]   # 默认 goldminer-hut/dist/index.html
   也可以当模块用（测试就是这么做，测的是「源文件 + 补丁」这条真实链路）：
     import { applyPatches } from './patch-sync.mjs';
     const { text, report, failed } = applyPatches(html);
*/

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_TARGET = fileURLToPath(new URL('../dist/index.html', import.meta.url));

/* 打完之后必须能在文本里找到的东西：少一个就说明补丁没生效或被别的补丁覆盖了。 */
const MUST_HAVE = [
  "var CLOUD_ORIGIN = '",
  "var FN_PATH = '/api/app';",
  'function syncState()',
  'function canSync()',
  'function mountAccountUi()',
  'window.gmCloudLogin = cloudLogin;',
];

const PATCHES = [
  {
    name: '1. 头部注释',
    old: `   在线数据表同步层 —— 数据真身：云库 13 张业务表
   - localStorage 仅作运行时缓存，页面加载拉取对账、变更防抖推送
   - 行级 LWW（快照哈希）+ 删除传播 + 30s 轮询
   - rid/updatedAt 为公共列；数据库只经服务端 app Function 访问，
     在本地以 file:// 直开时没有同源端点，整层静默停用`,
    new: `   在线数据表同步层 —— 数据真身：云库 13 张业务表
   - localStorage 仅作运行时缓存，页面加载拉取对账、变更防抖推送
   - 行级 LWW（快照哈希）+ 删除传播 + 60s 轮询（页面不可见时暂停）
   - rid/updatedAt 为公共列；数据面是 Cloudflare Worker 的 /api/app，
     owner 由服务端从会话推出，前端永远不传 owner
   - 两种入口：站点（同源 + HttpOnly cookie）与 file:// 直开（跨域 + Bearer 会话令牌）
   - 没有身份时整层停用，页面照常在本机可用（本地模式）`,
  },
  {
    name: '2. 云地址与会话令牌常量',
    old: `  var _syncing = false, _timer = null;`,
    new: (o) => `  /* CLOUD_ORIGIN 由构建期补丁写入：CLOUD_ORIGIN=https://xxx.workers.dev node tools/build-dist.mjs
     （源文件里一直是空值 —— 那个文件还有另一个写者，不该手改。）
     file:// 直开时没有同源端点，只能靠它找到数据面；站点模式不用它。
     设置页里填的「接口地址」优先级更高，可以临时指向别的部署或自建后端。 */
  var CLOUD_ORIGIN = '${o.cloudOrigin}';
  /* 会话令牌只存本机。站点模式其实用不上它（凭据在 HttpOnly cookie 里），
     存下来是为了让同一台机器上 file:// 直开也能带上身份。 */
  var SESSION_KEY = 'goldminer_session_v1';

  var _syncing = false, _timer = null;`,
  },
  {
    name: '3. 数据面路径',
    old: `  var FN_PATH = '/functions/v1/app';`,
    new: `  var FN_PATH = '/api/app';`,
  },
  {
    name: '4. 地址解析 + 双模式鉴权 + 三态',
    old: `  // 同源模式只有站点上才有端点（file:// 直开没有）；配了外部接口则 file:// 也能同步。
  function online() { return !!apiCfg().endpoint || location.protocol !== 'file:'; }`,
    new: `  function sessionToken() {
    try { return String(localStorage.getItem(SESSION_KEY) || ''); } catch (e) { return ''; }
  }
  function setSessionToken(t) {
    try {
      if (t) { localStorage.setItem(SESSION_KEY, String(t)); } else { localStorage.removeItem(SESSION_KEY); }
    } catch (e) {}
  }

  /* 数据面地址：设置页里的绝对地址 > file:// 下的 CLOUD_ORIGIN > 站点同源 /api/app */
  function apiBase() {
    var ep = apiCfg().endpoint;
    if (ep) { return ep; }
    if (location.protocol === 'file:') {
      return CLOUD_ORIGIN ? CLOUD_ORIGIN.replace(/\\/+$/, '') + FN_PATH : '';
    }
    return FN_PATH;
  }
  /* 站点同源时 apiBase() 是相对路径，去掉数据面后缀就是接口根。 */
  function apiOrigin() { return apiBase().replace(/\\/api\\/app$/, '').replace(/\\/app$/, ''); }
  /* 配了自定义后端就用设置页里的固定令牌；否则用登录拿到的会话令牌。 */
  function authToken() {
    var cfg = apiCfg();
    if (cfg.endpoint && cfg.token) { return cfg.token; }
    return sessionToken();
  }
  function online() { return !!apiBase(); }

  /* 三态指示器与同步层共用这一个判断，免得两处各说各话：
     local = 没有可用数据面（file:// 且没填 CLOUD_ORIGIN）；logged-out = 有数据面但没身份。 */
  function syncState() {
    if (!online()) { return 'local'; }
    var cfg = apiCfg();
    if (cfg.endpoint && cfg.token) { return 'synced'; }   /* 自建后端的固定令牌，无需登录 */
    if (sessionToken()) { return 'synced'; }
    return cfgLoad().me ? 'synced' : 'logged-out';
  }`,
  },
  {
    name: '5. 丢快照别丢接口配置',
    old: `  window.gmSyncDropSnapshot = function () {
    try { localStorage.removeItem(CFG_KEY); } catch (e) {}
  };`,
    new: `  window.gmSyncDropSnapshot = function () {
    var c = cfgLoad();
    delete c.snap;
    delete c.lastTs;
    cfgSave(c);
  };`,
  },
  {
    name: '6. 传输层',
    old: `  function httpJson(qs, init) {
    var cfg = apiCfg();
    var opts = Object.assign({}, init);
    var headers = Object.assign({}, opts.headers);
    if (cfg.endpoint) {
      if (cfg.token) { headers.authorization = 'Bearer ' + cfg.token; }
      // 外部后端只认 bearer，别把本站 cookie 顺带送出去。
      opts.credentials = 'omit';
    } else {
      opts.credentials = 'same-origin';
    }
    opts.headers = headers;
    return fetch(cfg.endpoint ? cfg.endpoint + qs : FN_PATH + qs, opts).then(function (res) {
      if (!res.ok) { throw new Error('api_http_' + res.status); }
      return res.json();
    });
  }`,
    new: `  function httpJson(qs, init) {
    var base = apiBase();
    if (!base) { return Promise.reject(new Error('sync_offline')); }
    var cfg = apiCfg();
    var opts = Object.assign({}, init);
    var headers = Object.assign({}, opts.headers);
    var t = authToken();
    if (t) { headers.authorization = 'Bearer ' + t; }
    // 站点同源走 cookie；自定义后端只认 bearer，别把本站 cookie 顺带送出去。
    opts.credentials = cfg.endpoint ? 'omit' : 'same-origin';
    opts.headers = headers;
    return fetch(base + qs, opts).then(function (res) {
      if (res.status === 401) {
        // 会话没了就别再拿它重试：清掉令牌与登录态，指示器回到未登录。
        setSessionToken('');
        var c = cfgLoad(); delete c.me; cfgSave(c);
        renderAccountChip();
        throw new Error('api_unauthorized');
      }
      if (!res.ok) { throw new Error('api_http_' + res.status); }
      return res.json();
    });
  }`,
  },
  {
    name: '7. 会话失效后停手（canSync 门槛 + 拉取）',
    old: `  function pull() {
    if (!online() || _syncing) { return Promise.resolve(false); }`,
    new: `  /* 会话失效之后就别再打网络了：60s 一次的轮询只会白烧 D1 额度，
     等重新登录（syncState 回到 synced）自己恢复。 */
  function canSync() { return online() && syncState() !== 'logged-out' && !_syncing; }

  function pull() {
    if (!canSync()) { return Promise.resolve(false); }`,
  },
  {
    name: '8. 推送门槛',
    old: `  function push() {
    if (!online() || _syncing) { return Promise.resolve(); }`,
    new: `  function push() {
    if (!canSync()) { return Promise.resolve(); }`,
  },
  {
    name: '9. 防抖推送门槛',
    old: `  function schedule() {
    if (!online() || _syncing) { return; }`,
    new: `  function schedule() {
    if (!canSync()) { return; }`,
  },
  {
    name: '10. 初始化：先挂账号浮层',
    old: `  function init() {
    try {
      if (!online()) { return; } /* file:// 直开：无同源端点，整层停用 */`,
    new: `  function init() {
    try {
      mountAccountUi(); /* 本地模式也要有指示器，让人知道为什么没同步 */
      if (!online()) { return; } /* file:// 直开且没填 CLOUD_ORIGIN：无数据面，整层停用 */`,
  },
  {
    name: '11. 60s 轮询 + 不可见时暂停',
    old: `      setTimeout(bootPull, 80);
      setInterval(function () { try { pull(); } catch (e) {} }, 30000);`,
    new: `      setTimeout(bootPull, 80);
      /* 一次拉取是 13 张表全表读，D1 免费额度按行计费，所以 60s 一次；
         页面不可见时干脆不拉 —— 挂着的标签页没必要一直花钱。 */
      setInterval(function () {
        if (document.visibilityState === 'hidden') { return; }
        try { pull(); } catch (e) {}
      }, 60000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') { try { pull(); } catch (e) {} }
      });`,
  },
  {
    name: '12. 账号浮层',
    old: `  init();
})();`,
    new: `  /* ---------- 账号浮层：三态指示器 + 登录 / 注册 / 退出 ---------- */

  function accountCss() {
    return [
      '#gmAcctChip{position:fixed;left:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:7px;',
      'padding:8px 15px 8px 12px;border-radius:999px;border:1px solid rgba(255,224,160,.85);cursor:pointer;',
      'font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#241708;letter-spacing:.02em;',
      'background:linear-gradient(135deg,#ffd88c,#d9a950 55%,#c79a4a);',
      'box-shadow:0 4px 16px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.35);user-select:none;',
      'transition:transform .15s ease,box-shadow .15s ease}',
      '#gmAcctChip:hover{transform:translateY(-1px);box-shadow:0 7px 22px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.35)}',
      '#gmAcctChip svg{width:15px;height:15px;flex:none}',
      '#gmAcctPanel{position:fixed;left:14px;bottom:58px;z-index:9999;width:272px;padding:16px;border-radius:16px;',
      'border:1px solid rgba(255,214,140,.22);background:linear-gradient(165deg,#221a10,#171209 60%,#120d06);',
      'color:#f0e4cd;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;',
      'box-shadow:0 14px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,214,140,.12);display:none}',
      '#gmAcctPanel.on{display:block;animation:gmAcctIn .18s ease}',
      '@keyframes gmAcctIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '#gmAcctPanel .gm-acct-head{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:#ffd88c}',
      '#gmAcctPanel .gm-acct-head svg{width:17px;height:17px;flex:none}',
      '#gmAcctPanel .gm-acct-head h4{margin:0;font-size:13px;font-weight:600;letter-spacing:.06em;color:#ffd88c}',
      '#gmAcctPanel .gm-acct-head .gm-acct-sub{margin-left:auto;font-size:11px;font-weight:400;color:rgba(240,228,205,.4)}',
      '#gmAcctTabs{display:flex;gap:4px;padding:3px;border-radius:10px;background:rgba(0,0,0,.3);margin:0 0 11px}',
      '#gmAcctTabs button{flex:1;padding:6px 0;border:0;border-radius:8px;background:transparent;',
      'color:rgba(240,228,205,.6);font:600 12px system-ui;cursor:pointer;transition:all .15s ease}',
      '#gmAcctTabs button.on{background:linear-gradient(135deg,#e8bd63,#c79a4a);color:#1d1409;box-shadow:0 2px 8px rgba(0,0,0,.35)}',
      '#gmAcctPanel .gm-field{position:relative;margin:0 0 9px}',
      '#gmAcctPanel input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:9px;',
      'border:1px solid rgba(255,214,140,.18);background:rgba(0,0,0,.32);color:#f0e4cd;font:13px system-ui;',
      'transition:border-color .15s ease,box-shadow .15s ease}',
      '#gmAcctPanel input::placeholder{color:rgba(240,228,205,.35)}',
      '#gmAcctPanel input:focus{outline:none;border-color:rgba(255,214,140,.55);box-shadow:0 0 0 3px rgba(255,214,140,.14)}',
      '#gmAcctPassWrap input{padding-right:36px}',
      '#gmAcctPanel .gm-eye{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:27px;height:25px;',
      'border:0;border-radius:6px;background:transparent;color:rgba(240,228,205,.5);cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;padding:0}',
      '#gmAcctPanel .gm-eye:hover{color:#ffd88c;background:rgba(255,214,140,.08)}',
      '#gmAcctPanel .gm-eye svg{width:15px;height:15px}',
      '#gmAcctPanel .gm-primary{width:100%;margin:2px 0 0;padding:9px;border-radius:10px;border:1px solid rgba(255,224,160,.4);',
      'background:linear-gradient(135deg,#f0c46a,#c79a4a);color:#1d1409;font:600 13px system-ui;cursor:pointer;',
      'box-shadow:0 3px 12px rgba(199,154,74,.25),inset 0 1px 0 rgba(255,255,255,.3);transition:filter .15s ease}',
      '#gmAcctPanel .gm-primary:hover{filter:brightness(1.08)}',
      '#gmAcctPanel .gm-primary:disabled{filter:saturate(.35) brightness(.75);cursor:wait}',
      '#gmAcctPanel .gm-ghost{width:100%;padding:7px;border-radius:9px;border:1px solid rgba(255,214,140,.25);',
      'background:transparent;color:rgba(240,228,205,.75);font:12px system-ui;cursor:pointer;transition:all .15s ease}',
      '#gmAcctPanel .gm-ghost:hover{border-color:rgba(255,214,140,.5);color:#ffd88c}',
      '#gmAcctMe{display:flex;align-items:center;gap:10px;padding:10px;border-radius:11px;',
      'background:rgba(255,214,140,.07);border:1px solid rgba(255,214,140,.16);margin:0 0 10px}',
      '#gmAcctMe .gm-ava{width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;',
      'justify-content:center;background:linear-gradient(135deg,#f0c46a,#b8892f);color:#1d1409;font:600 15px system-ui}',
      '#gmAcctMe .gm-me-name{font:600 13px system-ui;color:#ffd88c;word-break:break-all;line-height:1.3}',
      '#gmAcctMe .gm-me-sub{font-size:11px;color:rgba(240,228,205,.5);margin-top:2px}',
      '#gmAcctPanel .err{min-height:15px;margin:0 0 8px;font-size:12px;color:#ff9a8a}',
      '#gmAcctPanel .err.show{animation:gmAcctShake .25s ease}',
      '@keyframes gmAcctShake{0%,100%{transform:none}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}',
      '#gmAcctPanel .hint{margin:10px 0 0;font-size:11px;line-height:1.5;color:rgba(240,228,205,.5)}',
      '#gmAcctCustom{padding:10px;border-radius:10px;background:rgba(255,214,140,.07);',
      'border:1px solid rgba(255,214,140,.16);font-size:12px;color:rgba(240,228,205,.75);margin:0 0 10px}',
    ].join('');
  }

  /* 服务端错误码 → 人话（码表见 functions/session.mjs） */
  var AUTH_ERR = {
    invalid_credentials: '用户名或密码不对',
    username_taken: '这个用户名已经有人用了',
    invite_invalid: '邀请码无效，或已经被用过',
    invite_required: '注册需要邀请码',
    invalid_username: '用户名 3–24 位，字母/数字/下划线/中文',
    invalid_password: '密码至少 8 位',
    invalid_request: '请检查填写内容',
  };

  var _chip = null, _panel = null, _acctTab = 'login', _acctBusy = false;

  function acctEl(id) { return document.getElementById(id); }
  function acctVal(id) { var e = acctEl(id); return e ? String(e.value || '').trim() : ''; }
  function acctErr(msg) {
    var e = acctEl('gmAcctErr');
    if (e) { e.textContent = msg || ''; e.className = 'err' + (msg ? ' show' : ''); }
  }
  function acctHint(msg) { var e = acctEl('gmAcctHint'); if (e) { e.textContent = msg || ''; } }

  /* 三态图标：本地 / 未登录 / 已同步（内联 SVG，currentColor 继承） */
  var ACCT_ICONS = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 18.5h.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 11 4.2 4.2 0 0 0 7 18.5z"/><path d="m9.2 15.2 2 2 3.6-3.6"/></svg>',
    wifiOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 2.6-1.9"/><path d="M19 12.9a10 10 0 0 0-4.3-2.6"/><path d="M12 20h.01"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 6.5 10 6.5a17.6 17.6 0 0 1-2.4 3.3"/><path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 6.5 10 6.5a10.6 10.6 0 0 0 4.2-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>',
  };

  function acctEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function chipState() {
    var st = syncState();
    if (st === 'local') { return { icon: ACCT_ICONS.wifiOff, text: '本地模式' }; }
    if (st === 'logged-out') { return { icon: ACCT_ICONS.lock, text: '登录 / 注册' }; }
    var me = cfgLoad().me || {};
    return { icon: ACCT_ICONS.cloud, text: (me.username || '已同步') };
  }

  function chipText() {
    var s = chipState();
    return s.text;
  }

  function showAcct(id, on) {
    var e = acctEl(id);
    if (e) { e.style.display = on ? '' : 'none'; }
  }

  /* 面板内容只切显隐、不重写 innerHTML —— 输入框里的值不能被渲染冲掉 */
  function renderPanelState() {
    if (!_panel) { return; }
    var st = syncState();
    var custom = !!apiCfg().endpoint;
    var loggedIn = !custom && st === 'synced';
    var formOn = !custom && !loggedIn;

    showAcct('gmAcctCustom', custom);
    showAcct('gmAcctForm', formOn);
    showAcct('gmAcctTabs', formOn);
    showAcct('gmAcctUserWrap', formOn);
    showAcct('gmAcctPassWrap', formOn);
    showAcct('gmAcctInviteWrap', formOn && _acctTab === 'register');
    showAcct('gmAcctLogin', formOn && _acctTab === 'login');
    showAcct('gmAcctReg', formOn && _acctTab === 'register');
    showAcct('gmAcctMe', loggedIn);
    showAcct('gmAcctOut', loggedIn);

    var tl = acctEl('gmAcctTabLogin'), tr = acctEl('gmAcctTabRegister');
    if (tl) { tl.className = _acctTab === 'login' ? 'on' : ''; }
    if (tr) { tr.className = _acctTab === 'register' ? 'on' : ''; }

    var me = cfgLoad().me || {};
    var ava = acctEl('gmAcctAva'), nm = acctEl('gmAcctMeName');
    if (ava) { ava.textContent = acctEsc((me.username || '？').charAt(0)); }
    if (nm) { nm.textContent = me.username || ''; }

    var ce = acctEl('gmAcctCustom');
    if (ce) { ce.textContent = '当前用设置页里的自建后端（固定令牌），不需要在这里登录。'; }

    if (custom) { acctHint(''); return; }
    acctHint(st === 'local'
      ? '本地模式：把页面放到站点上打开，或填好 CLOUD_ORIGIN，就能用云端账号。'
      : (st === 'logged-out'
        ? '登录后本机数据会与云端对账；注册需要邀请码。'
        : '已同步到云端。换台设备登录同一账号，看到的就是同一份数据。'));
  }

  function renderAccountChip() {
    if (_chip) {
      var s = chipState();
      _chip.innerHTML = s.icon + '<span>' + acctEsc(s.text) + '</span>';
    }
    renderPanelState();
  }

  function toggleAccountPanel() {
    if (!_panel) { return; }
    _panel.className = _panel.className.indexOf('on') >= 0 ? '' : 'on';
    renderAccountChip();
  }

  function switchAcctTab(tab) {
    _acctTab = tab === 'register' ? 'register' : 'login';
    acctErr('');
    renderPanelState();
    var u = acctEl('gmAcctUser');
    if (u && u.focus) { u.focus(); }
  }

  function bindAcctEye() {
    var eye = acctEl('gmAcctEye'), pass = acctEl('gmAcctPass');
    if (!eye || !pass) { return; }
    eye.addEventListener('click', function () {
      var reveal = pass.type === 'password';
      pass.type = reveal ? 'text' : 'password';
      eye.innerHTML = reveal ? ACCT_ICONS.eyeOff : ACCT_ICONS.eye;
      if (eye.setAttribute) { eye.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码'); }
    });
  }

  function mountAccountUi() {
    try {
      if (_chip) { return; }
      var style = document.createElement('style');
      style.textContent = accountCss();
      document.head.appendChild(style);

      _chip = document.createElement('div');
      _chip.id = 'gmAcctChip';
      _chip.addEventListener('click', toggleAccountPanel);
      document.body.appendChild(_chip);

      _panel = document.createElement('div');
      _panel.id = 'gmAcctPanel';
      _panel.innerHTML = [
        '<div class="gm-acct-head">' + ACCT_ICONS.cloud + '<h4>云端账号</h4><span class="gm-acct-sub">淘金矿工小屋</span></div>',
        '<div id="gmAcctCustom" style="display:none"></div>',
        '<div id="gmAcctForm">',
        '  <div id="gmAcctTabs">',
        '    <button type="button" id="gmAcctTabLogin">登录</button>',
        '    <button type="button" id="gmAcctTabRegister">注册</button>',
        '  </div>',
        '  <div class="err" id="gmAcctErr"></div>',
        '  <div class="gm-field" id="gmAcctUserWrap"><input id="gmAcctUser" placeholder="用户名" autocomplete="username"></div>',
        '  <div class="gm-field" id="gmAcctPassWrap"><input id="gmAcctPass" type="password" placeholder="密码（至少 8 位）" autocomplete="current-password">',
        '    <button type="button" class="gm-eye" id="gmAcctEye" aria-label="显示密码">' + ACCT_ICONS.eye + '</button></div>',
        '  <div class="gm-field" id="gmAcctInviteWrap"><input id="gmAcctInvite" placeholder="邀请码（注册才要填）" autocomplete="off"></div>',
        '  <button type="button" class="gm-primary" id="gmAcctLogin">登 录</button>',
        '  <button type="button" class="gm-primary" id="gmAcctReg" style="display:none">注册并登录</button>',
        '</div>',
        '<div id="gmAcctMe" style="display:none">',
        '  <div class="gm-ava" id="gmAcctAva">?</div>',
        '  <div><div class="gm-me-name" id="gmAcctMeName"></div><div class="gm-me-sub">已同步到云端</div></div>',
        '</div>',
        '<button type="button" class="gm-ghost" id="gmAcctOut" style="display:none">退出登录</button>',
        '<div class="hint" id="gmAcctHint"></div>',
      ].join('');
      document.body.appendChild(_panel);

      var on = function (id, fn) { var e = acctEl(id); if (e) { e.addEventListener('click', fn); } };
      on('gmAcctLogin', function () { submitAccount('login'); });
      on('gmAcctReg', function () { submitAccount('register'); });
      on('gmAcctOut', function () { cloudLogout(); });
      on('gmAcctTabLogin', function () { switchAcctTab('login'); });
      on('gmAcctTabRegister', function () { switchAcctTab('register'); });
      bindAcctEye();
      /* Enter 直接提交当前栏；已登录 / 自建后端 / 请求途中不响应 */
      _panel.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Enter' || _acctBusy) { return; }
        var st = syncState();
        if (apiCfg().endpoint || st === 'synced') { return; }
        submitAccount(_acctTab);
      });
      renderAccountChip();
    } catch (e) { /* 浮层失败不影响页面本身 */ }
  }

  /* 账号接口不能走 httpJson：它要能带着「错的密码」去问服务端拿错误码，
     而 httpJson 一见 401 就清令牌。 */
  function postAuth(path, body) {
    var base = apiOrigin();
    if (!base && location.protocol === 'file:') { return Promise.resolve({ ok: false, error: '没有可用的数据面地址' }); }
    return fetch(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var code = data && data.error;
          return { ok: false, error: AUTH_ERR[code] || ('请求失败（HTTP ' + res.status + '）') };
        }
        return { ok: true, data: data || {} };
      });
    }, function () { return { ok: false, error: '网络不可达' }; });
  }

  function whoami() {
    var headers = {};
    var t = authToken();
    if (t) { headers.authorization = 'Bearer ' + t; }
    return fetch(apiOrigin() + '/api/auth/me', { headers: headers, credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; }, function () { return null; })
      .then(function (me) {
        var c = cfgLoad();
        if (me && me.user_id) { c.me = { userId: me.user_id, username: me.username || me.nickname || '' }; }
        else { delete c.me; }
        cfgSave(c);
        return c.me || null;
      });
  }

  /* 登录成功后的固定顺序：拿到身份 → 丢快照 → 拉 → 推。
     丢快照必须夹在中间：快照是「本机已和云端对过账」的凭据，登录前在本地写下的行
     对它来说已经是旧的，下一次拉取会把它们当成「云端已删」抹掉。 */
  function afterAuth() {
    return whoami().then(function () {
      try { window.gmSyncDropSnapshot(); } catch (e) {}
      return pull().then(function () { return push(); });
    }).then(function () { renderAccountChip(); return { ok: true }; });
  }

  function cloudLogin(username, password) {
    var u = String(username || '').trim();
    if (!u || !password) { return Promise.resolve({ ok: false, error: '请填用户名和密码' }); }
    return postAuth('/api/auth/login', { username: u, password: password }).then(function (res) {
      if (!res.ok) { return res; }
      /* 站点模式的凭据在 HttpOnly cookie 里，服务端不回 body 令牌；file:// 才需要存下来。 */
      if (res.data && res.data.token) { setSessionToken(res.data.token); }
      return afterAuth();
    });
  }

  function cloudRegister(username, password, invite) {
    var u = String(username || '').trim();
    if (!u || !password) { return Promise.resolve({ ok: false, error: '请填用户名和密码' }); }
    return postAuth('/api/auth/register', { username: u, password: password, invite: String(invite || '').trim() })
      .then(function (res) {
        if (!res.ok) { return res; }
        if (res.data && res.data.token) { setSessionToken(res.data.token); }
        return afterAuth();
      });
  }

  function cloudLogout() {
    var clear = function () {
      setSessionToken('');
      var c = cfgLoad();
      delete c.me; delete c.snap; delete c.lastTs;
      cfgSave(c);
      renderAccountChip();
      return { ok: true };
    };
    return fetch(apiOrigin() + '/api/auth/logout', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: '{}',
    }).then(clear, clear);
  }

  /* 请求途中：两个主按钮一起禁用并显示进行态，防重复提交 */
  function acctBusy(on, label) {
    var ids = ['gmAcctLogin', 'gmAcctReg'];
    for (var i = 0; i < ids.length; i++) {
      var b = acctEl(ids[i]);
      if (!b) { continue; }
      b.disabled = !!on;
      if (on) {
        if (b.setAttribute) { b.setAttribute('data-label', b.textContent); }
        b.textContent = label || '…';
      } else if (b.getAttribute) {
        var lb = b.getAttribute('data-label');
        if (lb) { b.textContent = lb; }
      }
    }
  }

  function submitAccount(kind) {
    acctErr('');
    var u = acctVal('gmAcctUser');
    var passEl = acctEl('gmAcctPass');
    var p = passEl ? String(passEl.value || '') : '';
    var inv = acctVal('gmAcctInvite');
    if (!u) { acctErr('请填用户名'); return; }
    if (!p) { acctErr('请填密码'); return; }
    if (kind === 'register' && !inv) { acctErr('注册需要邀请码'); return; }
    _acctBusy = true;
    acctBusy(true, kind === 'register' ? '注册中…' : '登录中…');
    acctHint(kind === 'register' ? '正在注册…' : '正在登录…');
    var run = kind === 'register' ? cloudRegister(u, p, inv) : cloudLogin(u, p);
    var done = function () { _acctBusy = false; acctBusy(false); };
    run.then(function (res) {
      done();
      if (!res.ok) { acctErr(res.error || '失败'); acctHint(''); return; }
      acctErr('');
      acctHint('已登录');
    }, function (e) { done(); acctErr(String((e && e.message) || e)); });
  }

  window.gmSyncState = syncState;
  window.gmCloudLogin = cloudLogin;
  window.gmCloudRegister = cloudRegister;
  window.gmCloudLogout = cloudLogout;
  window.gmWhoami = whoami;
  window.gmRenderAccountChip = renderAccountChip;

  init();
})();`,
  },
];

export function applyPatches(source, options = {}) {
  const o = { cloudOrigin: String(options.cloudOrigin || '').replace(/'/g, '').replace(/\/+$/, '') };
  const report = [];
  /* 行尾无关：另一个写者整份重写时会写成 CRLF（实测 6024 行全是 CRLF），
     多行锚点必须两种行尾都能对上。统一在 LF 上打补丁，最后还原成原文件的风格。 */
  const crlf = source.includes('\r\n');
  let text = crlf ? source.replace(/\r\n/g, '\n') : source;
  for (const p of PATCHES) {
    const next = typeof p.new === 'function' ? p.new(o) : p.new;
    if (text.includes(next)) { report.push('skip  ' + p.name + '（已改过）'); continue; }
    const first = text.indexOf(p.old);
    const last = text.lastIndexOf(p.old);
    if (first < 0) { report.push('MISS  ' + p.name + '（找不到锚点）'); continue; }
    if (first !== last) { report.push('AMBIG ' + p.name + '（锚点出现多次）'); continue; }
    text = text.slice(0, first) + next + text.slice(first + p.old.length);
    report.push('apply ' + p.name);
  }
  for (const marker of MUST_HAVE) {
    if (!text.includes(marker)) { report.push('MISS  关键标记缺失：' + marker); }
  }
  const failed = report.some((r) => /^(MISS|AMBIG)/.test(r));
  return { text: crlf ? text.replace(/\n/g, '\r\n') : text, report, failed };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const target = process.argv[2] || DEFAULT_TARGET;
  const before = readFileSync(target, 'utf8');
  const { text, report, failed } = applyPatches(before, { cloudOrigin: process.env.CLOUD_ORIGIN || process.argv[3] || '' });
  console.log(report.join('\n'));
  if (failed) {
    console.error('\n同步层补丁没打全 —— 拒绝写出，否则站点会「看着正常、其实没有云同步」。');
    process.exit(1);
  }
  writeFileSync(target, text, 'utf8');
  console.log(`\n已写入 ${target}（${before.length} → ${text.length} 字节）`);
}
