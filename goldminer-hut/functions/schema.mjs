/* 云表结构 —— 工作台 13 张业务表的唯一真源。
   两份说明：
   1. 列名：前端沿用中文键（EXTRACT/APPLY/rowCols 都按中文键读写），云库列名转 ASCII，
      翻译只发生在本目录的 handler 里，前端同步引擎一行不改。
   2. 类型：平台迁移只支持 boolean/integer/bigint/text/uuid/timestamptz/jsonb，
      没有 numeric/real。业务数值一律存 text（前端读回时用 num() 还原），
      只有勾选列用 boolean，避免任何非整数值把整批推送打挂。
   本文件同时被 tools/gen-migration.mjs 用来生成迁移 SQL 与访问策略。 */

/* 公共列：所有表都有 */
export const COMMON = ['id', 'owner', 'rid', 'updated_at'];

/* chinese: 前端使用的属性键；col: 云库列名；bool: 勾选列 */
export const TABLES = {
  ast: {
    cols: [
      ['金币', 'coins'], ['累计收入', 'total_earned'], ['累计支出', 'total_spent'],
      ['领取次数', 'total_claims'], ['本月收入', 'monthly_earned'], ['本月支出', 'monthly_spent'],
      ['今日收入', 'today_earned'], ['今日支出', 'today_spent'], ['最后活跃', 'last_active'],
      ['创建时间', 'created_on'], ['小屋主题', 'cabin_theme'],
      ['每日重置', 'daily_reset', true], ['消息通知', 'notifications', true], ['宠物提醒', 'pet_remind', true],
      ['今日单词', 'today_words'], ['今日单词日期', 'today_words_date'],
      ['今日视频序号', 'today_video_idx'], ['今日视频日期', 'today_video_date'],
    ],
  },
  meal: {
    cols: [
      ['日期', 'log_date'], ['餐次', 'meal'], ['食物', 'food'],
      ['热量', 'calories'], ['备注', 'note'], ['图片', 'image'],
    ],
  },
  wk: {
    cols: [
      ['日期', 'log_date'], ['类型', 'kind'], ['时长分钟', 'minutes'],
      ['体重', 'weight'], ['感受', 'feeling'], ['备注', 'note'], ['消耗热量', 'burned'],
    ],
  },
  acc: {
    cols: [
      ['日期', 'log_date'], ['类型', 'kind'], ['类别', 'category'],
      ['金额', 'amount'], ['备注', 'note'], ['凭证', 'receipt'],
    ],
  },
  voc: {
    cols: [
      ['单词', 'word'], ['音标', 'phonetic'], ['释义', 'meaning'],
      ['已掌握', 'memorized', true], ['加入日期', 'added_date'],
    ],
  },
  amz: {
    cols: [
      ['日期', 'log_date'], ['视频标题', 'video_title'], ['视频话题', 'video_topic'],
      ['核心要点', 'key_points'], ['洞察', 'insights'], ['行动', 'actions'],
    ],
  },
  xhs: {
    cols: [
      ['日期', 'log_date'], ['标题', 'title'], ['选题', 'idea'], ['受众', 'audience'],
      ['形式', 'form'], ['提纲', 'outline'], ['文案', 'script'], ['分镜', 'storyboard'],
      ['话题标签', 'tags'],
    ],
  },
  inv: {
    cols: [
      ['物品ID', 'item_id'], ['类别', 'kind'], ['名称', 'name'], ['图标', 'icon'],
      ['描述', 'description'], ['数量', 'qty'], ['效果', 'effect'], ['尺寸', 'slot_size'],
      ['价格', 'price'],
    ],
  },
  pet: {
    cols: [
      ['宠物ID', 'pet_id'], ['商城ID', 'shop_id'], ['名字', 'name'], ['类型', 'kind'], ['图标', 'icon'],
      ['饱食度', 'hunger'], ['心情', 'mood'], ['健康', 'health'], ['等级', 'level'], ['经验', 'exp'],
      ['领养时间', 'adopted_at'], ['最近更新', 'last_update'], ['最近互动', 'last_interact'],
    ],
  },
  cab: {
    cols: [['槽位', 'slot'], ['物品ID', 'item_id'], ['名称', 'name'], ['图标', 'icon']],
  },
  ach: {
    cols: [['成就ID', 'achievement_id']],
  },
  chk: {
    cols: [
      ['日期', 'log_date'], ['时间戳', 'ts'], ['任务KEY', 'task_key'],
      ['任务名', 'task_name'], ['金币', 'coins'],
    ],
  },
  rpt: {
    cols: [['类型', 'kind'], ['日期', 'log_date'], ['内容', 'payload']],
  },
};

