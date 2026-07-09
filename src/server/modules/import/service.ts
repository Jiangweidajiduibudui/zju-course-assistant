import * as z from "zod";
import { type Catalog, catalogSchema } from "../../../shared/contracts/catalog.js";
import { type ErrorCode, ErrorCodes } from "../../../shared/contracts/errors.js";
import {
  type ExportEnvelope,
  exportEnvelopeSchema,
  type Session,
} from "../../../shared/contracts/session.js";

/**
 * 导入校验与规范化（组员 A；docs/08 §5.1）。
 *
 * 定位：JSON 导入、规范化、错误定位（不信任任何用户导入内容）。
 * 边界：不自动登录 zdbk，不解析未授权页面（Excel/OCR/HTML 粘贴首版不做）。
 * 成功判据：Task 0/2 门禁 —— contract tests + invalid fixture tests +
 * 导入→修改→导出→再导入往返一致（docs/05 §1、§2）。
 */

export interface ImportIssue {
  /** JSON 路径，如 "courses[2].sections[0].credits" */
  path: string;
  code: ErrorCode;
  message: string;
}

export type ImportResult = { ok: true; catalog: Catalog } | { ok: false; issues: ImportIssue[] };

export type ExportParseResult =
  | { ok: true; envelope: ExportEnvelope }
  | { ok: false; issues: ImportIssue[] };

export type BundleParseResult =
  | {
      ok: true;
      catalog: Catalog;
      envelope: ExportEnvelope;
      incompleteSectionIds: string[];
    }
  | { ok: false; issues: ImportIssue[] };

function parseJsonText(
  text: string,
): { ok: true; value: unknown } | { ok: false; issues: ImportIssue[] } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          code: ErrorCodes.IMPORT_INVALID_JSON,
          message: cause instanceof Error ? cause.message : "JSON 解析失败",
        },
      ],
    };
  }
}

function zodIssuesToImportIssues(error: z.ZodError): ImportIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
    message: issue.message,
  }));
}

/** 解析并校验课程目录 JSON 文本；错误逐条定位（AC 见 docs/05 §1 导入校验器） */
export function parseCatalogJson(text: string): ImportResult {
  const json = parseJsonText(text);
  if (!json.ok) {
    return json;
  }
  const parsed = catalogSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToImportIssues(parsed.error) };
  }
  const dupIssues = findDuplicateSections(parsed.data);
  if (dupIssues.length > 0) {
    return { ok: false, issues: dupIssues };
  }
  return { ok: true, catalog: parsed.data };
}

/** 解析 export.v1 信封（仅 Schema；section 引用需配合 catalog 校验） */
export function parseExportEnvelopeJson(text: string): ExportParseResult {
  const json = parseJsonText(text);
  if (!json.ok) {
    return json;
  }
  const parsed = exportEnvelopeSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToImportIssues(parsed.error) };
  }
  return { ok: true, envelope: parsed.data };
}

/**
 * 校验 session 内所有 sectionId 均存在于 catalog。
 * 覆盖 baseline.selected / baseline.volunteers / pool.targets / plan / history。
 */
export function validateSessionSectionRefs(catalog: Catalog, session: Session): ImportIssue[] {
  const known = collectSectionIds(catalog);
  const issues: ImportIssue[] = [];

  session.baseline.selected.forEach((sectionId, index) => {
    if (!known.has(sectionId)) {
      issues.push({
        path: `session.baseline.selected[${index}]`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `未知教学班引用: ${sectionId}`,
      });
    }
  });

  session.baseline.volunteers.forEach((volunteer, index) => {
    if (!known.has(volunteer.sectionId)) {
      issues.push({
        path: `session.baseline.volunteers[${index}].sectionId`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `未知教学班引用: ${volunteer.sectionId}`,
      });
    }
  });

  session.pool.targets.forEach((target, ti) => {
    target.candidateSectionIds.forEach((sectionId, si) => {
      if (!known.has(sectionId)) {
        issues.push({
          path: `session.pool.targets[${ti}].candidateSectionIds[${si}]`,
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          message: `未知教学班引用: ${sectionId}`,
        });
      }
    });
  });

  if (session.plan) {
    issues.push(...validatePlanSectionRefs(known, session.plan, "session.plan"));
  }

  session.history.forEach((entry, hi) => {
    entry.pool.targets.forEach((target, ti) => {
      target.candidateSectionIds.forEach((sectionId, si) => {
        if (!known.has(sectionId)) {
          issues.push({
            path: `session.history[${hi}].pool.targets[${ti}].candidateSectionIds[${si}]`,
            code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
            message: `未知教学班引用: ${sectionId}`,
          });
        }
      });
    });
    if (entry.plan) {
      issues.push(...validatePlanSectionRefs(known, entry.plan, `session.history[${hi}].plan`));
    }
  });

  return issues;
}

