/* ============================================================
   江湖·内容库 —— 文字武侠游戏的纯数据层
   ------------------------------------------------------------
   只放数据，不放逻辑：逻辑在 江湖.js，校验在 tests/test_jianghu.py。
   schema（改字段请同步改这两处）：

   sects[]   { id, name, blurb, gate(入门条件文本), bonus{stat:n}, start(skillId), weight{tag:n} }
   realms[]  { id, name, need(累计修为), aura(一句气质描述) }
   skills[]  { id, name, sect|null(通用), kind: internal|strike|movement,
               need(境界下标), cost{hours,taels}, max(最大层数), power(每层战力), blurb }
   foes[]    { id, name, blurb, minRealm, hp, atk, def, taels, exp,
               drops[{ kind:'general', gear?, chance } | { kind:'sect', slot, chance }] }
   events[]  { id, title, tags[], minRealm, weight, text,
                           choices[]{ label, requires?{stat|skill|realm}, cost?{hours},
                                      outcomes[]{ at?(命中概率，缺省=兜底), text,
                                                  gain?{exp,taels,hours,stat,gear(装备 id)},
                                                  lose?{taels,hp}, foe?(切磋对手 id) } } }
   petBonuses { byId{petId:{label,bonus{stat:n}}}, default:{label,bonus{stat:n}} }
   gear[]    { id(槽_通用或门派_品阶), name, slot: weapon|armor|boots|charm, sect|null,
               tier: 0|1|2, bonus{stat:正整数}, price }
             加成合计等于品阶规格（0→2、1→4、2→6）；门派款一律 tier 1、价 350。

   requires 与 gain.stat 的 stat 名必须是 neili/gengu/shenfa/wuxing 四个之一。
   ============================================================ */
