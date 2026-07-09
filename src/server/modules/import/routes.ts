import type { FastifyInstance } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";
import { logEvent } from "../diagnostics/logger.js";
import {
  bundleRequestSchema,
  exportEnvelopeRequestSchema,
  importRequestSchema,
  listIncompleteSectionIds,
  parseCatalogExportBundle,
  parseCatalogJson,
  parseExportEnvelopeJson,
  validateSessionSectionRefs,
} from "./service.js";

/**
 * import 模块路由（组员 A）。
 * - POST /api/import/catalog —— 校验课程目录 JSON
 * - POST /api/import/export-envelope —— 校验 export.v1（可选联检 catalog）
 * - POST /api/import/bundle —— catalog + export 往返主路径
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
      errorCode: result.ok ? null : (result.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH),
    });
    if (!result.ok) {
      return reply.code(422).send({
        errorCode: result.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH,
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
      incompleteSectionIds: listIncompleteSectionIds(result.catalog),
      catalog: result.catalog,
    });
  });

  app.post("/export-envelope", async (request, reply) => {
    const started = performance.now();
    const body = exportEnvelopeRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 exportEnvelopeRequestSchema",
        details: body.error.issues,
      });
    }

    const exportResult = parseExportEnvelopeJson(body.data.exportJson);
    if (!exportResult.ok) {
      logEvent({
        level: "warn",
        requestId: request.id,
        generationId: null,
        module: "import",
        action: "parse_export_envelope",
        status: "failed",
        durationMs: Math.round(performance.now() - started),
        errorCode: exportResult.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH,
      });
      return reply.code(422).send({
        errorCode: exportResult.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH,
        message: "导出信封未通过校验",
        details: exportResult.issues,
      });
    }

    if (body.data.catalogJson) {
      const catalogResult = parseCatalogJson(body.data.catalogJson);
      if (!catalogResult.ok) {
        return reply.code(422).send({
          errorCode: catalogResult.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH,
          message: "联检用 catalog 未通过校验",
          details: catalogResult.issues,
        });
      }
      const refIssues = validateSessionSectionRefs(
        catalogResult.catalog,
        exportResult.envelope.session,
      );
      if (refIssues.length > 0) {
        return reply.code(422).send({
          errorCode: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          message: "session 引用了 catalog 中不存在的教学班",
          details: refIssues,
        });
      }
    }

    logEvent({
      level: "info",
      requestId: request.id,
      generationId: null,
      module: "import",
      action: "parse_export_envelope",
      status: "ok",
      durationMs: Math.round(performance.now() - started),
      errorCode: null,
    });

    return reply.send({
      ok: true,
      schemaVersion: exportResult.envelope.schemaVersion,
      exportedAt: exportResult.envelope.exportedAt,
      sessionId: exportResult.envelope.session.id,
      envelope: exportResult.envelope,
    });
  });

  app.post("/bundle", async (request, reply) => {
    const started = performance.now();
    const body = bundleRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 bundleRequestSchema",
        details: body.error.issues,
      });
    }

    const result = parseCatalogExportBundle(body.data.catalogJson, body.data.exportJson);
    logEvent({
      level: result.ok ? "info" : "warn",
      requestId: request.id,
      generationId: null,
      module: "import",
      action: "parse_bundle",
      status: result.ok ? "ok" : "failed",
      durationMs: Math.round(performance.now() - started),
      errorCode: result.ok ? null : (result.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH),
    });

    if (!result.ok) {
      return reply.code(422).send({
        errorCode: result.issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH,
        message: "catalog + export 联检未通过",
        details: result.issues,
      });
    }

    return reply.send({
      ok: true,
      synthetic: result.catalog.synthetic,
      incompleteSectionIds: result.incompleteSectionIds,
      catalog: result.catalog,
      envelope: result.envelope,
    });
  });
}
