-- 新媒体工作台：7 张业务表 + 删除墓碑。
-- 与旧工作台 13 张表完全独立；owner 来自会话，rid 在 owner 内唯一。

CREATE TABLE IF NOT EXISTS "nm_topic" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "title" TEXT,
  "line" TEXT,
  "note" TEXT,
  "source" TEXT,
  "hot_id" TEXT,
  "status" TEXT,
  "created_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_topic_owner_rid_u" ON "nm_topic" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_topic_owner_updated" ON "nm_topic" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_hot" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "title" TEXT,
  "platform" TEXT,
  "heat" TEXT,
  "status" TEXT,
  "fetched_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_hot_owner_rid_u" ON "nm_hot" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_hot_owner_updated" ON "nm_hot" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_task" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "topic_id" TEXT,
  "line" TEXT,
  "status" TEXT,
  "stage" TEXT,
  "progress" TEXT,
  "params" TEXT,
  "error" TEXT,
  "ip_id" TEXT,
  "content_id" TEXT,
  "started_at" TEXT,
  "created_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_task_owner_rid_u" ON "nm_task" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_task_owner_updated" ON "nm_task" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_content" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "title" TEXT,
  "line" TEXT,
  "status" TEXT,
  "body" TEXT,
  "tags" TEXT,
  "assets" TEXT,
  "review_note" TEXT,
  "prev_version_id" TEXT,
  "task_id" TEXT,
  "topic_id" TEXT,
  "ip_id" TEXT,
  "version" TEXT,
  "finished_at" TEXT,
  "approved_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_content_owner_rid_u" ON "nm_content" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_content_owner_updated" ON "nm_content" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_ip" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "name" TEXT,
  "persona" TEXT,
  "config" TEXT,
  "status" TEXT,
  "appearances" TEXT,
  "created_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_ip_owner_rid_u" ON "nm_ip" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_ip_owner_updated" ON "nm_ip" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_pub" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "content_id" TEXT,
  "platform" TEXT,
  "method" TEXT,
  "status" TEXT,
  "published_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_pub_owner_rid_u" ON "nm_pub" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_pub_owner_updated" ON "nm_pub" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_stat" (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  "content_id" TEXT,
  "date" TEXT,
  "views" TEXT,
  "likes" TEXT,
  "comments" TEXT,
  "shares" TEXT,
  "favorites" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "nm_stat_owner_rid_u" ON "nm_stat" (owner, rid);
CREATE INDEX IF NOT EXISTS "nm_stat_owner_updated" ON "nm_stat" (owner, updated_at);

CREATE TABLE IF NOT EXISTS "nm_tomb" (
  owner TEXT NOT NULL,
  tbl TEXT NOT NULL,
  rid TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, tbl, rid)
);
CREATE INDEX IF NOT EXISTS "nm_tomb_owner_updated" ON "nm_tomb" (owner, updated_at);