(function (global) {
  'use strict';

  var STATS = {
    neili: '内力', gengu: '根骨', shenfa: '身法', wuxing: '悟性'
  };

  var REALMS = [
    { id: 'liusan', name: '不入流', need: 0, aura: '在客栈里没人替你挡酒' },
    { id: 'sanliu', name: '三流', need: 60, aura: '能接镖师的三招' },
    { id: 'erliu', name: '二流', need: 180, aura: '名字在小圈子里有人提' },
    { id: 'yiliu', name: '一流', need: 420, aura: '官府愿意给你留三分脸面' },
    { id: 'jueding', name: '绝顶', need: 900, aura: '一句“认识一下”能换一张笑脸' },
    { id: 'zongshi', name: '宗师', need: 1800, aura: '你的招式开始被人抄错' }
  ];

  var SECTS = [
    { id: 'shaolin', name: '少林', blurb: '藏经阁前扫阶三年，先练身再练心',
      gate: '根骨为先', bonus: { gengu: 4 }, start: 'luohan',
      weight: { 寺观: 3, 镖行: 1, 恩怨: 1 } },
    { id: 'wudang', name: '武当', blurb: '紫霄峰上熬过夜的人，脾气都慢',
      gate: '内力为先', bonus: { neili: 4 }, start: 'taiji',
      weight: { 道观: 3, 论剑: 2, 奇遇: 1 } },
    { id: 'tangmen', name: '唐门', blurb: '蜀中暗器不轻易示人，示人必见血',
      gate: '身法为先', bonus: { shenfa: 4 }, start: 'hansha',
      weight: { 蜀道: 3, 悬赏: 2, 恩怨: 2 } }
  ];

  var SKILLS = [
    { id: 'tuna', name: '基础吐纳', sect: null, kind: 'internal', need: 0,
      cost: { hours: 2, taels: 0 }, max: 9, power: 2, blurb: '谁都会，很少有人天天练' },
    { id: 'yijin', name: '易筋经', sect: 'shaolin', kind: 'internal', need: 2,
      cost: { hours: 6, taels: 120 }, max: 9, power: 4, blurb: '一层一重骨，急不得' },
    { id: 'luohan', name: '罗汉拳', sect: 'shaolin', kind: 'strike', need: 0,
      cost: { hours: 3, taels: 20 }, max: 12, power: 3, blurb: '三十六路，打的就是正面' },
    { id: 'yiwei', name: '一苇渡江', sect: 'shaolin', kind: 'movement', need: 3,
      cost: { hours: 8, taels: 200 }, max: 6, power: 3, blurb: '轻功练到能省一双鞋' },
    { id: 'taiji', name: '太极心法', sect: 'wudang', kind: 'internal', need: 0,
      cost: { hours: 3, taels: 20 }, max: 12, power: 3, blurb: '以慢制快，先把自己熬住' },
    { id: 'siliang', name: '四两拨千斤', sect: 'wudang', kind: 'strike', need: 2,
      cost: { hours: 6, taels: 140 }, max: 9, power: 4, blurb: '借力打力，讲究一个准字' },
    { id: 'wudu', name: '五毒秘术', sect: 'tangmen', kind: 'internal', need: 2,
      cost: { hours: 6, taels: 150 }, max: 9, power: 4, blurb: '用药如用兵，先护住自己' },
    { id: 'hansha', name: '含沙射影', sect: 'tangmen', kind: 'strike', need: 0,
      cost: { hours: 3, taels: 25 }, max: 12, power: 3, blurb: '三枚铁莲，从不空放' },
    { id: 'feiyan', name: '飞燕逐月', sect: 'tangmen', kind: 'movement', need: 3,
      cost: { hours: 8, taels: 210 }, max: 6, power: 3, blurb: '进如掠水，退不见影' }
  ];

  var FOES = [
    // 掉落：通用款的品阶随敌人强度上移；门派款按槽位声明、运行时落到玩家本门对应件。
    { id: 'caihua', name: '采花贼', blurb: '轻功不错，正面不禁打', minRealm: 0,
      hp: 46, atk: 7, def: 2, taels: 18, exp: 12,
      drops: [{ kind: 'general', gear: 'weapon_general_t0', chance: 1 }] },
    { id: 'tangzishou', name: '镖局趟子手', blurb: '一口镖旗使得扎实', minRealm: 0,
      hp: 70, atk: 10, def: 5, taels: 30, exp: 20,
      drops: [{ kind: 'general', gear: 'armor_general_t0', chance: 0.6 }] },
    { id: 'guoshi', name: '苗疆蛊师', blurb: '不见人先闻香', minRealm: 1,
      hp: 88, atk: 15, def: 6, taels: 55, exp: 34,
      drops: [{ kind: 'general', gear: 'charm_general_t1', chance: 0.25 },
              { kind: 'sect', slot: 'weapon', chance: 0.35 }] },
    { id: 'qitu', name: '剑阁弃徒', blurb: '剑快，心更急', minRealm: 2,
      hp: 130, atk: 21, def: 10, taels: 90, exp: 55,
      drops: [{ kind: 'sect', slot: 'armor', chance: 0.3 },
              { kind: 'general', gear: 'weapon_general_t1', chance: 0.45 }] },
    { id: 'liwang', name: '西域力王', blurb: '一拳把门框打进屋里', minRealm: 2,
      hp: 190, atk: 25, def: 12, taels: 130, exp: 72,
      drops: [{ kind: 'general', gear: 'armor_general_t2', chance: 0.3 }] },
    { id: 'laogai', name: '无名老丐', blurb: '打狗棒法使得随意', minRealm: 3,
      hp: 240, atk: 30, def: 16, taels: 200, exp: 110,
      drops: [{ kind: 'sect', slot: 'boots', chance: 0.4 },
              { kind: 'sect', slot: 'charm', chance: 0.25 },
              { kind: 'general', gear: 'weapon_general_t2', chance: 0.2 }] }
  ];

  // 事件按 tags 与门派 weight 加权抽取；minRealm 是入场门槛。
  var EVENTS = [
    { id: 'temple-night', title: '古寺避雨', tags: ['寺观', '奇遇'], minRealm: 0, weight: 3,
      text: '山洪阻了路，你钻进一间塌了半边的伽蓝殿。火堆另一头坐着个不肯报姓名的行脚僧。',
      choices: [
        { label: '陪他坐到雨停，听他讲半部拳经', cost: { hours: 1 },
          outcomes: [{ text: '他讲得碎，你捡得多。', gain: { exp: 18, stat: { wuxing: 1 } } }] },
        { label: '趁他打坐，试他袖中那口铁禅杖', cost: { hours: 1 },
          outcomes: [{ at: 0.55, text: '他一杖点在你肩井上，笑骂“年轻人手痒”。你记住了这一杖怎么来的。',
                       gain: { exp: 26 } },
                     { text: '杖风扫过，你滚进雨里，狼狈但活着。', lose: { taels: 10 } }] },
        { label: '悄悄离开，雨小些再走',
          outcomes: [{ text: '殿外石阶湿滑，你什么也没得到，也没丢什么。' }] }
      ] },
    { id: 'escort-job', title: '顺路护镖', tags: ['镖行'], minRealm: 0, weight: 3,
      text: '振威镖局的趟子手缺个帮手，酬劳三十两，走的是夜路。',
      choices: [
        { label: '应下来，扛一面旗', cost: { hours: 2 },
          outcomes: [{ at: 0.7, text: '一路无事，镖银照数交割。', gain: { taels: 30, exp: 16 } },
                     { text: '林子里翻出两个人影，你守住车尾，旗没倒。', foe: 'tangzishou' }] },
        { label: '只走前半程，天黑前回家', cost: { hours: 1 },
          outcomes: [{ text: '半程十五两，你学会怎么看镖旗的暗号。', gain: { taels: 15, exp: 8 } }] }
      ] },
    { id: 'teahouse-rumor', title: '茶馆闲话', tags: ['悬赏', '恩怨'], minRealm: 0, weight: 3,
      text: '说书人讲到半句住了——他在等人接话。邻桌的捕头放下茶碗看你一眼。',
      choices: [
        { label: '接那句下半段', outcomes: [{ text: '你编得圆，捕头记下了你的脸。', gain: { exp: 6 } }] },
        { label: '问他贴的是哪张海捕文书', cost: { hours: 1 },
          outcomes: [{ at: 0.5, text: '赏格二十两，人今晚在城西赌坊。', gain: { exp: 10 }, foe: 'caihua' },
                     { text: '是桩旧案，说了你也插不上手。' }] }
      ] },
    { id: 'street-bully', title: '巷口不平', tags: ['恩怨'], minRealm: 0, weight: 3,
      text: '三个泼皮围着一个卖藕粉的老汉，摊子翻了一地。',
      choices: [
        { label: '进去一步，报个名号', outcomes: [{ at: 0.6, text: '泼皮散了，老汉多塞给你一碗藕粉。',
                 gain: { exp: 14 } }, { text: '你被推倒在藕粉里，钱袋也轻了些。', lose: { taels: 12 } }] },
        { label: '绕到背后，敲其中一人的后颈', cost: { hours: 1 },
          outcomes: [{ text: '一人倒地，其余两人抬着跑了。', gain: { exp: 18, taels: 6 }, foe: 'caihua' }] },
        { label: '装作没看见', outcomes: [{ text: '藕粉摊第二天还在，位置换了。你少睡了一个时辰。' }] }
      ] },
    { id: 'book-stall', title: '旧书摊', tags: ['奇遇'], minRealm: 0, weight: 2,
      text: '一本没有封皮的抄本压在菜种底下，摊主开价八十两，眼神躲闪。',
      choices: [
        { label: '验看字迹与纸色', requires: { stat: { wuxing: 8 } }, cost: { hours: 1 },
          outcomes: [{ at: 0.6, text: '是真抄本，虽然缺了后半。你花了二十两买了个教训的便宜。',
                       gain: { exp: 30 }, lose: { taels: 20 } },
                     { text: '是新墨做旧，你差点替人收藏假货。' }] },
        { label: '直接还价三十两', outcomes: [{ text: '摊主咬死八十，你走了两步他又喊你回来。', gain: { exp: 4 } }] }
      ] },
    { id: 'daoist-lose', title: '道观让茶', tags: ['道观'], minRealm: 1, weight: 3,
      text: '紫霄峰腰的破道观里，一个老道给你倒茶，茶碗上有两道指痕。',
      choices: [
        { label: '问他指痕是哪路功夫留下的', cost: { hours: 1 },
          outcomes: [{ text: '他没答，只把茶转了个方向。你忽然明白什么叫“不接招”。',
                       gain: { exp: 28, stat: { neili: 1 } } }] },
        { label: '陪他下了三局棋', cost: { hours: 2 },
          outcomes: [{ at: 0.5, text: '你输了两局，但看懂了他弃子的手法。', gain: { exp: 34, stat: { wuxing: 1 } } },
                     { text: '三局全输。老道说你的心不在棋盘上。', gain: { exp: 10 } }] }
      ] },
    { id: 'night-patrol', title: '城墙夜巡', tags: ['悬赏'], minRealm: 2, weight: 3,
      text: '守城千总悬赏五十两，要人替他查清楚夜里翻城墙的是谁。',
      choices: [
        { label: '在城砖上撒一层细灰，蹲到天亮', cost: { hours: 2 },
          outcomes: [{ text: '脚印两双，方向相反——是内应。', gain: { exp: 22 }, foe: 'caihua' }] },
        { label: '直接翻上城墙看', cost: { hours: 1 },
          outcomes: [{ at: 0.55, text: '你看见一个人从内侧开了门洞。', gain: { exp: 18 }, foe: 'qitu' },
                     { text: '风大，你只看见自己的衣角。', gain: { exp: 6 } }] }
      ] },
    { id: 'poison-well', title: '村里那口甜井', tags: ['苗疆', '奇遇'], minRealm: 1, weight: 2,
      text: '井水发甜，三家病倒。村长说前几日有个背篓客在井边洗过手。',
      choices: [
        { label: '顺味寻到那个背篓客', cost: { hours: 2 },
          outcomes: [{ text: '他在祠堂后山，脚边摆着七八个陶罐。', foe: 'guoshi' }] },
        { label: '先封井，再配一副解药', requires: { skill: 'wudu' }, cost: { hours: 2 },
          outcomes: [{ text: '药性压住了三家，村长把族里存的一坛药酒给了你。',
                       gain: { exp: 30, taels: 40 } }] }
      ] },
    { id: 'sword-arena', title: '小论剑', tags: ['论剑'], minRealm: 2, weight: 3,
      text: '府城外搭了木台，二十岁以下自己报名，输了留一句“承让”。',
      choices: [
        { label: '上台', cost: { hours: 2 },
          outcomes: [{ at: 0.5, text: '三场皆胜，台下有人开始记你的名字。', gain: { exp: 40, taels: 60, gear: 'weapon_general_t1' } },
                     { text: '第二场遇个用剑不要命的，你退了两步。', gain: { exp: 26 }, foe: 'qitu' }] },
        { label: '坐在台下看完一整天', cost: { hours: 2 },
          outcomes: [{ text: '你记下七种起手式，回家拆给沙包练。', gain: { exp: 24, stat: { wuxing: 1 } } }] }
      ] },
    { id: 'caravan-rescue', title: '沙口商的求救', tags: ['西域', '镖行'], minRealm: 2, weight: 2,
      text: '一支商队被堵在隘口，领头的比划了半天：他们请不动官府，只能请江湖。',
      choices: [
        { label: '带他们走干河道，绕开隘口', cost: { hours: 3 },
          outcomes: [{ at: 0.6, text: '水比人狠，但你算准了时辰。', gain: { exp: 44, taels: 100 } },
                     { text: '半道遇上巡夜的，只能打过去。', foe: 'liwang' }] },
        { label: '正面进隘口喊话', outcomes: [{ text: '你喊的名字不管用，人家把石头推了下来。',
                 lose: { taels: 30 } }] }
      ] },
    { id: 'sibling-debt', title: '同门的旧账', tags: ['恩怨', '寺观'], minRealm: 2, weight: 2,
      text: '当年替你挨过一棍的人找上门，要你还的不是钱，是一句话。',
      choices: [
        { label: '当众把那句话说了', outcomes: [{ text: '话说完，你轻了三年。', gain: { exp: 36, stat: { gengu: 1 } } }] },
        { label: '请他进屋，先喝一坛', cost: { hours: 2 },
          outcomes: [{ text: '他喝到第三碗才说真正想问的那件事。', gain: { exp: 28 }, lose: { taels: 20 } }] }
      ] },
    { id: 'secret-chamber', title: '塌出来的石室', tags: ['奇遇'], minRealm: 3, weight: 2,
      text: '山贼的寨子塌了半面墙，墙后是间刻满小字的石室，字被烟火熏过。',
      choices: [
        { label: '连夜拓下来', cost: { hours: 3 },
          outcomes: [{ at: 0.45, text: '拓到一半，有人举着火把进来了。', gain: { exp: 30 }, foe: 'laogai' },
                     { text: '你拓了整面墙，天亮时手在抖。', gain: { exp: 70, stat: { wuxing: 2 }, gear: 'charm_general_t1' } }] },
        { label: '只挑自己看得懂的两行', cost: { hours: 1 },
          outcomes: [{ text: '两行够你用十年。', gain: { exp: 40, stat: { neili: 2 } } }] }
      ] },
    { id: 'beggar-challenge', title: '挡路的老人', tags: ['论剑'], minRealm: 3, weight: 2,
      text: '桥心坐着个要饭的老人，竹竿横在膝上，不肯让。',
      choices: [
        { label: '从竹竿上跳过去', cost: { hours: 1 },
          outcomes: [{ at: 0.5, text: '过去了。身后竹竿挑起，你被敲在脚踝上——他教你一个落点。',
                       gain: { exp: 50, stat: { shenfa: 2 } } },
                     { text: '你跳得太用力，半道被他一竿点回岸边。', gain: { exp: 24 } }] },
        { label: '把干粮分一半给他，绕桥下走', outcomes: [{ text: '桥下湿冷，但你听见身后有人笑了一声。',
                 gain: { exp: 18 }, lose: { taels: 5 } }] }
      ] },
    { id: 'escort-ambush', title: '果然有埋伏', tags: ['镖行', '恩怨'], minRealm: 3, weight: 3,
      text: '第三次在同一处林道听见鸟叫，你知道这不是巧。',
      choices: [
        { label: '把镖车推到明处，人在暗处等', cost: { hours: 2 },
          outcomes: [{ text: '来的是老熟人，手里那口剑不像。', foe: 'qitu' }] },
        { label: '连夜换道，绕六十里', cost: { hours: 3 },
          outcomes: [{ text: '镖银安全，脚底磨穿。', gain: { exp: 34, taels: 40, stat: { gengu: 1 } } }] }
      ] },
    { id: 'hall-invite', title: '英雄帖', tags: ['论剑', '悬赏'], minRealm: 4, weight: 2,
      text: '请帖写得客气，末尾一句“愿闻新创之招”——这是要你看别人的，也是要看你的。',
      choices: [
        { label: '赴帖，带一门没使过的功夫', cost: { hours: 3 },
          outcomes: [{ at: 0.6, text: '你一招收势，满堂安静了三息。', gain: { exp: 90, taels: 150 } },
                     { text: '有人先使了同源的路子，你被将了一军。', gain: { exp: 46 }, foe: 'laogai' }] },
        { label: '回帖，说身上没带功夫', outcomes: [{ text: '回帖的人笑你会说话，你也笑得出。', gain: { exp: 20 } }] }
      ] },
    { id: 'plague-temple', title: '施药的庙', tags: ['寺观', '苗疆'], minRealm: 4, weight: 2,
      text: '山下设了粥棚与药摊，施药的僧人说缺一个会认脉的人。',
      choices: [
        { label: '留下三天，只认脉', cost: { hours: 4 },
          outcomes: [{ text: '第三天你已能隔着两个人看出谁在硬撑。',
                       gain: { exp: 70, stat: { wuxing: 2 } }, lose: { taels: 40 } }] },
        { label: '把身上的伤药全留下，走人', outcomes: [{ text: '你空手回山，路上睡得很沉。',
                 gain: { exp: 30 } }] }
      ] },
    { id: 'tomb-guards', title: '守墓人', tags: ['悬赏', '奇遇'], minRealm: 4, weight: 2,
      text: '前朝墓道被人挖开过两次，守墓的老兵请你走第三趟。',
      choices: [
        { label: '提灯走到底', cost: { hours: 2 },
          outcomes: [{ at: 0.5, text: '道尽头坐着一个人，手里那对判官笔很新。', foe: 'laogai' },
                     { text: '只有风，和一整面刻着名字的墙。', gain: { exp: 56 } }] },
        { label: '把新挖的那头封回去，不进去', requires: { stat: { shenfa: 14 } }, cost: { hours: 1 },
          outcomes: [{ at: 0.6, text: '半个时辰，洞口恢复成一座塌坡。墓里那对判官笔没出来。', gain: { exp: 44, taels: 30 } },
                     { text: '你封到一半，洞里递出一柄小锤——原来不止一个挖坑的。', gain: { exp: 14 } }] }
      ] },
    { id: 'inner-conflict', title: '行气岔了', tags: ['修炼'], minRealm: 2, weight: 3,
      text: '昨夜那口气没归位，今天胸口像压了块砖。',
      choices: [
        { label: '收功，改练两小时缓的', cost: { hours: 2 },
          outcomes: [{ text: '砖挪开了，你学会给自己留一手。', gain: { exp: 20, stat: { neili: 1 } } }] },
        { label: '硬运一个大周天', requires: { skill: 'taiji' }, cost: { hours: 1 },
          outcomes: [{ at: 0.6, text: '气走通了，像有人把河道重新挖直。', gain: { exp: 48, stat: { neili: 2 } } },
                     { text: '走了一半又岔回去，你咳了半宿。', lose: { taels: 25 } }] }
      ] },
    { id: 'apprentice', title: '有人背剑来敲门', tags: ['传承'], minRealm: 4, weight: 2,
      text: '少年在门口站了一早上，鞋是新的，剑是旧的。',
      choices: [
        { label: '先让他扫三个月院子', cost: { hours: 1 },
          outcomes: [{ text: '他扫得比你还认真。你想起自己当年没人肯收。', gain: { exp: 40 } }] },
        { label: '直接考他三问', cost: { hours: 1 },
          outcomes: [{ at: 0.5, text: '第三问答歪了，但歪得有自己的想法。', gain: { exp: 56, stat: { wuxing: 1 } } },
                     { text: '他答得太顺，你反而不敢收。', gain: { exp: 18 } }] }
      ] },
    { id: 'final-duel', title: '当年那一棍', tags: ['传承', '论剑'], minRealm: 5, weight: 1,
      text: '你终于找到那个人。他老了，也认得你，把棍横过来递给你。',
      choices: [
        { label: '接棍，把这一场打完', cost: { hours: 3 },
          outcomes: [{ text: '他打得很认真，也很慢。', foe: 'laogai', gain: { exp: 120 } }] },
        { label: '把棍还给他，请他喝酒', outcomes: [{ text: '喝到后来他哭了，你替他守着门。',
                 gain: { exp: 80, stat: { gengu: 2 } }, lose: { taels: 60 } }] }
      ] },
    { id: 'smuggler-boat', title: '夜渡的船', tags: ['蜀道', '悬赏'], minRealm: 1, weight: 2,
      text: '江上只有一条船肯走夜水，船主问你是要快还是要安静。',
      choices: [
        { label: '要快', cost: { hours: 1 },
          outcomes: [{ at: 0.5, text: '水急，你被颠得把早饭吐在舱板上——但赶上了。', gain: { exp: 20, taels: 30 } },
                     { text: '下游十里才捞稳船。', lose: { taels: 20 } }] },
        { label: '要安静', cost: { hours: 2 },
          outcomes: [{ text: '舱底有六口箱子，没人掀开过。你什么也没问。', gain: { exp: 26 }, foe: 'guoshi' }] }
      ] },
    { id: 'shu-road', title: '蜀道上的铃', tags: ['蜀道'], minRealm: 2, weight: 2,
      text: '栈道上挂着铃，铃响的顺序不对——有人在试你的脚步。',
      choices: [
        { label: '按他响的节奏走', requires: { stat: { shenfa: 12 } }, cost: { hours: 1 },
          outcomes: [{ text: '你走到他面前，他抱拳：唐门的人认路不认人。', gain: { exp: 44, stat: { shenfa: 1 } } }] },
        { label: '停下，等他自己出来', outcomes: [{ text: '风停了，铃也停了。', gain: { exp: 16 }, foe: 'caihua' }] }
      ] }
  ];

  // 宠物庭院里的伙伴给被动加成；没点名的走 default，新宠物不会掉队。
  var PET_BONUSES = {
    byId: {
      'huhu-carrot': { label: '小太阳', bonus: { gengu: 1 } },
      '3leaf': { label: '敲键盘的手速', bonus: { shenfa: 2 } },
      'emotion': { label: '八种表情', bonus: { wuxing: 1 } },
      'plush-emotion': { label: '毛绒表情', bonus: { wuxing: 1 } },
      'huhu-carrot-office': { label: '久坐不塌腰', bonus: { neili: 1 } },
      'raccoon-typing': { label: '熬夜不困', bonus: { neili: 2 } },
      'dundun-office': { label: '顶得住', bonus: { gengu: 2 } },
      'bear': { label: '钓得稳', bonus: { wuxing: 2 } },
      'peach-plush': { label: '果园常客', bonus: { gengu: 1 } },
      'peach-flat': { label: '扁平画风', bonus: { shenfa: 1 } },
      'apple-red': { label: '红苹果', bonus: { neili: 1 } },
      'apple-red-flat': { label: '红苹果·扁平', bonus: { neili: 1 } },
      'apple-green': { label: '青苹果', bonus: { wuxing: 1 } },
      'apple-green-flat': { label: '青苹果·扁平', bonus: { wuxing: 1 } },
      'radish': { label: '缨子重', bonus: { gengu: 1 } },
      'radish-flat': { label: '圆缨·扁平', bonus: { shenfa: 1 } },
      // v2 扩展包：特殊款
      'headphone': { label: '单曲循环', bonus: { neili: 2 } },
      'resources': { label: '安全第一', bonus: { gengu: 2 } },
      'strawhat-orange-plush': { label: '帽檐遮光', bonus: { neili: 1 } },
      'strawhat-orange-flat': { label: '草帽·扁平', bonus: { shenfa: 1 } },
      'rabbit-plush': { label: '弹跳力', bonus: { shenfa: 2 } },
      'rabbit-flat': { label: '白兔·扁平', bonus: { shenfa: 1 } },
      'bee-plush': { label: '嗡嗡不停', bonus: { shenfa: 2 } },
      'bee-flat': { label: '蜜蜂·扁平', bonus: { wuxing: 1 } },
      // v2 扩展包：mojo 果园家族
      'mojo-banana-plush': { label: '香蕉皮', bonus: { shenfa: 1 } },
      'mojo-banana-flat': { label: '香蕉·扁平', bonus: { shenfa: 1 } },
      'mojo-cherries-plush': { label: '成双成对', bonus: { gengu: 1 } },
      'mojo-cherries-flat': { label: '樱桃·扁平', bonus: { gengu: 1 } },
      'mojo-peapod-plush': { label: '三颗豆', bonus: { gengu: 1 } },
      'mojo-peapod-flat': { label: '豌豆·扁平', bonus: { wuxing: 1 } },
      'mojo-pumpkin-plush': { label: '沉甸甸', bonus: { gengu: 2 } },
      'mojo-pumpkin-flat': { label: '南瓜·扁平', bonus: { gengu: 1 } },
      'mojo-tomato-plush': { label: '红彤彤', bonus: { neili: 1 } },
      'mojo-tomato-flat': { label: '番茄·扁平', bonus: { neili: 1 } },
      'mojo-shrimp-plush': { label: '卷尾巴', bonus: { shenfa: 1 } },
      'mojo-shrimp-flat': { label: '炸虾·扁平', bonus: { shenfa: 1 } },
      'mojo-rose-plush': { label: '带刺的', bonus: { wuxing: 1 } },
      'mojo-rose-flat': { label: '玫瑰·扁平', bonus: { wuxing: 1 } },
      'mojo-drink-plush': { label: '补水回蓝', bonus: { neili: 1 } },
      'mojo-drink-flat': { label: '饮料·扁平', bonus: { neili: 1 } },
      'mojo-pomelo-plush': { label: '皮厚抗冻', bonus: { gengu: 1 } },
      'mojo-pomelo-flat': { label: '柚子·扁平', bonus: { gengu: 1 } }
    },
    default: { label: '陪着练', bonus: { gengu: 1 } }
  };

  // 打卡一次给多少修炼时辰：动脑的和动身的都给得多一点。
  var TASK_HOURS = {
    diet: 1, exercise: 3, accounting: 1, vocabulary: 3, amazon: 2, xiaohongshu: 2,
    todo: 2, planner: 2, body: 1, growth: 2, media: 2
  };

  // 装备：通用款按品阶分凡/精/珍三档，门派款只做精品一档，加成偏向本门身份属性。
  var GEAR = [
    // 通用款：武器偏内力与根骨，甲偏根骨，靴偏身法，佩饰偏悟性。
    { id: 'weapon_general_t0', name: '白铁短刀', slot: 'weapon', sect: null, tier: 0,
      bonus: { neili: 1, gengu: 1 }, price: 90 },
    { id: 'weapon_general_t1', name: '百炼雁翎刀', slot: 'weapon', sect: null, tier: 1,
      bonus: { neili: 2, gengu: 2 }, price: 320 },
    { id: 'weapon_general_t2', name: '玄铁无锋剑', slot: 'weapon', sect: null, tier: 2,
      bonus: { neili: 3, gengu: 3 }, price: 780 },
    { id: 'armor_general_t0', name: '粗布短打', slot: 'armor', sect: null, tier: 0,
      bonus: { gengu: 2 }, price: 70 },
    { id: 'armor_general_t1', name: '鱼鳞软甲', slot: 'armor', sect: null, tier: 1,
      bonus: { gengu: 4 }, price: 300 },
    { id: 'armor_general_t2', name: '乌金锁子甲', slot: 'armor', sect: null, tier: 2,
      bonus: { gengu: 6 }, price: 720 },
    { id: 'boots_general_t0', name: '麻底快靴', slot: 'boots', sect: null, tier: 0,
      bonus: { shenfa: 2 }, price: 80 },
    { id: 'boots_general_t1', name: '牛皮云头靴', slot: 'boots', sect: null, tier: 1,
      bonus: { shenfa: 4 }, price: 280 },
    { id: 'boots_general_t2', name: '踏雪无痕靴', slot: 'boots', sect: null, tier: 2,
      bonus: { shenfa: 6 }, price: 680 },
    { id: 'charm_general_t0', name: '桃木平安符', slot: 'charm', sect: null, tier: 0,
      bonus: { wuxing: 2 }, price: 110 },
    { id: 'charm_general_t1', name: '白玉扳指', slot: 'charm', sect: null, tier: 1,
      bonus: { wuxing: 4 }, price: 380 },
    { id: 'charm_general_t2', name: '古玉璇玑', slot: 'charm', sect: null, tier: 2,
      bonus: { wuxing: 6 }, price: 880 },
    // 少林款：根骨为先，棍与袍都沉。
    { id: 'weapon_shaolin_t1', name: '齐眉铁棍', slot: 'weapon', sect: 'shaolin', tier: 1,
      bonus: { neili: 1, gengu: 3 }, price: 350 },
    { id: 'armor_shaolin_t1', name: '木棉僧袍', slot: 'armor', sect: 'shaolin', tier: 1,
      bonus: { gengu: 4 }, price: 350 },
    { id: 'boots_shaolin_t1', name: '踏桩布鞋', slot: 'boots', sect: 'shaolin', tier: 1,
      bonus: { gengu: 2, shenfa: 2 }, price: 350 },
    { id: 'charm_shaolin_t1', name: '一百零八颗念珠', slot: 'charm', sect: 'shaolin', tier: 1,
      bonus: { gengu: 2, wuxing: 2 }, price: 350 },
    // 武当款：内力为先，剑与袍都慢。
    { id: 'weapon_wudang_t1', name: '七星长剑', slot: 'weapon', sect: 'wudang', tier: 1,
      bonus: { neili: 3, gengu: 1 }, price: 350 },
    { id: 'armor_wudang_t1', name: '紫霄道袍', slot: 'armor', sect: 'wudang', tier: 1,
      bonus: { neili: 2, gengu: 2 }, price: 350 },
    { id: 'boots_wudang_t1', name: '云履', slot: 'boots', sect: 'wudang', tier: 1,
      bonus: { neili: 2, shenfa: 2 }, price: 350 },
    { id: 'charm_wudang_t1', name: '太极玉佩', slot: 'charm', sect: 'wudang', tier: 1,
      bonus: { neili: 2, wuxing: 2 }, price: 350 },
    // 唐门款：身法为先，什么都轻。
    { id: 'weapon_tangmen_t1', name: '机簧袖弩', slot: 'weapon', sect: 'tangmen', tier: 1,
      bonus: { neili: 1, gengu: 1, shenfa: 2 }, price: 350 },
    { id: 'armor_tangmen_t1', name: '蜀锦软甲', slot: 'armor', sect: 'tangmen', tier: 1,
      bonus: { gengu: 3, shenfa: 1 }, price: 350 },
    { id: 'boots_tangmen_t1', name: '无音软底靴', slot: 'boots', sect: 'tangmen', tier: 1,
      bonus: { shenfa: 4 }, price: 350 },
    { id: 'charm_tangmen_t1', name: '淬毒针囊', slot: 'charm', sect: 'tangmen', tier: 1,
      bonus: { shenfa: 2, wuxing: 2 }, price: 350 }
  ];

  global.WUXIA = { STATS: STATS, REALMS: REALMS, SECTS: SECTS, SKILLS: SKILLS,
                   FOES: FOES, EVENTS: EVENTS, PET_BONUSES: PET_BONUSES,
                   TASK_HOURS: TASK_HOURS, GEAR: GEAR };
})(window);