export const TABLE_KEYS = Object.keys(TABLES);

/* 每个表的列定义展开成 { chinese, col, bool } 便于 handler 使用 */
export function tableDef(key) {
  const def = TABLES[key];
  if (!def) return null;
  return def.cols.map(([chinese, col, bool]) => ({ chinese, col, bool: !!bool }));
}

/* 每张表的业务列 DDL 片段（迁移用） */
export function businessColumns(key) {
  return tableDef(key).map(({ col, bool }) => `${col} ${bool ? 'boolean' : 'text'}`);
}

/* 账号体系的建表语句（D1）。不属于 13 张业务表：它们不参与前端同步层，
   由 functions/session.mjs 直接读写。tomb 是 A2 增量拉取要用的墓碑表。 */
export function accountDdl() {
  return [
    `CREATE TABLE IF NOT EXISTS "users" (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  nickname TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
)`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "users_username_u" ON "users" (username)',
    'CREATE UNIQUE INDEX IF NOT EXISTS "users_email_u" ON "users" (email) WHERE email IS NOT NULL',
    `CREATE TABLE IF NOT EXISTS "sessions" (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ua TEXT
)`,
    'CREATE INDEX IF NOT EXISTS "sessions_expires" ON "sessions" (expires_at)',
    'CREATE INDEX IF NOT EXISTS "sessions_user" ON "sessions" (user_id)',
    `CREATE TABLE IF NOT EXISTS "invites" (
  code TEXT PRIMARY KEY,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  used_by TEXT,
  used_at TEXT
)`,
    'CREATE INDEX IF NOT EXISTS "invites_used_by" ON "invites" (used_by)',
    `CREATE TABLE IF NOT EXISTS "devices" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
)`,
    'CREATE INDEX IF NOT EXISTS "devices_user" ON "devices" (user_id)',
    `CREATE TABLE IF NOT EXISTS "tomb" (
  owner TEXT NOT NULL,
  tbl TEXT NOT NULL,
  rid TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (owner, tbl, rid)
)`,
    'CREATE INDEX IF NOT EXISTS "tomb_owner_ts" ON "tomb" (owner, ts)',
  ];
}

/* A2 的增量拉取按 (owner, updated_at) 过滤。索引现在就建，免得迁移再改一次。 */
export function indexStatements() {
  return TABLE_KEYS.map(
    (tk) => `CREATE INDEX IF NOT EXISTS "${tk}_owner_updated" ON "${tk}" (owner, updated_at)`,
  );
}

/* 13 张业务表的建表语句 —— SQLite 适配器与 D1 适配器共用的唯一真源。
   勾选列两边都落成 INTEGER 0/1，读回时由适配器还原成真布尔。 */
export function ddlStatements() {
  return TABLE_KEYS.flatMap((tk) => {
    const def = tableDef(tk);
    // rid 只在 owner 内唯一。前端生成的 rid 是**确定性**的（ast 恒为 't'、日志行是 '前缀|日期#序号'、
    // 成就 'ac|成就ID'），人人相同 —— 列级全局 UNIQUE 会让第二个账号的第一行就写不进去。
    // handler 的 upsert 冲突目标是 (owner, rid)，唯一性正好落在下面那个复合唯一索引上。
    const body = ['  id TEXT PRIMARY KEY', '  owner TEXT NOT NULL', '  rid TEXT NOT NULL', '  updated_at TEXT NOT NULL']
      .concat(def.map(({ col, bool }) => `  "${col}" ${bool ? 'INTEGER' : 'TEXT'}`))
      .join(',\n');
    return [
      `CREATE TABLE IF NOT EXISTS "${tk}" (\n${body}\n)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "${tk}_owner_rid_u" ON "${tk}" (owner, rid)`,
    ];
  });
}