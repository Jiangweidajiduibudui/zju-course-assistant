/**
 * chalaoshi 两级公共缓存（组员 B；D28、D33；docs/07 §4.6）。
 *
 * - L1：进程内 LRUCache（命名导入；必须设 max 与 ttl）+ single-flight
 *   （相同抓取 key 并发只触发一次上游请求 —— docs/05 §5.2 可确定验证）；
 * - L2：PostgreSQL（sql/migrations/0001）：source_key 主键 + expires_at 索引；
 *   跨实例刷新用 lease/advisory lock，不引入 Redis；
 * - 缓存只存公共数据，按来源与教师 ID 键控，不与用户身份绑定；
 * - 教师详情与评论 TTL = 3 天（D28）；允许显式过期降级（stale 标记）。
 *
 * Task 3 交付；测试锚点：tests/server/chalaoshi-cache.test.ts
 * （缓存命中 / 过期降级 / single-flight / 无 DATABASE_URL 时 L1-only）。
 */
import { LRUCache } from "lru-cache";

export interface CacheEntry<T> {
  value: T;
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** L1 缓存实例（Task 3 中由 service 装配 L2 与 single-flight） */
export function createL1Cache<T extends {}>(): LRUCache<string, CacheEntry<T>> {
  return new LRUCache<string, CacheEntry<T>>({
    max: 2000,
    ttl: THREE_DAYS_MS,
  });
}
