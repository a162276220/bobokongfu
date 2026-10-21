-- 联网热点的全局缓存：不分 owner，所有账号看到同一份热榜。
-- 只缓存抓取结果，10 分钟内的重复请求不再打外部接口。

CREATE TABLE IF NOT EXISTS "nm_hot_live" (
  id TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
