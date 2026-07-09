import { randomUUID } from "node:crypto";
import type { LRUCache } from "lru-cache";
import type { Pool } from "pg";
import { ErrorCodes } from "../../../shared/contracts/errors.js";
import type {
  CommentBatch,
  SourceMeta,
  TeacherDetail,
  TeacherIndexEntry,
} from "../../../shared/contracts/index.js";
import type { ServerConfig } from "../../config.js";
import {
  type CacheEntry,
  cacheKeyComments,
  cacheKeySearch,
  cacheKeyTeacherDetail,
  createL1Cache,
  createSingleFlight,
  THREE_DAYS_MS,
} from "./cache.js";
import { preprocessComments } from "./comments-preprocess.js";
import { ChalaoshiFetchError, type FetchLike, fetchUpstreamText } from "./fetcher.js";
import { createPostgresL2Store, type L2Store } from "./l2.js";
import {
  ChalaoshiParseError,
  parseCommentsHtml,
  parseSearchJson,
  parseTeacherDetailHtml,
} from "./parser.js";
import { loadSeed } from "./seed.js";

/**
 * chalaoshi 服务编排（组员 B；PROJECT.md §5.4）。
 * 读路径：L1 fresh → L2 fresh → upstream；live 成功写回 L1+L2。
 * 上游失败：L1/L2 stale → seed（无 DB/L2 时仅 L1+seed）。
 * 跨实例刷新：fetch_lease（有 L2 时）。
 *
 * cacheState 语义：
 * - live：本次刚从上游取回；
 * - cached：命中未过期 L1/L2；
 * - stale：缓存过期后上游失败，返回旧条目（可反复返回，不消费）；
 * - seed：无可用缓存时降级合成数据。
 */

export interface ChalaoshiService {
  searchTeachers(query: string): Promise<{
    teachers: TeacherIndexEntry[];
    sourceMeta: SourceMeta;
  }>;
  getTeacherDetail(teacherId: number): Promise<TeacherDetail>;
  getTeacherComments(teacherId: number): Promise<CommentBatch>;
}

export interface CreateChalaoshiServiceOptions {
  config: ServerConfig;
  fetchImpl?: FetchLike;
  /** 测试可缩短 TTL（同时作用于 L1 与 L2 写入） */
  l1TtlMs?: number;
  /** 测试可关闭上游限频间隔 */
  minIntervalMs?: number;
  /** 测试可缩短超时，避免 hermetic 测试卡在默认 8s */
  timeoutMs?: number;
  /** 为 true 时上游失败不降级 seed，直接抛错（默认 false：Demo 降级） */
  disableSeedFallback?: boolean;
  now?: () => Date;
  /** 显式注入 L2；优先于 pgPool。传 null 强制禁用 L2 */
  l2?: L2Store | null;
  /** 有 DATABASE_URL 时由 app 注入 Pool */
  pgPool?: Pool;
  /** lease holder 标识；缺省随机 UUID */
  instanceId?: string;
}

export class ChalaoshiNotFoundError extends Error {
  readonly errorCode = ErrorCodes.CHALAOSHI_TEACHER_NOT_FOUND;

  constructor(teacherId: number) {
    super(`教师不存在: ${teacherId}`);
    this.name = "ChalaoshiNotFoundError";
  }
}

function withMetaCacheState<T extends { sourceMeta: SourceMeta }>(
  value: T,
  cacheState: SourceMeta["cacheState"],
  sourceUrl: string,
  fetchedAt: string,
): T {
  return {
    ...value,
    sourceMeta: { sourceUrl, fetchedAt, cacheState },
  };
}

function resolveL2(options: CreateChalaoshiServiceOptions): L2Store | null {
  if (options.l2 !== undefined) {
    return options.l2;
  }
  if (options.pgPool) {
    return createPostgresL2Store(options.pgPool, { now: options.now });
  }
  return null;
}

