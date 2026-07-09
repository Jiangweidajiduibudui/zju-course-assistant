import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";
import type { SourceMeta } from "../../../shared/contracts/index.js";
import type { ServerConfig } from "../../config.js";
import { logEvent } from "../diagnostics/logger.js";
import { ChalaoshiFetchError, type FetchLike } from "./fetcher.js";
import { ChalaoshiParseError } from "./parser.js";
import {
  ChalaoshiNotFoundError,
  type ChalaoshiService,
  createChalaoshiService,
} from "./service.js";

/**
 * chalaoshi 模块路由（组员 B；docs/08 §5.1）。
 *
 * 端点：
 * - GET /api/chalaoshi/teachers?query=…      教师索引搜索（search.json）
 * - GET /api/chalaoshi/teacher/:id           教师详情（均绩分行、点名比例）
 * - GET /api/chalaoshi/teacher/:id/comments  近五年评论
 *
 * 上游失败时默认降级 seed，`demo: true` + `sourceMeta.cacheState === "seed"`。
 * seed/stale 成功响应记 warn + cacheState，便于观测上游失败/parser drift。
 */

export interface BuildChalaoshiRoutesOptions {
  config: ServerConfig;
  /** 测试注入：mock upstream，避免真实 DNS/网络 */
  fetchImpl?: FetchLike;
  /** 测试注入：直接替换 service（优先于 createChalaoshiService） */
  service?: ChalaoshiService;
  timeoutMs?: number;
  minIntervalMs?: number;
}

function isRoutesOptions(
  value: ServerConfig | BuildChalaoshiRoutesOptions,
): value is BuildChalaoshiRoutesOptions {
  return (
    "config" in value &&
    value.config != null &&
    typeof value.config === "object" &&
    "CHALAOSHI_BASE_URL" in value.config
  );
}

/** 兼容 `buildChalaoshiRoutes(config)` 与 `buildChalaoshiRoutes({ config, fetchImpl })` */
export function buildChalaoshiRoutes(configOrOptions: ServerConfig | BuildChalaoshiRoutesOptions) {
  const options: BuildChalaoshiRoutesOptions = isRoutesOptions(configOrOptions)
    ? configOrOptions
    : { config: configOrOptions };

  const service =
    options.service ??
    createChalaoshiService({
      config: options.config,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      minIntervalMs: options.minIntervalMs,
    });

  return async function chalaoshiRoutes(app: FastifyInstance): Promise<void> {
    app.get("/teachers", async (request, reply) => {
      const started = performance.now();
      const query =
        typeof (request.query as { query?: unknown }).query === "string"
          ? (request.query as { query: string }).query
          : "";
      try {
        const result = await service.searchTeachers(query);
        logOutcome(request, started, "search_teachers", result.sourceMeta.cacheState);
        return reply.send({
          ok: true,
          teachers: result.teachers,
          sourceMeta: result.sourceMeta,
          demo: result.sourceMeta.cacheState === "seed",
        });
      } catch (cause) {
        return sendChalaoshiError(reply, request, started, "search_teachers", cause);
      }
    });

    app.get<{ Params: { id: string } }>("/teacher/:id", async (request, reply) => {
      const started = performance.now();
      const teacherId = Number(request.params.id);
      if (!Number.isInteger(teacherId) || teacherId < 0) {
        return reply.code(400).send({
          errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
          message: "teacher id 必须是非负整数",
        });
      }
      try {
        const detail = await service.getTeacherDetail(teacherId);
        logOutcome(request, started, "teacher_detail", detail.sourceMeta.cacheState);
        return reply.send({
          ok: true,
          teacher: detail,
          demo: detail.sourceMeta.cacheState === "seed",
        });
      } catch (cause) {
        return sendChalaoshiError(reply, request, started, "teacher_detail", cause);
      }
    });

    app.get<{ Params: { id: string } }>("/teacher/:id/comments", async (request, reply) => {
      const started = performance.now();
      const teacherId = Number(request.params.id);
      if (!Number.isInteger(teacherId) || teacherId < 0) {
        return reply.code(400).send({
          errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
          message: "teacher id 必须是非负整数",
        });
      }
      try {
        const batch = await service.getTeacherComments(teacherId);
        logOutcome(request, started, "teacher_comments", batch.sourceMeta.cacheState);
        return reply.send({
          ok: true,
          ...batch,
          demo: batch.sourceMeta.cacheState === "seed",
        });
      } catch (cause) {
        return sendChalaoshiError(reply, request, started, "teacher_comments", cause);
      }
    });
  };
}

function logOutcome(
  request: FastifyRequest,
  started: number,
  action: string,
  cacheState: SourceMeta["cacheState"],
): void {
  const degraded = cacheState === "seed" || cacheState === "stale";
  logEvent({
    level: degraded ? "warn" : "info",
    requestId: request.id,
    generationId: null,
    module: "chalaoshi",
    action,
    status: "ok",
    durationMs: Math.round(performance.now() - started),
    errorCode: null,
    cacheState,
  });
}

function sendChalaoshiError(
  reply: FastifyReply,
  request: FastifyRequest,
  started: number,
  action: string,
  cause: unknown,
) {
  if (cause instanceof ChalaoshiNotFoundError) {
    logEvent({
      level: "info",
      requestId: request.id,
      generationId: null,
      module: "chalaoshi",
      action,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      errorCode: cause.errorCode,
      cacheState: null,
    });
    return reply.code(404).send({
      errorCode: cause.errorCode,
      message: cause.message,
    });
  }

  const errorCode =
    cause instanceof ChalaoshiFetchError
      ? cause.errorCode
      : cause instanceof ChalaoshiParseError
        ? ErrorCodes.CHALAOSHI_PARSE_FAILED
        : ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE;
  logEvent({
    level: "warn",
    requestId: request.id,
    generationId: null,
    module: "chalaoshi",
    action,
    status: "failed",
    durationMs: Math.round(performance.now() - started),
    errorCode,
    cacheState: null,
  });
  return reply.code(502).send({
    errorCode,
    message: cause instanceof Error ? cause.message : "chalaoshi 请求失败",
  });
}
