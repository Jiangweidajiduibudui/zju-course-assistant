-- 0001 · chalaoshi L2 公共缓存 + 抓取 lease（D28、D33；docs/07 §4.6）
-- 原则：只存公共抓取数据，按 source_key 键控，不与任何用户身份绑定（D42）。
-- migration 规则：有序编号、只追加、不改历史文件（docs/07 §3）。

CREATE TABLE IF NOT EXISTS chalaoshi_cache (
  source_key  text        PRIMARY KEY,          -- 如 "teacher-detail:900001" / "search-json"
  payload     jsonb       NOT NULL,             -- 解析后的规范化数据（契约见 src/shared/contracts/chalaoshi.ts）
  source_url  text        NOT NULL,             -- 原页链接（合规要求，D03）
  fetched_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL              -- 教师详情/评论 TTL = 3 天（D28）
);

CREATE INDEX IF NOT EXISTS idx_chalaoshi_cache_expires_at
  ON chalaoshi_cache (expires_at);

-- 跨实例抓取去重：lease 到期即失效；不引入 Redis（docs/07 §4.6）。
CREATE TABLE IF NOT EXISTS fetch_lease (
  lease_key   text        PRIMARY KEY,          -- 与 source_key 同构
  holder      text        NOT NULL,             -- 实例标识
  acquired_at timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fetch_lease_expires_at
  ON fetch_lease (expires_at);
