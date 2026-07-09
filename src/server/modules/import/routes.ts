import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";
import { logEvent } from "../diagnostics/logger.js";
import {
  catalogImportRequestSchema,
  exportImportRequestSchema,
  exportSerializeRequestSchema,
  type ImportIssue,
  parseCatalogJson,
  parseExportJson,
  parsePoolJson,
  poolImportRequestSchema,
  serializeExportEnvelope,
} from "./service.js";

function topLevelErrorCode(issues: ImportIssue[]) {
  return issues[0]?.code ?? ErrorCodes.IMPORT_SCHEMA_MISMATCH;
}

function sendIssues(reply: FastifyReply, issues: ImportIssue[]) {
  return reply.code(422).send({
    errorCode: topLevelErrorCode(issues),
    message: "导入或导出数据未通过校验",
    details: issues,
  });
}

function logImportOperation(
  request: FastifyRequest,
  action: string,
  started: number,
  issues?: ImportIssue[],
): void {
  logEvent({
    level: issues === undefined ? "info" : "warn",
    requestId: request.id,
    generationId: null,
    module: "import",
    action,
    status: issues === undefined ? "ok" : "failed",
    durationMs: Math.round(performance.now() - started),
    errorCode: issues === undefined ? null : topLevelErrorCode(issues),
  });
}

/** 无状态 JSON 导入/导出 API；请求载荷内容不会进入日志。 */
export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post("/catalog", async (request, reply) => {
    const started = performance.now();
    const body = catalogImportRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 catalogImportRequestSchema",
        details: body.error.issues,
      });
    }
    const result = parseCatalogJson(body.data.catalogJson);
    logImportOperation(request, "parse_catalog", started, result.ok ? undefined : result.issues);
    if (!result.ok) {
      return sendIssues(reply, result.issues);
    }
    return reply.send({
      ok: true,
      catalog: result.catalog,
      synthetic: result.catalog.synthetic,
      courseCount: result.catalog.courses.length,
      sectionCount: result.catalog.courses.reduce(
        (count, course) => count + course.sections.length,
        0,
      ),
    });
  });

  app.post("/pool", async (request, reply) => {
    const started = performance.now();
    const body = poolImportRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 poolImportRequestSchema",
        details: body.error.issues,
      });
    }
    const catalogResult = parseCatalogJson(body.data.catalogJson);
    if (!catalogResult.ok) {
      logImportOperation(request, "parse_pool", started, catalogResult.issues);
      return sendIssues(reply, catalogResult.issues);
    }
    const result = parsePoolJson(body.data.poolJson, catalogResult.catalog);
    logImportOperation(request, "parse_pool", started, result.ok ? undefined : result.issues);
    return result.ok
      ? reply.send({ ok: true, pool: result.data })
      : sendIssues(reply, result.issues);
  });

  app.post("/export/import", async (request, reply) => {
    const started = performance.now();
    const body = exportImportRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 exportImportRequestSchema",
        details: body.error.issues,
      });
    }
    const catalogResult =
      body.data.catalogJson === undefined ? undefined : parseCatalogJson(body.data.catalogJson);
    if (catalogResult !== undefined && !catalogResult.ok) {
      logImportOperation(request, "parse_export", started, catalogResult.issues);
      return sendIssues(reply, catalogResult.issues);
    }
    const result = parseExportJson(body.data.exportJson, catalogResult?.catalog);
    logImportOperation(request, "parse_export", started, result.ok ? undefined : result.issues);
    return result.ok
      ? reply.send({ ok: true, envelope: result.data })
      : sendIssues(reply, result.issues);
  });

  app.post("/export", async (request, reply) => {
    const started = performance.now();
    const body = exportSerializeRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "请求体不符合 exportSerializeRequestSchema",
        details: body.error.issues,
      });
    }
    const catalogResult =
      body.data.catalogJson === undefined ? undefined : parseCatalogJson(body.data.catalogJson);
    if (catalogResult !== undefined && !catalogResult.ok) {
      logImportOperation(request, "serialize_export", started, catalogResult.issues);
      return sendIssues(reply, catalogResult.issues);
    }
    const result = serializeExportEnvelope(body.data.envelope, catalogResult?.catalog);
    logImportOperation(request, "serialize_export", started, result.ok ? undefined : result.issues);
    return result.ok
      ? reply.send({ ok: true, exportJson: result.data })
      : sendIssues(reply, result.issues);
  });
}
