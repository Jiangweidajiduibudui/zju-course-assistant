import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { api, type OperationId } from "../shared/contracts/api.js";
import {
  CONTRACT_VERSION,
  errorStatus,
  Failure,
  Id,
  success,
} from "../shared/contracts/common.js";
import { ServiceError } from "./errors.js";
import type { Transport } from "./llm/service.js";
import type { PlanningDriver } from "./planning.js";
import type { ReviewDriver } from "./reviews/source.js";
import { Service } from "./service.js";
import type { Store } from "./storage/store.js";
import type { SchoolDriver } from "./zdbk/read.js";

const DEFAULT_MAX_BODY = 256 * 1024;
const IMPORT_MAX_BODY = 64 * 1024 * 1024;
async function readJson(request: Request, maxBody: number) {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new ServiceError("INVALID_REQUEST", "请求必须使用 JSON。");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBody)
    throw new ServiceError("PAYLOAD_TOO_LARGE", "请求体过大。");
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError("INVALID_REQUEST", "缺少请求体。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBody) {
        await reader.cancel();
        throw new ServiceError("PAYLOAD_TOO_LARGE", "请求体过大。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceError("INVALID_REQUEST", "JSON 无效。");
  }
}
export function createApp(options: {
  store: Store;
  origin: string;
  driver?: PlanningDriver;
  transport?: Transport;
  schoolDriver?: SchoolDriver;
  reviewDriver?: ReviewDriver;
}) {
  const url = new URL(options.origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.origin !== options.origin
  )
    throw new Error("Use a canonical HTTP loopback origin");
  const token = randomBytes(32).toString("hex");
  const service = new Service(
    options.store,
    token,
    options.driver,
    options.transport,
    options.schoolDriver,
    options.reviewDriver,
  );
  const app = new Hono();
  const pending = new Map<string, { hash: string; work: Promise<unknown> }>();
  const meta = () => ({
    contractVersion: CONTRACT_VERSION,
    requestId: `request-${randomUUID()}`,
    servedAt: new Date().toISOString(),
  });
  let windowStart = Date.now();
  let requests = 0;
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const origin = c.req.header("origin");
    const fetchSite = c.req.header("sec-fetch-site");
    if (
      c.req.header("host") !== url.host ||
      new URL(c.req.url).host !== url.host ||
      (origin !== undefined && origin !== url.origin) ||
      (fetchSite !== undefined && !["same-origin", "none"].includes(fetchSite))
    )
      throw new ServiceError("ORIGIN_REJECTED", "请求来源不受信任。");
    if (c.req.path.startsWith("/api/")) {
      if (Date.now() - windowStart > 60000) {
        windowStart = Date.now();
        requests = 0;
      }
      if (++requests > 1200)
        throw new ServiceError(
          "RATE_LIMITED",
          "请求过于频繁，请稍后重试。",
          true,
        );
      if (c.req.path === "/api/bootstrap") {
        if (origin !== url.origin && fetchSite !== "same-origin")
          throw new ServiceError("ORIGIN_REJECTED", "Bootstrap 需要同源请求。");
      } else if (c.req.header("x-local-token") !== token)
        throw new ServiceError(
          "LOCAL_AUTH_REQUIRED",
          "本机会话已变化，请刷新页面。",
        );
    }
    await next();
  });
  app.onError((error, c) => {
    const known =
      error instanceof ServiceError
        ? error
        : new ServiceError(
            "INTERNAL_ERROR",
            "本机操作失败；未暴露内部错误内容，请重试。",
          );
    return c.json(
      Failure.parse({
        meta: meta(),
        error: {
          code: known.code,
          message: known.message,
          retryable: known.retryable,
          fields: [],
        },
      }),
      errorStatus[known.code] as ContentfulStatusCode,
    );
  });
  for (const [operation, route] of Object.entries(api)) {
    const path = route.path.replace(/\{([^}]+)\}/g, ":$1");
    app.on(route.method, path, async (c) => {
      let params: Record<string, string>;
      let query: Record<string, string>;
      let body: unknown = null;
      try {
        params = route.params.parse(c.req.param()) as Record<string, string>;
        const search = new URL(c.req.url).searchParams;
        if (
          [...new Set(search.keys())].some(
            (key) => search.getAll(key).length !== 1,
          )
        )
          throw new Error("Duplicate query");
        query = route.query.parse(Object.fromEntries(search)) as Record<
          string,
          string
        >;
        if (route.body !== null) {
          const raw = await readJson(
            c.req.raw,
            operation === "previewImport" ? IMPORT_MAX_BODY : DEFAULT_MAX_BODY,
          );
          if (operation === "previewImport") {
            const version = z
              .object({ archive: z.object({ schemaVersion: z.number() }) })
              .safeParse(raw);
            if (
              version.success &&
              ![1, 2].includes(version.data.archive.schemaVersion)
            )
              throw new ServiceError(
                "UNSUPPORTED_SCHEMA_VERSION",
                "归档版本不受支持；本地数据未改变。",
              );
          }
          body = route.body.parse(raw);
        }
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError(
          "INVALID_REQUEST",
          "请求字段、版本或引用格式无效。",
        );
      }
      let key: string | undefined;
      let hash = "";
      if (route.idempotencyKey) {
        const parsed = Id.safeParse(c.req.header("idempotency-key"));
        if (!parsed.success)
          throw new ServiceError("INVALID_REQUEST", "缺少有效幂等键。");
        key = parsed.data;
        hash = createHash("sha256")
          .update(JSON.stringify({ operation, params, query, body }))
          .digest("hex");
      }
      const resolve = () => {
        if (key) {
          const existing = options.store.cached(key, hash);
          if (existing !== null) return existing;
        }
        const result = service.execute(
          operation as OperationId,
          params,
          query,
          body,
        );
        if (result instanceof Promise)
          throw new Error("Async work cannot enter a SQLite transaction");
        const data = route.response.parse(result);
        if (key) options.store.cache(key, hash, data);
        return data;
      };
      let data: unknown;
      if (
        [
          "interpretPreferences",
          "explainProjection",
          "summarizeComments",
          "lookupReviewMatch",
          "fetchReview",
          "logout",
          "applyClear",
        ].includes(operation)
      ) {
        const cached = key ? options.store.cached(key, hash) : null;
        if (cached !== null) data = cached;
        else {
          const active = key ? pending.get(key) : undefined;
          if (active && active.hash !== hash)
            throw new ServiceError(
              "IDEMPOTENCY_CONFLICT",
              "同一幂等键对应不同请求。",
            );
          if (active) data = await active.work;
          else {
            const work = (async () => {
              const result = await service.execute(
                operation as OperationId,
                params,
                query,
                body,
              );
              return options.store.transaction(() => {
                const value = route.response.parse(result);
                if (key) options.store.cache(key, hash, value);
                return value;
              });
            })();
            if (key) pending.set(key, { hash, work });
            try {
              data = await work;
            } finally {
              if (key) pending.delete(key);
            }
          }
        }
      } else data = options.store.transaction(resolve);
      return c.json(
        success(z.unknown()).parse({ meta: meta(), data }),
        route.successStatus,
      );
    });
  }
  app.all("/api/*", () => {
    throw new ServiceError("NOT_FOUND", "接口不存在。");
  });
  return {
    app,
    service,
    close: async () => {
      service.planning.close();
      service.models.clear();
      service.reviews.clear();
      await service.school?.close();
    },
  };
}
