import * as z from "zod";
import { type Catalog, catalogSchema } from "../../../shared/contracts/catalog.js";
import { type ErrorCode, ErrorCodes } from "../../../shared/contracts/errors.js";

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

/** 解析并校验课程目录 JSON 文本；错误逐条定位（AC 见 docs/05 §1 导入校验器） */
export function parseCatalogJson(text: string): ImportResult {
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
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        code: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
        message: issue.message,
      })),
    };
  }
  const dupIssues = findDuplicateSections(parsed.data);
  if (dupIssues.length > 0) {
    return { ok: false, issues: dupIssues };
  }
  return { ok: true, catalog: parsed.data };
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