export function createChalaoshiService(options: CreateChalaoshiServiceOptions): ChalaoshiService {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.l1TtlMs ?? THREE_DAYS_MS;
  const singleFlight = createSingleFlight();
  const searchCache = createL1Cache<TeacherIndexEntry[]>({ ttl: ttlMs });
  const detailCache = createL1Cache<TeacherDetail>({ ttl: ttlMs });
  const commentsCache = createL1Cache<CommentBatch>({ ttl: ttlMs });
  const l2 = resolveL2(options);
  const instanceId = options.instanceId ?? randomUUID();

  const baseUrl = options.config.CHALAOSHI_BASE_URL.replace(/\/$/, "");
  const apiBase = options.config.CHALAOSHI_API_BASE_URL.replace(/\/$/, "");
  const fetchOpts = {
    fetchImpl: options.fetchImpl,
    minIntervalMs: options.minIntervalMs,
    timeoutMs: options.timeoutMs,
    allowedHosts: options.config.CHALAOSHI_ALLOWED_HOSTS,
  };

  function readL1<T extends {}>(
    cache: LRUCache<string, CacheEntry<T>>,
    key: string,
  ): CacheEntry<T> | undefined {
    const value = cache.get(key);
    if (!value) return undefined;
    const remaining = cache.getRemainingTTL(key);
    const stale = remaining !== undefined && remaining <= 0;
    return { ...value, stale };
  }

  function writeL1<T extends {}>(
    cache: LRUCache<string, CacheEntry<T>>,
    key: string,
    entry: Omit<CacheEntry<T>, "stale"> & { stale?: boolean },
  ): void {
    cache.set(key, { ...entry, stale: false });
  }

  async function readL2<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!l2) return null;
    const row = await l2.get(key);
    if (!row) return null;
    return {
      value: row.payload as T,
      sourceUrl: row.sourceUrl,
      fetchedAt: row.fetchedAt,
      stale: row.stale,
    };
  }

  async function writeThrough<T extends {}>(
    cache: LRUCache<string, CacheEntry<T>>,
    key: string,
    entry: CacheEntry<T>,
  ): Promise<void> {
    writeL1(cache, key, entry);
    if (l2) {
      await l2.set(key, {
        payload: entry.value,
        sourceUrl: entry.sourceUrl,
        fetchedAt: entry.fetchedAt,
        ttlMs,
      });
    }
  }

  /** 跨实例去重：持有 lease 再抓上游；未拿到则短暂等待后重读 L2 */
  async function fetchUnderLease(key: string, fetchFn: () => Promise<string>): Promise<string> {
    if (!l2) {
      return fetchFn();
    }
    const acquired = await l2.tryAcquireLease(key, instanceId);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, 50));
      throw new LeaseBusyError();
    }
    try {
      return await fetchFn();
    } finally {
      await l2.releaseLease(key, instanceId);
    }
  }

  async function loadSearchIndex(): Promise<{
    entry: CacheEntry<TeacherIndexEntry[]>;
    cacheState: SourceMeta["cacheState"];
  }> {
    const key = cacheKeySearch();
    return singleFlight(key, async () => {
      const l1 = readL1(searchCache, key);
      if (l1 && !l1.stale) {
        return { entry: l1, cacheState: "cached" as const };
      }

      let l2Hit = await readL2<TeacherIndexEntry[]>(key);
      if (l2Hit && !l2Hit.stale) {
        writeL1(searchCache, key, l2Hit);
        return { entry: l2Hit, cacheState: "cached" as const };
      }

      const staleFallback = l1?.stale ? l1 : l2Hit?.stale ? l2Hit : undefined;
      const sourceUrl = `${baseUrl}/static/json/search.json`;

      try {
        let text: string;
        try {
          text = await fetchUnderLease(key, () => fetchUpstreamText(sourceUrl, fetchOpts));
        } catch (leaseErr) {
          if (!(leaseErr instanceof LeaseBusyError)) throw leaseErr;
          l2Hit = await readL2<TeacherIndexEntry[]>(key);
          if (l2Hit && !l2Hit.stale) {
            writeL1(searchCache, key, l2Hit);
            return { entry: l2Hit, cacheState: "cached" as const };
          }
          text = await fetchUpstreamText(sourceUrl, fetchOpts);
        }

        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new ChalaoshiParseError("search-json", "JSON 解析失败");
        }
        const value = parseSearchJson(raw);
        const entry: CacheEntry<TeacherIndexEntry[]> = {
          value,
          sourceUrl,
          fetchedAt: now().toISOString(),
          stale: false,
        };
        await writeThrough(searchCache, key, entry);
        return { entry, cacheState: "live" as const };
      } catch (cause) {
        if (staleFallback) {
          return { entry: { ...staleFallback, stale: true }, cacheState: "stale" as const };
        }
        if (options.disableSeedFallback) {
          throw toServiceError(cause);
        }
        const seed = await loadSeed();
        return {
          entry: {
            value: seed.teachers.map((t) => ({
              id: t.teacherId,
              name: t.name,
              college: t.college,
              rate: t.rating,
              hot: t.ratingCount,
            })),
            sourceUrl: "seed://demo-chalaoshi.synthetic.json",
            fetchedAt: seed.generatedAt,
            stale: false,
          },
          cacheState: "seed" as const,
        };
      }
    });
  }

  return {
    async searchTeachers(query: string) {
      const { entry, cacheState } = await loadSearchIndex();
      const q = query.trim().toLowerCase();
      const teachers =
        q.length === 0
          ? entry.value.slice(0, 50)
          : entry.value
              .filter(
                (t) =>
                  t.name.toLowerCase().includes(q) ||
                  (t.college?.toLowerCase().includes(q) ?? false),
              )
              .slice(0, 50);

      return {
        teachers,
        sourceMeta: {
          sourceUrl: entry.sourceUrl,
          fetchedAt: entry.fetchedAt,
          cacheState,
        },
      };
    },

    async getTeacherDetail(teacherId: number) {
      const key = cacheKeyTeacherDetail(teacherId);
      return singleFlight(key, async () => {
        const l1 = readL1(detailCache, key);
        if (l1 && !l1.stale) {
          return withMetaCacheState(l1.value, "cached", l1.sourceUrl, l1.fetchedAt);
        }

        let l2Hit = await readL2<TeacherDetail>(key);
        if (l2Hit && !l2Hit.stale) {
          const detail = withMetaCacheState(
            l2Hit.value,
            "cached",
            l2Hit.sourceUrl,
            l2Hit.fetchedAt,
          );
          writeL1(detailCache, key, {
            value: detail,
            sourceUrl: l2Hit.sourceUrl,
            fetchedAt: l2Hit.fetchedAt,
          });
          return detail;
        }

        const staleFallback = l1?.stale ? l1 : l2Hit?.stale ? l2Hit : undefined;
        const sourceUrl = `${baseUrl}/teacher/${teacherId}/`;

        try {
          let html: string;
          try {
            html = await fetchUnderLease(key, () => fetchUpstreamText(sourceUrl, fetchOpts));
          } catch (leaseErr) {
            if (!(leaseErr instanceof LeaseBusyError)) throw leaseErr;
            l2Hit = await readL2<TeacherDetail>(key);
            if (l2Hit && !l2Hit.stale) {
              const detail = withMetaCacheState(
                l2Hit.value,
                "cached",
                l2Hit.sourceUrl,
                l2Hit.fetchedAt,
              );
              writeL1(detailCache, key, {
                value: detail,
                sourceUrl: l2Hit.sourceUrl,
                fetchedAt: l2Hit.fetchedAt,
              });
              return detail;
            }
            html = await fetchUpstreamText(sourceUrl, fetchOpts);
          }

          const parsed = parseTeacherDetailHtml(html, sourceUrl);
          const fetchedAt = now().toISOString();
          const detail = withMetaCacheState(parsed, "live", sourceUrl, fetchedAt);
          await writeThrough(detailCache, key, {
            value: detail,
            sourceUrl,
            fetchedAt,
            stale: false,
          });
          return detail;
        } catch (cause) {
          if (staleFallback) {
            return withMetaCacheState(
              staleFallback.value,
              "stale",
              staleFallback.sourceUrl,
              staleFallback.fetchedAt,
            );
          }
          if (options.disableSeedFallback) {
            throw toServiceError(cause);
          }
          return detailFromSeed(teacherId);
        }
      });
    },

    async getTeacherComments(teacherId: number) {
      const key = cacheKeyComments(teacherId);
      return singleFlight(key, async () => {
        const l1 = readL1(commentsCache, key);
        if (l1 && !l1.stale) {
          return withMetaCacheState(l1.value, "cached", l1.sourceUrl, l1.fetchedAt);
        }

        let l2Hit = await readL2<CommentBatch>(key);
        if (l2Hit && !l2Hit.stale) {
          const batch = withMetaCacheState(l2Hit.value, "cached", l2Hit.sourceUrl, l2Hit.fetchedAt);
          writeL1(commentsCache, key, {
            value: batch,
            sourceUrl: l2Hit.sourceUrl,
            fetchedAt: l2Hit.fetchedAt,
          });
          return batch;
        }

        const staleFallback = l1?.stale ? l1 : l2Hit?.stale ? l2Hit : undefined;
        const sourceUrl = `${apiBase}/comments/${teacherId}?sort=time`;

        try {
          let html: string;
          try {
            html = await fetchUnderLease(key, () => fetchUpstreamText(sourceUrl, fetchOpts));
          } catch (leaseErr) {
            if (!(leaseErr instanceof LeaseBusyError)) throw leaseErr;
            l2Hit = await readL2<CommentBatch>(key);
            if (l2Hit && !l2Hit.stale) {
              const batch = withMetaCacheState(
                l2Hit.value,
                "cached",
                l2Hit.sourceUrl,
                l2Hit.fetchedAt,
              );
              writeL1(commentsCache, key, {
                value: batch,
                sourceUrl: l2Hit.sourceUrl,
                fetchedAt: l2Hit.fetchedAt,
              });
              return batch;
            }
            html = await fetchUpstreamText(sourceUrl, fetchOpts);
          }

          const comments = preprocessComments(parseCommentsHtml(html), { now: now() });
          const fetchedAt = now().toISOString();
          const batch: CommentBatch = {
            teacherId,
            comments,
            sourceMeta: { sourceUrl, fetchedAt, cacheState: "live" },
          };
          await writeThrough(commentsCache, key, {
            value: batch,
            sourceUrl,
            fetchedAt,
            stale: false,
          });
          return batch;
        } catch (cause) {
          if (staleFallback) {
            return withMetaCacheState(
              staleFallback.value,
              "stale",
              staleFallback.sourceUrl,
              staleFallback.fetchedAt,
            );
          }
          if (options.disableSeedFallback) {
            throw toServiceError(cause);
          }
          return commentsFromSeed(teacherId, now());
        }
      });
    },
  };
}

