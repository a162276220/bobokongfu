CREATE TABLE IF NOT EXISTS "ast" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "coins" TEXT,
  "total_earned" TEXT,
  "total_spent" TEXT,
  "total_claims" TEXT,
  "monthly_earned" TEXT,
  "monthly_spent" TEXT,
  "today_earned" TEXT,
  "today_spent" TEXT,
  "last_active" TEXT,
  "created_on" TEXT,
  "cabin_theme" TEXT,
  "daily_reset" INTEGER,
  "notifications" INTEGER,
  "pet_remind" INTEGER,
  "today_words" TEXT,
  "today_words_date" TEXT,
  "today_video_idx" TEXT,
  "today_video_date" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "ast_owner_rid_u" ON "ast" (owner, rid);

CREATE TABLE IF NOT EXISTS "meal" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "log_date" TEXT,
  "meal" TEXT,
  "food" TEXT,
  "calories" TEXT,
  "note" TEXT,
  "image" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "meal_owner_rid_u" ON "meal" (owner, rid);

CREATE TABLE IF NOT EXISTS "wk" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "log_date" TEXT,
  "kind" TEXT,
  "minutes" TEXT,
  "weight" TEXT,
  "feeling" TEXT,
  "note" TEXT,
  "burned" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "wk_owner_rid_u" ON "wk" (owner, rid);

CREATE TABLE IF NOT EXISTS "acc" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "log_date" TEXT,
  "kind" TEXT,
  "category" TEXT,
  "amount" TEXT,
  "note" TEXT,
  "receipt" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "acc_owner_rid_u" ON "acc" (owner, rid);

CREATE TABLE IF NOT EXISTS "voc" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "word" TEXT,
  "phonetic" TEXT,
  "meaning" TEXT,
  "memorized" INTEGER,
  "added_date" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "voc_owner_rid_u" ON "voc" (owner, rid);

CREATE TABLE IF NOT EXISTS "amz" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "log_date" TEXT,
  "video_title" TEXT,
  "video_topic" TEXT,
  "key_points" TEXT,
  "insights" TEXT,
  "actions" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "amz_owner_rid_u" ON "amz" (owner, rid);

CREATE TABLE IF NOT EXISTS "xhs" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "log_date" TEXT,
  "title" TEXT,
  "idea" TEXT,
  "audience" TEXT,
  "form" TEXT,
  "outline" TEXT,
  "script" TEXT,
  "storyboard" TEXT,
  "tags" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "xhs_owner_rid_u" ON "xhs" (owner, rid);

CREATE TABLE IF NOT EXISTS "inv" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "item_id" TEXT,
  "kind" TEXT,
  "name" TEXT,
  "icon" TEXT,
  "description" TEXT,
  "qty" TEXT,
  "effect" TEXT,
  "slot_size" TEXT,
  "price" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "inv_owner_rid_u" ON "inv" (owner, rid);

CREATE TABLE IF NOT EXISTS "pet" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "pet_id" TEXT,
  "shop_id" TEXT,
  "name" TEXT,
  "kind" TEXT,
  "icon" TEXT,
  "hunger" TEXT,
  "mood" TEXT,
  "health" TEXT,
  "level" TEXT,
  "exp" TEXT,
  "adopted_at" TEXT,
  "last_update" TEXT,
  "last_interact" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "pet_owner_rid_u" ON "pet" (owner, rid);

CREATE TABLE IF NOT EXISTS "cab" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "slot" TEXT,
  "item_id" TEXT,
  "name" TEXT,
  "icon" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "cab_owner_rid_u" ON "cab" (owner, rid);

CREATE TABLE IF NOT EXISTS "ach" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "achievement_id" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "ach_owner_rid_u" ON "ach" (owner, rid);

CREATE TABLE IF NOT EXISTS "chk" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "log_date" TEXT,
  "ts" TEXT,
  "task_key" TEXT,
  "task_name" TEXT,
  "coins" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "chk_owner_rid_u" ON "chk" (owner, rid);

CREATE TABLE IF NOT EXISTS "rpt" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "kind" TEXT,
  "log_date" TEXT,
  "payload" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpt_owner_rid_u" ON "rpt" (owner, rid);

CREATE INDEX IF NOT EXISTS "ast_owner_updated" ON "ast" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "meal_owner_updated" ON "meal" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "wk_owner_updated" ON "wk" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "acc_owner_updated" ON "acc" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "voc_owner_updated" ON "voc" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "amz_owner_updated" ON "amz" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "xhs_owner_updated" ON "xhs" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "inv_owner_updated" ON "inv" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "pet_owner_updated" ON "pet" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "cab_owner_updated" ON "cab" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "ach_owner_updated" ON "ach" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "chk_owner_updated" ON "chk" (owner, updated_at);

CREATE INDEX IF NOT EXISTS "rpt_owner_updated" ON "rpt" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "users" (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  nickname TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_u" ON "users" (username);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_u" ON "users" (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS "sessions" (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ua TEXT
);

CREATE INDEX IF NOT EXISTS "sessions_expires" ON "sessions" (expires_at);

CREATE INDEX IF NOT EXISTS "sessions_user" ON "sessions" (user_id);

CREATE TABLE IF NOT EXISTS "invites" (
  code TEXT PRIMARY KEY,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  used_by TEXT,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS "invites_used_by" ON "invites" (used_by);

CREATE TABLE IF NOT EXISTS "devices" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "devices_user" ON "devices" (user_id);

CREATE TABLE IF NOT EXISTS "tomb" (
  owner TEXT NOT NULL,
  tbl TEXT NOT NULL,
  rid TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (owner, tbl, rid)
);

CREATE INDEX IF NOT EXISTS "tomb_owner_ts" ON "tomb" (owner, ts);
