import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";
import type { ServerConfig } from "../../config.js";
import { logEvent } from "../diagnostics/logger.js";
import { ChalaoshiFetchError } from "./fetcher.js";
import { ChalaoshiParseError } from "./parser.js";
import { createChalaoshiService } from "./service.js";

/**
 * chalaoshi 模块路由（组员 B；docs/08 §5.1）。
 *
 * 端点：
 * - GET /api/chalaoshi/teachers?query=…      教师索引搜索（search.json）
 * - GET /api/chalaoshi/teacher/:id           教师详情（均绩分行、点名比例）
 * - GET /api/chalaoshi/teacher/:id/comments  近五年评论
 *
 * 上游失败时默认降级 seed，`demo: true` + `sourceMeta.cacheState === "seed"`。
 */
export function buildChalaoshiRoutes(config: ServerConfig) {
  const service = createChalaoshiService({ config });

  return async function chalaoshiRoutes(app: FastifyInstance): Promise<void> {
    app.get("/teachers", async (request, reply) => {
      const started = performance.now();
      const query =
        typeof (request.query as { query?: unknown }).query === "string"
          ? (request.query as { query: string }).query
          : "";
      try {
        const result = await service.searchTeachers(query);
        logOk(request, started, "search_teachers");
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
        logOk(request, started, "teacher_detail");
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
        logOk(request, started, "teacher_comments");
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

function logOk(request: FastifyRequest, started: number, action: string): void {
  logEvent({
    level: "info",
    requestId: request.id,
    generationId: null,
    module: "chalaoshi",
    action,
    status: "ok",
    durationMs: Math.round(performance.now() - started),
    errorCode: null,
  });
}

function sendChalaoshiError(
  reply: FastifyReply,
  request: FastifyRequest,
  started: number,
  action: string,
  cause: unknown,
) {
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
  });
  return reply.code(502).send({
    errorCode,
    message: cause instanceof Error ? cause.message : "chalaoshi 请求失败",
  });
}