function validatePlanSectionRefs(
  known: Set<string>,
  plan: NonNullable<Session["plan"]>,
  basePath: string,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  plan.volunteers.forEach((volunteer, index) => {
    if (!known.has(volunteer.sectionId)) {
      issues.push({
        path: `${basePath}.volunteers[${index}].sectionId`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `未知教学班引用: ${volunteer.sectionId}`,
      });
    }
  });
  plan.groups.forEach((group, gi) => {
    group.orderedSectionIds.forEach((sectionId, si) => {
      if (!known.has(sectionId)) {
        issues.push({
          path: `${basePath}.groups[${gi}].orderedSectionIds[${si}]`,
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          message: `未知教学班引用: ${sectionId}`,
        });
      }
    });
  });
  return issues;
}

/** credits / examTime 缺失的教学班 ID（合法导入，供待选池滞留标记） */
export function listIncompleteSectionIds(catalog: Catalog): string[] {
  const ids: string[] = [];
  for (const course of catalog.courses) {
    for (const section of course.sections) {
      if (section.credits === null || section.examTime === null) {
        ids.push(section.sectionId);
      }
    }
  }
  return ids;
}

/**
 * 同时校验 catalog + export.v1（Task 2 往返主路径）。
 * catalogJson 与 exportJson 均为原始文本，错误定位统一在此产出。
 */
export function parseCatalogExportBundle(
  catalogJson: string,
  exportJson: string,
): BundleParseResult {
  const catalogResult = parseCatalogJson(catalogJson);
  if (!catalogResult.ok) {
    return catalogResult;
  }
  const exportResult = parseExportEnvelopeJson(exportJson);
  if (!exportResult.ok) {
    return {
      ok: false,
      issues: exportResult.issues.map((issue) => ({
        ...issue,
        path: issue.path ? `export.${issue.path}` : "export",
      })),
    };
  }
  const refIssues = validateSessionSectionRefs(
    catalogResult.catalog,
    exportResult.envelope.session,
  );
  if (refIssues.length > 0) {
    return { ok: false, issues: refIssues };
  }
  return {
    ok: true,
    catalog: catalogResult.catalog,
    envelope: exportResult.envelope,
    incompleteSectionIds: listIncompleteSectionIds(catalogResult.catalog),
  };
}

/** 构造 export.v1（供服务端/测试往返；与 client buildExportEnvelope 语义一致） */
export function buildExportEnvelope(
  session: Session,
  options: { exportedAt?: Date | string } = {},
): ExportEnvelope {
  const exportedAt =
    options.exportedAt instanceof Date
      ? options.exportedAt.toISOString()
      : (options.exportedAt ?? new Date().toISOString());
  return exportEnvelopeSchema.parse({
    schemaVersion: "export.v1",
    exportedAt,
    session,
  });
}

function collectSectionIds(catalog: Catalog): Set<string> {
  const ids = new Set<string>();
  for (const course of catalog.courses) {
    for (const section of course.sections) {
      ids.add(section.sectionId);
    }
  }
  return ids;
}

function findDuplicateSections(catalog: Catalog): ImportIssue[] {
  const seen = new Set<string>();
  const issues: ImportIssue[] = [];
  catalog.courses.forEach((course, ci) => {
    course.sections.forEach((section, si) => {
      if (seen.has(section.sectionId)) {
        issues.push({
          path: `courses[${ci}].sections[${si}].sectionId`,
          code: ErrorCodes.IMPORT_DUPLICATE_SECTION,
          message: `教学班 ${section.sectionId} 重复出现`,
        });
      }
      seen.add(section.sectionId);
    });
  });
  return issues;
}

/** 供路由复用的请求体 Schema */
export const importRequestSchema = z.object({
  /** 原始 JSON 文本（客户端不预解析，错误定位统一由服务端产出） */
  catalogJson: z.string().min(1),
});

export const exportEnvelopeRequestSchema = z.object({
  exportJson: z.string().min(1),
  /** 可选：提供则额外校验 session 内 section 引用 */
  catalogJson: z.string().min(1).optional(),
});

export const bundleRequestSchema = z.object({
  catalogJson: z.string().min(1),
  exportJson: z.string().min(1),
});
