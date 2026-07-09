import type { FastifyInstance } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";
import { logEvent } from "../diagnostics/logger.js";
import { importRequestSchema, parseCatalogJson } from "./service.js";

/**
 * import 模块路由（组员 A）。
 * POST /api/import/catalog —— 校验课程目录 JSON，返回规范化结果或逐条错误定位。
 */
export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post("/catalog", async (request, reply) => {
    const started = performance.now();
    const body = importRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 importRequestSchema",
        details: body.error.issues,
      });
    }
    const result = parseCatalogJson(body.data.catalogJson);
    logEvent({
      level: result.ok ? "info" : "warn",
      requestId: request.id,
      generationId: null,
      module: "import",
      action: "parse_catalog",
      status: result.ok ? "ok" : "failed",
      durationMs: Math.round(performance.now() - started),
      errorCode: result.ok ? null : ErrorCodes.IMPORT_SCHEMA_MISMATCH,
    });
    if (!result.ok) {
      return reply.code(422).send({
        errorCode: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
        message: "导入数据未通过校验",
        details: result.issues,
      });
    }
    // 只回传摘要；完整数据由客户端 Dexie 持久化（服务端不保存用户规划数据，D04）。
    return reply.send({
      ok: true,
      synthetic: result.catalog.synthetic,
      courseCount: result.catalog.courses.length,
      sectionCount: result.catalog.courses.reduce((n, c) => n + c.sections.length, 0),
    });
  });
}
