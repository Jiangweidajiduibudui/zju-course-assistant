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
  /** 为 true 时上游失败不降级 seed，直接抛错（默认 false：Demo 降级） */
  disableSeedFallback?: boolean;
  now?: () => Date;
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

function metaFromEntry(entry: CacheEntry<unknown>): SourceMeta {
  if (entry.sourceUrl.startsWith("seed://")) {
    return {
      sourceUrl: entry.sourceUrl,
      fetchedAt: entry.fetchedAt,
      cacheState: "seed",
    };
  }
  return {
    sourceUrl: entry.sourceUrl,
    fetchedAt: entry.fetchedAt,
    cacheState: entry.stale ? "stale" : "cached",
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
  const fetchOpts = {
    fetchImpl: options.fetchImpl,
    minIntervalMs: options.minIntervalMs,
  };

  async function loadSearchIndex(): Promise<CacheEntry<TeacherIndexEntry[]>> {
    const key = cacheKeySearch();
    return singleFlight(key, async () => {
      const hit = readFreshOrStale(searchCache, key);
      if (hit && !hit.stale) {
        return hit;
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
        return { ...entry, stale: false };
      } catch (cause) {
        if (hit?.stale) {
          return { ...hit, stale: true };
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
          value,
          sourceUrl: "seed://demo-chalaoshi.synthetic.json",
          fetchedAt: seed.generatedAt,
          stale: false,
        };
      }
    });
  }

  return {
    async searchTeachers(query: string) {
      const entry = await loadSearchIndex();
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
        sourceMeta: metaFromEntry(entry),
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
    return {
      teacherId,
      name: `未知教师#${teacherId}`,
      college: null,
      rating: null,
      ratingCount: null,
      gpaByCourse: [],
      callRollPercent: null,
      sourceMeta: {
        sourceUrl: "seed://demo-chalaoshi.synthetic.json",
        fetchedAt: seed.generatedAt,
        cacheState: "seed",
      },
    };
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
  return {
    teacherId,
    comments: teacher?.comments ?? [],
    sourceMeta: {
      sourceUrl: "seed://demo-chalaoshi.synthetic.json",
      fetchedAt: seed.generatedAt,
      cacheState: "seed",
    },
  };
}

function toServiceError(cause: unknown): Error {
  if (cause instanceof ChalaoshiFetchError || cause instanceof ChalaoshiParseError) {
    return cause;
  }
  return new ChalaoshiFetchError(
    ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
    cause instanceof Error ? cause.message : "未知上游错误",
  );
}