class LeaseBusyError extends Error {
  constructor() {
    super("fetch lease held by another instance");
    this.name = "LeaseBusyError";
  }
}

async function detailFromSeed(teacherId: number): Promise<TeacherDetail> {
  const seed = await loadSeed();
  const teacher = seed.teachers.find((t) => t.teacherId === teacherId);
  if (!teacher) {
    throw new ChalaoshiNotFoundError(teacherId);
  }
  const { comments: _comments, ...rest } = teacher;
  return {
    ...rest,
    sourceMeta: {
      sourceUrl: "seed://demo-chalaoshi.synthetic.json",
      fetchedAt: seed.generatedAt,
      cacheState: "seed",
    },
  };
}

async function commentsFromSeed(teacherId: number, asOf: Date): Promise<CommentBatch> {
  const seed = await loadSeed();
  const teacher = seed.teachers.find((t) => t.teacherId === teacherId);
  if (!teacher) {
    throw new ChalaoshiNotFoundError(teacherId);
  }
  return {
    teacherId,
    comments: preprocessComments(teacher.comments, { now: asOf }),
    sourceMeta: {
      sourceUrl: "seed://demo-chalaoshi.synthetic.json",
      fetchedAt: seed.generatedAt,
      cacheState: "seed",
    },
  };
}

function toServiceError(cause: unknown): Error {
  if (
    cause instanceof ChalaoshiFetchError ||
    cause instanceof ChalaoshiParseError ||
    cause instanceof ChalaoshiNotFoundError
  ) {
    return cause;
  }
  return new ChalaoshiFetchError(
    ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
    cause instanceof Error ? cause.message : "未知上游错误",
  );
}
