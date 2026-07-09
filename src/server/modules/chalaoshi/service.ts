import type { LRUCache } from "lru-cache";
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
} from "./cache.js";
import { ChalaoshiFetchError, type FetchLike, fetchUpstreamText } from "./fetcher.js";
import {
  ChalaoshiParseError,
  parseCommentsHtml,
  parseSearchJson,
  parseTeacherDetailHtml,
} from "./parser.js";
import { loadSeed } from "./seed.js";

/**
 * chalaoshi 服务编排（组员 B；PROJECT.md §5.4）。
 * 抓取 → 解析 → L1 缓存；失败降级 seed（cacheState=seed，UI 标演示数据）。
 * 无 DATABASE_URL 时不做 L2（开发/CI 常态）。
 *
 * cacheState 语义：
 * - live：本次请求刚从上游取回（首次写入 L1 后返回）；
 * - cached：命中未过期 L1；
 * - stale：L1 过期后上游失败，返回旧条目；
 * - seed：上游失败且降级合成数据。
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
  /** 测试可缩短 TTL */
  l1TtlMs?: number;
  /** 测试可关闭上游限频间隔 */
  minIntervalMs?: number;
  /** 测试可缩短超时，避免 hermetic 测试卡在默认 8s */
  timeoutMs?: number;
  /** 为 true 时上游失败不降级 seed，直接抛错（默认 false：Demo 降级） */
  disableSeedFallback?: boolean;
  now?: () => Date;
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

export function createChalaoshiService(options: CreateChalaoshiServiceOptions): ChalaoshiService {
  const now = options.now ?? (() => new Date());
  const singleFlight = createSingleFlight();
  const searchCache = createL1Cache<TeacherIndexEntry[]>({ ttl: options.l1TtlMs });
  const detailCache = createL1Cache<TeacherDetail>({ ttl: options.l1TtlMs });
  const commentsCache = createL1Cache<CommentBatch>({ ttl: options.l1TtlMs });

  const baseUrl = options.config.CHALAOSHI_BASE_URL.replace(/\/$/, "");
  const apiBase = options.config.CHALAOSHI_API_BASE_URL.replace(/\/$/, "");
  const allowedHosts = options.config.CHALAOSHI_ALLOWED_HOSTS;
  const fetchOpts = {
    fetchImpl: options.fetchImpl,
    minIntervalMs: options.minIntervalMs,
    timeoutMs: options.timeoutMs,
    allowedHosts,
  };

  async function loadSearchIndex(): Promise<{
    entry: CacheEntry<TeacherIndexEntry[]>;
    cacheState: SourceMeta["cacheState"];
  }> {
    const key = cacheKeySearch();
    return singleFlight(key, async () => {
      const hit = readFreshOrStale(searchCache, key);
      if (hit && !hit.stale) {
        return { entry: hit, cacheState: "cached" as const };
      }

      const sourceUrl = `${baseUrl}/static/json/search.json`;
      try {
        const text = await fetchUpstreamText(sourceUrl, fetchOpts);
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
        searchCache.set(key, entry);
        // 刚从上游取回：对外为 live；写入 L1 后下次命中才是 cached
        return { entry, cacheState: "live" as const };
      } catch (cause) {
        if (hit?.stale) {
          return { entry: { ...hit, stale: true }, cacheState: "stale" as const };
        }
        if (options.disableSeedFallback) {
          throw toServiceError(cause);
        }
        const seed = await loadSeed();
        const value: TeacherIndexEntry[] = seed.teachers.map((t) => ({
          id: t.teacherId,
          name: t.name,
          college: t.college,
          rate: t.rating,
          hot: t.ratingCount,
        }));
        return {
          entry: {
            value,
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
        const hit = readFreshOrStale(detailCache, key);
        if (hit && !hit.stale) {
          return withMetaCacheState(hit.value, "cached", hit.sourceUrl, hit.fetchedAt);
        }

        const sourceUrl = `${baseUrl}/teacher/${teacherId}/`;
        try {
          const html = await fetchUpstreamText(sourceUrl, fetchOpts);
          const parsed = parseTeacherDetailHtml(html, sourceUrl);
          const fetchedAt = now().toISOString();
          const detail = withMetaCacheState(parsed, "live", sourceUrl, fetchedAt);
          detailCache.set(key, {
            value: detail,
            sourceUrl,
            fetchedAt,
            stale: false,
          });
          return detail;
        } catch (cause) {
          if (hit?.stale) {
            return withMetaCacheState(hit.value, "stale", hit.sourceUrl, hit.fetchedAt);
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
        const hit = readFreshOrStale(commentsCache, key);
        if (hit && !hit.stale) {
          return withMetaCacheState(hit.value, "cached", hit.sourceUrl, hit.fetchedAt);
        }

        const sourceUrl = `${apiBase}/comments/${teacherId}?sort=time`;
        try {
          const html = await fetchUpstreamText(sourceUrl, fetchOpts);
          const comments = parseCommentsHtml(html);
          const fetchedAt = now().toISOString();
          const batch: CommentBatch = {
            teacherId,
            comments,
            sourceMeta: { sourceUrl, fetchedAt, cacheState: "live" },
          };
          commentsCache.set(key, {
            value: batch,
            sourceUrl,
            fetchedAt,
            stale: false,
          });
          return batch;
        } catch (cause) {
          if (hit?.stale) {
            return withMetaCacheState(hit.value, "stale", hit.sourceUrl, hit.fetchedAt);
          }
          if (options.disableSeedFallback) {
            throw toServiceError(cause);
          }
          return commentsFromSeed(teacherId);
        }
      });
    },
  };
}

function readFreshOrStale<T extends {}>(
  cache: LRUCache<string, CacheEntry<T>>,
  key: string,
): CacheEntry<T> | undefined {
  const value = cache.get(key);
  if (!value) {
    return undefined;
  }
  const remaining = cache.getRemainingTTL(key);
  const stale = remaining !== undefined && remaining <= 0;
  return { ...value, stale };
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

async function commentsFromSeed(teacherId: number): Promise<CommentBatch> {
  const seed = await loadSeed();
  const teacher = seed.teachers.find((t) => t.teacherId === teacherId);
  if (!teacher) {
    throw new ChalaoshiNotFoundError(teacherId);
  }
  return {
    teacherId,
    comments: teacher.comments,
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
