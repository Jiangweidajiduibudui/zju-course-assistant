/**
 * chalaoshi L2 公共缓存 + fetch_lease（组员 B；D28、D33；docs/07 §4.6）。
 * - 有 DATABASE_URL 时接入 PostgreSQL（sql/migrations/0001）；
 * - 测试可注入内存实现，不依赖真实 DB。
 */
import type { Pool } from "pg";
import { THREE_DAYS_MS } from "./cache.js";

export interface L2CacheEntry {
  payload: unknown;
  sourceUrl: string;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
}

export interface L2Store {
  get(sourceKey: string): Promise<L2CacheEntry | null>;
  set(
    sourceKey: string,
    entry: {
      payload: unknown;
      sourceUrl: string;
      fetchedAt: string;
      /** TTL；缺省 3 天 */
      ttlMs?: number;
    },
  ): Promise<void>;
  /** 尝试获取跨实例刷新 lease；成功返回 true */
  tryAcquireLease(leaseKey: string, holder: string, leaseTtlMs?: number): Promise<boolean>;
  releaseLease(leaseKey: string, holder: string): Promise<void>;
}

const DEFAULT_LEASE_TTL_MS = 30_000;

/** 进程内 L2（单测 / 无 DB 时也可显式注入） */
export function createMemoryL2Store(options?: { now?: () => Date }): L2Store {
  const now = options?.now ?? (() => new Date());
  const rows = new Map<
    string,
    { payload: unknown; sourceUrl: string; fetchedAt: string; expiresAtMs: number }
  >();
  const leases = new Map<string, { holder: string; expiresAtMs: number }>();

  return {
    async get(sourceKey) {
      const row = rows.get(sourceKey);
      if (!row) return null;
      const stale = row.expiresAtMs <= now().getTime();
      return {
        payload: row.payload,
        sourceUrl: row.sourceUrl,
        fetchedAt: row.fetchedAt,
        expiresAt: new Date(row.expiresAtMs).toISOString(),
        stale,
      };
    },
    async set(sourceKey, entry) {
      const ttlMs = entry.ttlMs ?? THREE_DAYS_MS;
      const fetchedAtMs = Date.parse(entry.fetchedAt);
      rows.set(sourceKey, {
        payload: entry.payload,
        sourceUrl: entry.sourceUrl,
        fetchedAt: entry.fetchedAt,
        expiresAtMs: fetchedAtMs + ttlMs,
      });
    },
    async tryAcquireLease(leaseKey, holder, leaseTtlMs = DEFAULT_LEASE_TTL_MS) {
      const t = now().getTime();
      const existing = leases.get(leaseKey);
      if (existing && existing.expiresAtMs > t && existing.holder !== holder) {
        return false;
      }
      leases.set(leaseKey, { holder, expiresAtMs: t + leaseTtlMs });
      return true;
    },
    async releaseLease(leaseKey, holder) {
      const existing = leases.get(leaseKey);
      if (existing?.holder === holder) {
        leases.delete(leaseKey);
      }
    },
  };
}

/** PostgreSQL L2（migration 0001：chalaoshi_cache + fetch_lease） */
export function createPostgresL2Store(pool: Pool, options?: { now?: () => Date }): L2Store {
  const now = options?.now ?? (() => new Date());

  return {
    async get(sourceKey) {
      const result = await pool.query<{
        payload: unknown;
        source_url: string;
        fetched_at: Date;
        expires_at: Date;
      }>(
        `SELECT payload, source_url, fetched_at, expires_at
         FROM chalaoshi_cache
         WHERE source_key = $1`,
        [sourceKey],
      );
      const row = result.rows[0];
      if (!row) return null;
      const expiresAt = row.expires_at;
      const stale = expiresAt.getTime() <= now().getTime();
      return {
        payload: row.payload,
        sourceUrl: row.source_url,
        fetchedAt: row.fetched_at.toISOString(),
        expiresAt: expiresAt.toISOString(),
        stale,
      };
    },

    async set(sourceKey, entry) {
      const ttlMs = entry.ttlMs ?? THREE_DAYS_MS;
      const fetchedAt = new Date(entry.fetchedAt);
      const expiresAt = new Date(fetchedAt.getTime() + ttlMs);
      await pool.query(
        `INSERT INTO chalaoshi_cache (source_key, payload, source_url, fetched_at, expires_at)
         VALUES ($1, $2::jsonb, $3, $4, $5)
         ON CONFLICT (source_key) DO UPDATE SET
           payload = EXCLUDED.payload,
           source_url = EXCLUDED.source_url,
           fetched_at = EXCLUDED.fetched_at,
           expires_at = EXCLUDED.expires_at`,
        [sourceKey, JSON.stringify(entry.payload), entry.sourceUrl, fetchedAt, expiresAt],
      );
    },

    async tryAcquireLease(leaseKey, holder, leaseTtlMs = DEFAULT_LEASE_TTL_MS) {
      const acquiredAt = now();
      const expiresAt = new Date(acquiredAt.getTime() + leaseTtlMs);
      const result = await pool.query<{ lease_key: string }>(
        `INSERT INTO fetch_lease (lease_key, holder, acquired_at, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lease_key) DO UPDATE SET
           holder = EXCLUDED.holder,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
         WHERE fetch_lease.expires_at <= $3
            OR fetch_lease.holder = EXCLUDED.holder
         RETURNING lease_key`,
        [leaseKey, holder, acquiredAt, expiresAt],
      );
      return result.rowCount !== null && result.rowCount > 0;
    },

    async releaseLease(leaseKey, holder) {
      await pool.query(`DELETE FROM fetch_lease WHERE lease_key = $1 AND holder = $2`, [
        leaseKey,
        holder,
      ]);
    },
  };
}
