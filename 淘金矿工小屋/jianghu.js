/* ============================================================
   江湖 —— 工作台里的文字武侠（挂机修炼 + 文字奇遇）
   ------------------------------------------------------------
   1. 与自律咬合：打卡一次给若干「修炼时辰」（见 WUXIA.TASK_HOURS），
      时辰是修炼、学武、闯荡唯一的消耗品，所以不打卡就没有进度。
   2. 银两（taels）是江湖内部货币，与工作台金币分开：武学只花银两，
      不会把商城经济搅乱。
   3. 全部状态存在 state.jianghu 里，切页/刷新不丢；切磋是回合制的，
      进行中的对局也存下来，中途离开再回来接着打。
   4. 数据在 wuxia-content.js，这里只有规则与渲染。
   ============================================================ */
(function (global) {
  'use strict';

  var DAILY_ADVENTURES = 6;      // 每天最多闯荡几次，防止把它当刷子
  var HOUR_EXP = 10;             // 一个时辰打底能悟出多少修为
  var LOG_KEEP = 12;
  var SLOTS = ['weapon', 'armor', 'boots', 'charm'];   // 装备槽位固定四个，顺序即行囊与身上的排列

  function state() { return getState().jianghu; }
  function save() { saveState(); }
  function hasContent() { return !!global.WUXIA; }

  /* ---------- 派生值 ---------- */
  function realmIndex() {
    var realms = WUXIA.REALMS, exp = state().exp, i;
    for (i = realms.length - 1; i >= 0; i--) { if (exp >= realms[i].need) return i; }
    return 0;
  }
  function realm() { return WUXIA.REALMS[realmIndex()]; }
  function sect() {
    var id = state().sect;
    return id ? WUXIA.SECTS.filter(function (s) { return s.id === id; })[0] : null;
  }
  function sectName(id) {
    return (WUXIA.SECTS.filter(function (s) { return s.id === id; })[0] || {}).name || id;
  }
  function skillLevel(id) { return state().skills[id] || 0; }
  function bestSkill(kind) {
    var top = null;
    WUXIA.SKILLS.forEach(function (s) {
      if (s.kind !== kind) return;
      if (!s.sect || s.sect === state().sect || skillLevel(s.id) > 0) {
        if (!top || skillLevel(s.id) > skillLevel(top.id)) top = s;
      }
    });
    return top;
  }
  // 伙伴：宠物庭院里每只宠物给一项被动，重复取最高，不叠加。
  function partners() {
    var byId = WUXIA.PET_BONUSES.byId, def = WUXIA.PET_BONUSES.default;
    var seen = {}, out = [];
    (getState().pets || []).forEach(function (pet) {
      if (!pet.petId) return;
      var bonus = byId[pet.petId] || def;
      if (seen[bonus.label]) return;
      seen[bonus.label] = true;
      out.push({ name: pet.name, label: bonus.label, bonus: bonus.bonus });
    });
    return out;
  }
  function stats() {
    var base = state().stats, s = { neili: base.neili, gengu: base.gengu,
                                    shenfa: base.shenfa, wuxing: base.wuxing };
    var sc = sect();
    if (sc) { Object.keys(sc.bonus).forEach(function (k) { s[k] += sc.bonus[k]; }); }
    partners().forEach(function (p) {
      Object.keys(p.bonus).forEach(function (k) { s[k] += p.bonus[k]; });
    });
    return s;
  }
  function power() {
    // 战力：心法撑底，招式出力，身法找机会，境界给乘数
    var s = stats();
    var internal = bestSkill('internal'), strike = bestSkill('strike');
    return Math.round((s.neili * 1.2 + s.gengu + s.shenfa * 0.8 + s.wuxing * 0.4
      + skillLevel(internal && internal.id) * 3 + skillLevel(strike && strike.id) * 4)
      * (1 + realmIndex() * 0.12));
  }
  function maxHp() { return 60 + stats().gengu * 6 + realmIndex() * 30; }

  /* ---------- 装备 ---------- */
  function gearItem(id) {
    return WUXIA.GEAR.filter(function (g) { return g.id === id; })[0] || null;
  }
  // 品阶 → 强化上限：凡 2 级、精 4 级、珍 6 级（不是 tier 本身那个 0/1/2）。
  function gearTierCap(item) { return (item.tier + 1) * 2; }

  /* ---------- 存档自愈 ----------
     存档里存的是内容 id（pending.id / duel.foe / sect / skills 的键）。内容表一旦
     改名或删条目，旧存档就会指向不存在的东西，裸下标访问会让整个江湖页渲染崩掉。
     这里在渲染前一次性清干净，让页面永远能打开。 */
  function sanitize() {
    if (!hasContent()) return false;
    var j = state(), changed = false;
    function knownEvent(id) { return WUXIA.EVENTS.some(function (e) { return e.id === id; }); }
    function knownFoe(id) { return WUXIA.FOES.some(function (f) { return f.id === id; }); }
    function knownSect(id) { return WUXIA.SECTS.some(function (s) { return s.id === id; }); }
    function plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

    if (j.duel && !knownFoe(j.duel.foe)) {
      j.duel = null;
      j.pending = null;
      log('那场架没能打完，对手已不知去向。');
      changed = true;
    }
    if (j.pending && !knownEvent(j.pending.id)) {
      j.pending = null;
      log('旧事已了：那段际遇的记载已经散佚。');
      changed = true;
    }
    if (j.sect && !knownSect(j.sect)) {
      j.sect = null;
      log('旧门派的记载已经散佚，你又成了无名散人。');
      changed = true;
    }
    Object.keys(j.skills || {}).forEach(function (id) {
      if (!WUXIA.SKILLS.some(function (s) { return s.id === id; })) {
        delete j.skills[id];
        changed = true;
      }
    });

    /* 装备段：行囊（owned）与身上（equipped）记的也是内容 id，内容表一改就会指空。
       先规整结构，再校验引用，最后把越界的强化截回品阶上限。 */
    var gear = j.gear, structFixed = false;
    if (!plainObject(gear)) { gear = {}; structFixed = true; }
    if (!plainObject(gear.owned)) { gear.owned = {}; structFixed = true; }
    if (!plainObject(gear.equipped)) { gear.equipped = {}; structFixed = true; }
    SLOTS.forEach(function (slot) {
      if (gear.equipped[slot] === undefined) { gear.equipped[slot] = null; structFixed = true; }
    });
    if (gear !== j.gear) j.gear = gear;
    if (structFixed) { log('行囊里的旧账已经记乱，索性重新记过一本。'); changed = true; }

    var junkSlots = 0;
    Object.keys(gear.equipped).forEach(function (slot) {
      if (SLOTS.indexOf(slot) < 0) { delete gear.equipped[slot]; junkSlots++; }
    });
    if (junkSlots) { log('身上多了件叫不出名目的物件，随手解了下来。'); changed = true; }

    var lostItems = 0;
    Object.keys(gear.owned).forEach(function (id) {
      if (!gearItem(id)) { delete gear.owned[id]; lostItems++; }
    });
    if (lostItems) { log('行囊里那几件旧物已经绝迹江湖，名目都记不起来了。'); changed = true; }

    var looseItems = 0;
    SLOTS.forEach(function (slot) {
      var id = gear.equipped[slot];
      if (id !== null && !gear.owned[id]) { gear.equipped[slot] = null; looseItems++; }
    });
    if (looseItems) { log('身上那件东西已经不在行囊里，只好先空着。'); changed = true; }

    var overSharpened = 0;
    Object.keys(gear.owned).forEach(function (id) {
      var entry = gear.owned[id], cap = gearTierCap(gearItem(id));
      if (entry && typeof entry.lvl === 'number' && entry.lvl > cap) { entry.lvl = cap; overSharpened++; }
    });
    if (overSharpened) { log('旧物淬炼过了头，回落到它本来的分量。'); changed = true; }

    if (changed) save();
    return changed;
  }

  /* ---------- 每日重置 ---------- */
  function rollDay() {
    var j = state(), today = todayStr();
    if (j.today.date !== today) {
      j.today = { date: today, adventures: 0 };
      save();
    }
  }

  /* ---------- 日志 ---------- */
  function log(text) {
    var j = state();
    j.log.unshift({ d: todayStr(), t: text });
    if (j.log.length > LOG_KEEP) j.log.length = LOG_KEEP;
  }

  /* ---------- 玩家动作 ---------- */
  function earnHours(taskKey, taskName) {
    if (!hasContent()) return 0;
    var hours = WUXIA.TASK_HOURS[taskKey] || 1;
    var j = state();
    j.hours += hours;
    j.hoursTotal += hours;
    log('⛏️ ' + (taskName || '打卡') + '，偷得 ' + hours + ' 个时辰修炼。');
    save();
    return hours;
  }

  function cultivate() {
    var j = state();
    rollDay();
    if (j.hours < 1) { showToast('没有修炼时辰了，先去台账打卡', 'warning'); return; }
    j.hours -= 1;
    var s = stats();
    var internal = bestSkill('internal');
    var before = realmIndex();
    var gain = Math.round(HOUR_EXP * (1 + s.wuxing * 0.06 + skillLevel(internal && internal.id) * 0.12));
    j.exp += gain;
    var note = '运功一个时辰，修为 +' + gain;
    if (Math.random() < 0.22) {
      var keys = ['neili', 'gengu', 'shenfa', 'wuxing'];
      var k = keys[Math.floor(Math.random() * keys.length)];
      j.stats[k] += 1;
      note += '，' + WUXIA.STATS[k] + ' +1';
    }
    if (realmIndex() > before) {
      note += '｜境界提升到「' + realm().name + '」：' + realm().aura;
      showToast('🎉 突破到 ' + realm().name, 'success');
    }
    log(note + '。');
    save();
    rerender();
  }

  function learnCost(skill) {
    var level = skillLevel(skill.id) + 1;
    return { hours: skill.cost.hours * level, taels: skill.cost.taels * level };
  }
  function learn(id) {
    var j = state();
    var skill = WUXIA.SKILLS.filter(function (s) { return s.id === id; })[0];
    if (!skill) return;
    var level = skillLevel(id);
    if (level >= skill.max) { showToast('这门功夫已练到顶', 'info'); return; }
    if (skill.sect && j.sect !== skill.sect && level === 0) {
      showToast('那是' + sectName(skill.sect) + '的功夫，先拜对应门派', 'warning'); return;
    }
    if (realmIndex() < skill.need) {
      showToast('境界不够，需先入「' + WUXIA.REALMS[skill.need].name + '」', 'warning'); return;
    }
    var cost = learnCost(skill);
    if (j.hours < cost.hours) { showToast('时辰不足，还需 ' + cost.hours, 'warning'); return; }
    if (j.taels < cost.taels) { showToast('银两不足，还需 ' + cost.taels + ' 两', 'warning'); return; }
    j.hours -= cost.hours;
    j.taels -= cost.taels;
    j.skills[id] = level + 1;
    log('📜 练成「' + skill.name + '」第 ' + (level + 1) + ' 层。');
    save();
    rerender();
  }

  function pickEvent() {
    var j = state(), r = realmIndex(), sc = sect();
    var pool = WUXIA.EVENTS.filter(function (e) { return e.minRealm <= r; });
    var total = 0;
    var weights = pool.map(function (e) {
      var w = e.weight || 1;
      if (sc) {
        e.tags.forEach(function (tag) {
          var bias = (sc.weight && sc.weight[tag]) || 0;
          w *= (1 + bias * 0.5);
        });
      }
      if (j.recent && j.recent.indexOf(e.id) >= 0) w *= 0.25;   // 刚演过的先压住
      total += w;
      return w;
    });
    var roll = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function adventure() {
    var j = state();
    rollDay();
    if (j.today.adventures >= DAILY_ADVENTURES) {
      showToast('今日江湖事已了，明天再出门', 'warning'); return;
    }
    if (j.hours < 1) { showToast('没有修炼时辰了，先去台账打卡', 'warning'); return; }
    j.hours -= 1;
    j.today.adventures += 1;
    var event = pickEvent();
    j.recent = (j.recent || []).concat([event.id]).slice(-4);
    j.pending = { id: event.id };
    log('🧭 出门闯荡：' + event.title);
    save();
    rerender();
  }

  function applyOutcome(outcome) {
    var j = state(), g = outcome.gain || {}, l = outcome.lose || {};
    if (g.exp) j.exp += g.exp;
    if (g.taels) j.taels += g.taels;
    if (g.hours) j.hours += g.hours;
    if (g.stat) { Object.keys(g.stat).forEach(function (k) { j.stats[k] += g.stat[k]; }); }
    if (l.taels) j.taels = Math.max(0, j.taels - l.taels);
    var bits = [];
    if (g.exp) bits.push('修为 +' + g.exp);
    if (g.taels) bits.push('银两 +' + g.taels);
    if (l.taels) bits.push('银两 -' + l.taels);
    if (g.stat) { Object.keys(g.stat).forEach(function (k) { bits.push(WUXIA.STATS[k] + ' +' + g.stat[k]); }); }
    return bits.length ? '（' + bits.join('，') + '）' : '';
  }

  // 条件只在这里判一次：按钮置灰与真正结算共用，避免绕过界面。
  function meets(need) {
    if (!need) return { ok: true, hint: '' };
    if (need.stat) {
      var s = stats();
      for (var k in need.stat) {
        if (s[k] < need.stat[k]) {
          return { ok: false, hint: '需' + WUXIA.STATS[k] + ' ' + need.stat[k] };
        }
      }
    }
    if (need.skill && !skillLevel(need.skill)) {
      return { ok: false, hint: '需练过「'
        + (WUXIA.SKILLS.filter(function (x) { return x.id === need.skill; })[0] || {}).name + '」' };
    }
    return { ok: true, hint: '' };
  }

  function choose(index) {
    var j = state();
    if (!j.pending) return;
    var event = WUXIA.EVENTS.filter(function (e) { return e.id === j.pending.id; })[0];
    if (!event) { j.pending = null; save(); rerender(); return; }
    var choice = (event.choices || [])[index];
    if (!choice) return;
    var gate = meets(choice.requires);
    if (!gate.ok) { showToast(gate.hint, 'warning'); return; }
    var cost = (choice.cost || {}).hours || 0;
    if (j.hours < cost) { showToast('时辰不足，这一节要 ' + cost + ' 个时辰', 'warning'); return; }
    j.hours -= cost;
    var outcomes = choice.outcomes;
    var picked = outcomes[outcomes.length - 1];
    if (outcomes.length > 1) {
      for (var i = 0; i < outcomes.length - 1; i++) {
        if (Math.random() < (outcomes[i].at == null ? 0.5 : outcomes[i].at)) { picked = outcomes[i]; break; }
      }
    }
    var tail = applyOutcome(picked);
    log('「' + event.title + '」' + picked.text + tail);
    if (picked.foe) {
      startDuel(picked.foe, picked.text + tail);
      return;
    }
    j.pending = null;
    save();
    rerender();
  }

  function decline() {
    var j = state();
    j.pending = null;
    log('你转身走了，江湖事多半是这样错过的。');
    save();
    rerender();
  }

  /* ---------- 切磋（回合制） ---------- */
  function startDuel(foeId, intro) {
    var j = state();
    var foe = WUXIA.FOES.filter(function (f) { return f.id === foeId; })[0];
    if (!foe) { j.pending = null; save(); rerender(); return; }
    j.duel = { foe: foe.id, foeHp: foe.hp, hp: maxHp(), round: 1, guard: false,
               lines: [(intro ? intro + ' ' : '') + '「' + foe.name + '」拦在面前：' + foe.blurb] };
    save();
    rerender();
  }

  function foeTurn(d, foe) {
    var def = stats().gengu * 0.4 + skillLevel((bestSkill('internal') || {}).id) * 1.5;
    var dmg = Math.max(1, Math.round(foe.atk * (0.8 + Math.random() * 0.5) - def));
    if (d.guard) { dmg = Math.max(0, Math.round(dmg * 0.4)); }
    if (!d.guard && Math.random() < stats().shenfa * 0.012) {
      d.lines.unshift('第 ' + d.round + ' 回合：你侧身让过「' + foe.name + '」这一手。');
      return;
    }
    d.hp -= dmg;
    d.lines.unshift('第 ' + d.round + ' 回合：「' + foe.name + '」伤了你对脉，-' + dmg + ' 气血。');
  }

  function spar(action) {
    var j = state();
    if (!j.duel) return;
    var d = j.duel;
    var foe = WUXIA.FOES.filter(function (f) { return f.id === d.foe; })[0];
    if (!foe) {
      j.duel = null; j.pending = null;
      log('那位对手已不知去向，这一场就此作罢。');
      save(); rerender(); return;
    }
    var strike = bestSkill('strike'), movement = bestSkill('movement');
    var internal = bestSkill('internal');
    d.guard = false;

    if (action === 'strike') {
      var base = power() * 0.5 + skillLevel(strike && strike.id) * 2.5;
      var dmg = Math.max(1, Math.round(base * (0.8 + Math.random() * 0.5) - foe.def));
      d.foeHp -= dmg;
      d.lines.unshift('第 ' + d.round + ' 回合：你以「' + ((strike && strike.name) || '乱拳')
        + '」进招，伤他 ' + dmg + '。');
    } else if (action === 'guard') {
      d.guard = true;
      d.lines.unshift('第 ' + d.round + ' 回合：你沉肩坠肘，只守不攻。');
    } else if (action === 'breath') {
      var heal = 8 + stats().neili + skillLevel(internal && internal.id) * 3;
      d.hp = Math.min(maxHp(), d.hp + heal);
      d.lines.unshift('第 ' + d.round + ' 回合：你借势运功，回 ' + heal + ' 气血。');
    } else if (action === 'slip') {
      var odds = 0.25 + stats().shenfa * 0.02 + skillLevel(movement && movement.id) * 0.05;
      if (Math.random() < odds) {
        d.lines.unshift('第 ' + d.round + ' 回合：你用了「' + ((movement && movement.name) || '燕子抄水')
          + '」，脱身而出。');
        return finishDuel(null, true);
      }
      d.lines.unshift('第 ' + d.round + ' 回合：你想走，被他一把揪住后襟。');
    }

    if (d.foeHp <= 0) return finishDuel(true, false);
    foeTurn(d, foe);
    if (d.hp <= 0) return finishDuel(false, false);
    d.round += 1;
    d.lines = d.lines.slice(0, 8);
    save();
    rerender();
  }

  function finishDuel(won, fled) {
    var j = state(), d = j.duel;
    var foe = WUXIA.FOES.filter(function (f) { return f.id === d.foe; })[0];
    j.duel = null;
    j.pending = null;
    if (!foe) { save(); rerender(); return; }
    if (won) {
      j.wins += 1;
      j.exp += foe.exp;
      j.taels += foe.taels;
      log('🏆 胜「' + foe.name + '」，修为 +' + foe.exp + '，银两 +' + foe.taels + '。');
      showToast('你赢了：' + foe.name, 'success');
    } else if (fled) {
      log('🏃 从「' + foe.name + '」面前脱身，江湖路长，不必每场都打。');
    } else {
      j.losses += 1;
      var paid = Math.min(j.taels, 20 + realmIndex() * 15);
      j.taels -= paid;
      log('🩸 败给「' + foe.name + '」，赔了 ' + paid + ' 两药钱。');
      showToast('你输了：' + foe.name, 'danger');
    }
    save();
    rerender();
  }

  function joinSect(id) {
    var j = state();
    // 只拦「当前门派仍然在册」的改投；门派被删掉时视同散人，允许重新拜师，
    // 否则旧存档会卡在「已入门墙」而永远拜不了任何门派。
    var cur = j.sect ? WUXIA.SECTS.filter(function (s) { return s.id === j.sect; })[0] : null;
    if (cur && j.sect !== id) { showToast('已入门墙，不能改换门派', 'warning'); return; }
    var sc = WUXIA.SECTS.filter(function (s) { return s.id === id; })[0];
    if (!sc) return;
    j.sect = id;
    if (!j.skills[sc.start]) j.skills[sc.start] = 1;
    log('🪧 你拜入' + sc.name + '，得入门功夫「'
      + (WUXIA.SKILLS.filter(function (s) { return s.id === sc.start; })[0] || {}).name + '」。');
    save();
    rerender();
  }

  /* ---------- 渲染 ---------- */
  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function rerender() {
    // currentPage 由工作台的 navTo() 同步到 window 上；不在本页时不抢渲染。
    if (global.currentPage === 'jianghu' && global.navTo) global.navTo('jianghu');
  }

  function cardHtml() {
    var j = state(), s = stats(), sc = sect();
    var next = WUXIA.REALMS[realmIndex() + 1];
    return '<div class="card"><div class="module-header"><div class="mh-icon">⚔️</div><div>'
      + '<div class="mh-title">' + (sc ? sc.name + '门弟子' : '无名散人') + '｜' + realm().name + '</div>'
      + '<div class="mh-desc">' + esc(realm().aura) + '｜战力 ' + power() + '｜气血 ' + maxHp() + '</div>'
      + '</div><div class="mh-spacer"></div>'
      + '<div style="text-align:right;font-size:13px;">时辰 <b>' + j.hours + '</b>｜银两 <b>' + j.taels + '</b>'
      + '<br><span style="opacity:.7;">' + (next ? '距「' + next.name + '」还需 ' + (next.need - j.exp) + ' 修为' : '已至此身极致') + '</span></div>'
      + '</div><div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 4px 6px;">'
      + ['neili', 'gengu', 'shenfa', 'wuxing'].map(function (k) {
          return '<span class="badge"> ' + WUXIA.STATS[k] + ' ' + s[k] + '</span>';
        }).join('')
      + partners().map(function (p) {
          return '<span class="badge" title="宠物伙伴加成">🐾 ' + esc(p.name) + '·' + esc(p.label) + '</span>';
        }).join('')
      + '</div></div>';
  }

  function sectHtml() {
    var j = state();
    if (j.sect) return '';
    return '<div class="card"><div class="mh-title" style="padding:8px 4px 4px;">尚未入门</div>'
      + '<div class="mh-desc" style="padding:0 4px 8px;">三家门派都在收人，拜进去就不好改了。</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      + WUXIA.SECTS.map(function (s) {
          return '<div class="shop-item" style="width:200px;"><div class="si-name">' + s.name + '</div>'
            + '<div class="si-desc">' + esc(s.blurb) + '<br>入门加 '
            + Object.keys(s.bonus).map(function (k) { return WUXIA.STATS[k] + ' +' + s.bonus[k]; }).join('、')
            + '</div><button class="btn btn-gold" style="width:100%;" onclick="Jianghu.joinSect(\'' + s.id + '\')">拜山</button></div>';
        }).join('') + '</div></div>';
  }

  function skillsHtml() {
    var j = state();
    var rows = WUXIA.SKILLS.filter(function (s) {
      return !s.sect || s.sect === j.sect || skillLevel(s.id) > 0;
    }).map(function (s) {
      var level = skillLevel(s.id), cost = learnCost(s), maxed = level >= s.max;
      var can = !maxed && realmIndex() >= s.need && j.hours >= cost.hours && j.taels >= cost.taels;
      return '<tr><td>' + s.name + '<div style="opacity:.6;font-size:11px;">' + esc(s.blurb) + '</div></td>'
        + '<td style="width:70px;">' + { internal: '心法', strike: '招式', movement: '身法' }[s.kind] + '</td>'
        + '<td style="width:60px;">' + level + ' / ' + s.max + '</td>'
        + '<td style="width:120px;">' + (maxed ? '已练到顶' : cost.hours + ' 时辰 · ' + cost.taels + ' 两') + '</td>'
        + '<td style="width:80px;"><button class="btn btn-outline" ' + (can ? '' : 'disabled ')
        + 'onclick="Jianghu.learn(\'' + s.id + '\')">' + (level ? '精进' : '习得') + '</button></td></tr>';
    });
    return '<div class="card"><div class="mh-title" style="padding:8px 4px;">武学</div>'
      + '<table class="table" style="width:100%;">' + rows.join('') + '</table></div>';
  }

  function eventHtml() {
    var j = state();
    if (!j.pending) {
      return '<div class="card"><div class="mh-title" style="padding:8px 4px;">今日江湖事</div>'
        + '<div class="mh-desc" style="padding:0 4px 8px;">已闯荡 ' + j.today.adventures + ' / '
        + DAILY_ADVENTURES + ' 次。一次时辰换一段际遇，也可能换一场架。</div>'
        + '<button class="btn btn-gold" ' + (j.hours >= 1 && j.today.adventures < DAILY_ADVENTURES ? '' : 'disabled ')
        + 'onclick="Jianghu.adventure()">出门闯荡</button></div>';
    }
    var e = WUXIA.EVENTS.filter(function (x) { return x.id === j.pending.id; })[0];
    if (!e) return '';
    return '<div class="card"><div class="mh-title" style="padding:8px 4px;">' + e.title + '</div>'
      + '<div class="mh-desc" style="padding:0 4px 10px;line-height:1.8;">' + esc(e.text) + '</div>'
      + e.choices.map(function (c, i) {
          var gate = meets(c.requires);
          var cost = (c.cost || {}).hours || 0;
          var ok = gate.ok && (!cost || j.hours >= cost);
          var hint = gate.ok ? (cost && j.hours < cost ? '需 ' + cost + ' 时辰' : '') : gate.hint;
          return '<button class="btn btn-outline" style="display:block;width:100%;text-align:left;margin:4px 0;" '
            + (ok ? '' : 'disabled ') + 'onclick="Jianghu.choose(' + i + ')">'
            + esc(c.label) + (cost ? '<span style="opacity:.6;">（' + cost + ' 时辰）</span>' : '')
            + (hint ? '<span style="color:var(--danger);"> ' + esc(hint) + '</span>' : '') + '</button>';
        }).join('')
      + '<button class="btn btn-outline" style="margin-top:6px;" onclick="Jianghu.decline()">收手回屋</button></div>';
  }

  function duelHtml() {
    var j = state();
    if (!j.duel) return '';
    var d = j.duel;
    var foe = WUXIA.FOES.filter(function (f) { return f.id === d.foe; })[0];
    if (!foe) return '';
    return '<div class="card"><div class="mh-title" style="padding:8px 4px;">切磋｜第 ' + d.round + ' 回合</div>'
      + '<div class="mh-desc" style="padding:0 4px 8px;">你 ' + Math.max(0, d.hp) + ' / ' + maxHp()
      + ' 气血｜「' + foe.name + '」 ' + Math.max(0, d.foeHp) + ' / ' + foe.hp + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn btn-gold" onclick="Jianghu.spar(\'strike\')">进招</button>'
      + '<button class="btn btn-outline" onclick="Jianghu.spar(\'guard\')">守势</button>'
      + '<button class="btn btn-outline" onclick="Jianghu.spar(\'breath\')">运功调息</button>'
      + '<button class="btn btn-outline" onclick="Jianghu.spar(\'slip\')">轻身脱身</button></div>'
      + '<div style="margin-top:10px;font-size:12px;line-height:1.9;opacity:.85;">'
      + d.lines.map(function (l) { return '<div>· ' + esc(l) + '</div>'; }).join('') + '</div></div>';
  }

  function hoursRange() {
    var vals = [];
    Object.keys(WUXIA.TASK_HOURS).forEach(function (k) { vals.push(WUXIA.TASK_HOURS[k]); });
    vals.sort(function (a, b) { return a - b; });
    return vals[0] + '~' + vals[vals.length - 1];
  }

  function actionsHtml() {
    var j = state();
    return '<div class="card"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:4px;">'
      + '<button class="btn btn-gold" ' + (j.hours >= 1 ? '' : 'disabled ')
      + 'onclick="Jianghu.cultivate()">闭关一个时辰</button>'
      + '<span style="opacity:.7;font-size:12px;">台账打卡一次给 ' + hoursRange()
      + ' 个时辰，领金币的那一下就是这里的柴。</span></div></div>';
  }

  function logHtml() {
    var j = state();
    return '<div class="card"><div class="mh-title" style="padding:8px 4px;">近事</div>'
      + '<div style="font-size:12px;line-height:1.9;opacity:.85;">'
      + (j.log.length ? j.log.map(function (l) {
          return '<div>· <span style="opacity:.6;">' + l.d + '</span> ' + esc(l.t) + '</div>';
        }).join('') : '<div>还没有故事。去台账打一次卡，再出门。</div>') + '</div></div>';
  }

  function render() {
    if (!hasContent()) {
      return '<div class="empty-state"><div class="es-icon">⚔️</div>'
        + '<div class="es-text">缺少 wuxia-content.js，江湖暂时空无一人</div></div>';
    }
    sanitize();
    rollDay();
    return cardHtml() + sectHtml() + actionsHtml()
      + (state().duel ? duelHtml() : eventHtml())
      + skillsHtml() + logHtml();
  }

  global.Jianghu = { render: render, sanitize: sanitize, earnHours: earnHours, cultivate: cultivate, learn: learn,
                     adventure: adventure, choose: choose, decline: decline, spar: spar,
                     joinSect: joinSect, realm: realm, power: power, stats: stats,
                     _pickEvent: pickEvent };
  global.init_jianghu = function () {};
})(window);
