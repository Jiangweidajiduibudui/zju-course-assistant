/**
 * chalaoshi 两级公共缓存（组员 B；D28、D33；docs/07 §4.6）。
 *
 * - L1：进程内 LRUCache（命名导入；必须设 max 与 ttl）+ single-flight
 *   （相同抓取 key 并发只触发一次上游请求 —— docs/05 §5.2 可确定验证）；
 * - L2：PostgreSQL（sql/migrations/0001）：无 DATABASE_URL 时跳过，仅 L1+seed；
 * - 缓存只存公共数据，按来源与教师 ID 键控，不与用户身份绑定；
 * - 教师详情与评论 TTL = 3 天（D28）；允许显式过期降级（stale 标记）。
 * - stale 读取不得消费条目（noDeleteOnStaleGet），上游持续失败时可反复返回 stale。
 *
 * Task 3 交付；测试锚点：tests/server/chalaoshi-cache.test.ts
 */
import { LRUCache } from "lru-cache";

export interface CacheEntry<T> {
  value: T;
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
}

export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** L1 缓存实例（Task 3 中由 service 装配 L2 与 single-flight） */
export function createL1Cache<T extends {}>(options?: {
  max?: number;
  ttl?: number;
}): LRUCache<string, CacheEntry<T>> {
  return new LRUCache<string, CacheEntry<T>>({
    max: options?.max ?? 2000,
    ttl: options?.ttl ?? THREE_DAYS_MS,
    // 允许读取刚过期条目做 stale 降级
    allowStale: true,
    // 关键：stale get 不得删除条目，否则第二次请求会掉到 seed
    noDeleteOnStaleGet: true,
  });
}

/**
 * single-flight：相同 key 并发只跑一次 factory。
 * 成功/失败后清除 in-flight，避免永久卡住。
 */
export function createSingleFlight(): <T>(key: string, factory: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<unknown>>();
  return async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = factory().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  };
}

export function cacheKeySearch(): string {
  return "search-json";
}

export function cacheKeyTeacherDetail(teacherId: number): string {
  return `teacher-detail:${teacherId}`;
}

export function cacheKeyComments(teacherId: number): string {
  return `teacher-comments:${teacherId}`;
}
