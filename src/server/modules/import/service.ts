import * as z from "zod";
import { type Catalog, catalogSchema } from "../../../shared/contracts/catalog.js";
import { type ErrorCode, ErrorCodes } from "../../../shared/contracts/errors.js";
import { type Pool, poolSchema } from "../../../shared/contracts/pool.js";
import { type ExportEnvelope, exportEnvelopeSchema } from "../../../shared/contracts/session.js";

/**
 * 导入校验与规范化（组员 A；docs/08 §5.1）。
 *
 * 定位：JSON 导入、规范化、错误定位（不信任任何用户导入内容）。
 * 边界：只校验契约和引用关系；可排性由 selection-model 独占判断。
 */

export interface ImportIssue {
  /** JavaScript 风格 JSON 路径，如 "courses[2].sections[0].credits" */
  path: string;
  code: ErrorCode;
  message: string;
}

export type ImportResult<T> = { ok: true; data: T } | { ok: false; issues: ImportIssue[] };
export type CatalogImportResult =
  | { ok: true; catalog: Catalog }
  | { ok: false; issues: ImportIssue[] };

interface CatalogIndex {
  courseCodes: Set<string>;
  sectionCourseCodes: Map<string, string>;
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") {
      return `${formatted}[${segment}]`;
    }
    const field = String(segment);
    return formatted.length === 0 ? field : `${formatted}.${field}`;
  }, "");
}

function schemaIssues(error: z.ZodError): ImportIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    code: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
    message: issue.message,
  }));
}

function parseJson<T>(text: string, schema: z.ZodType<T>): ImportResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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

  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, issues: schemaIssues(parsed.error) };
}

function validateValue<T>(value: unknown, schema: z.ZodType<T>): ImportResult<T> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, issues: schemaIssues(parsed.error) };
}

/** 解析并校验课程目录 JSON 文本；错误逐条定位。 */
export function parseCatalogJson(text: string): CatalogImportResult {
  const result = parseJson(text, catalogSchema);
  if (!result.ok) {
    return result;
  }
  const duplicateIssues = findDuplicateSections(result.data);
  return duplicateIssues.length > 0
    ? { ok: false, issues: duplicateIssues }
    : { ok: true, catalog: result.data };
}

function findDuplicateSections(catalog: Catalog): ImportIssue[] {
  const seen = new Set<string>();
  const issues: ImportIssue[] = [];
  catalog.courses.forEach((course, courseIndex) => {
    course.sections.forEach((section, sectionIndex) => {
      if (seen.has(section.sectionId)) {
        issues.push({
          path: `courses[${courseIndex}].sections[${sectionIndex}].sectionId`,
          code: ErrorCodes.IMPORT_DUPLICATE_SECTION,
          message: `教学班 ${section.sectionId} 重复出现`,
        });
      }
      seen.add(section.sectionId);
    });
  });
  return issues;
}

function indexCatalog(catalog: Catalog): CatalogIndex {
  const courseCodes = new Set<string>();
  const sectionCourseCodes = new Map<string, string>();
  for (const course of catalog.courses) {
    courseCodes.add(course.courseCode);
    for (const section of course.sections) {
      sectionCourseCodes.set(section.sectionId, course.courseCode);
    }
  }
  return { courseCodes, sectionCourseCodes };
}

function validatePoolReferences(pool: Pool, catalog: Catalog, prefix = ""): ImportIssue[] {
  const index = indexCatalog(catalog);
  const issues: ImportIssue[] = [];
  pool.targets.forEach((target, targetIndex) => {
    const targetPath = `${prefix}targets[${targetIndex}]`;
    if (!index.courseCodes.has(target.courseCode)) {
      issues.push({
        path: `${targetPath}.courseCode`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `课程 ${target.courseCode} 不在课程目录中`,
      });
    }
    target.candidateSectionIds.forEach((sectionId, sectionIndex) => {
      const actualCourseCode = index.sectionCourseCodes.get(sectionId);
      if (actualCourseCode !== target.courseCode) {
        issues.push({
          path: `${targetPath}.candidateSectionIds[${sectionIndex}]`,
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          message:
            actualCourseCode === undefined
              ? `教学班 ${sectionId} 不在课程目录中`
              : `教学班 ${sectionId} 属于课程 ${actualCourseCode}，不属于 ${target.courseCode}`,
        });
      }
    });
  });
  return issues;
}

/** 解析课程池，并使用同次提供的课程目录校验课程/教学班引用。 */
export function parsePoolJson(text: string, catalog: Catalog): ImportResult<Pool> {
  const result = parseJson(text, poolSchema);
  if (!result.ok) {
    return result;
  }
  const issues = validatePoolReferences(result.data, catalog);
  return issues.length > 0 ? { ok: false, issues } : result;
}

/** 解析客户端状态导出；可选目录只用于引用校验，不参与可排性判断。 */
export function parseExportJson(text: string, catalog?: Catalog): ImportResult<ExportEnvelope> {
  const result = parseJson(text, exportEnvelopeSchema);
  if (!result.ok || catalog === undefined) {
    return result;
  }
  const issues = validatePoolReferences(result.data.session.pool, catalog, "session.pool.");
  return issues.length > 0 ? { ok: false, issues } : result;
}

/** 校验并确定性序列化 export.v1；时间戳由调用方提供，不在此处隐式改写。 */
export function serializeExportEnvelope(value: unknown, catalog?: Catalog): ImportResult<string> {
  const result = validateValue(value, exportEnvelopeSchema);
  if (!result.ok) {
    return result;
  }
  if (catalog !== undefined) {
    const issues = validatePoolReferences(result.data.session.pool, catalog, "session.pool.");
    if (issues.length > 0) {
      return { ok: false, issues };
    }
  }
  return { ok: true, data: `${JSON.stringify(result.data, null, 2)}\n` };
}

/** 供路由复用的请求体 Schema。 */
export const catalogImportRequestSchema = z.object({
  catalogJson: z.string().min(1),
});

export const poolImportRequestSchema = z.object({
  poolJson: z.string().min(1),
  catalogJson: z.string().min(1),
});

export const exportImportRequestSchema = z.object({
  exportJson: z.string().min(1),
  catalogJson: z.string().min(1).optional(),
});

export const exportSerializeRequestSchema = z.object({
  envelope: z.unknown(),
  catalogJson: z.string().min(1).optional(),
});
