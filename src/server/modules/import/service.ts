import * as z from "zod";
import { type Baseline, baselineSchema } from "../../../shared/contracts/baseline.js";
import { type Catalog, catalogSchema } from "../../../shared/contracts/catalog.js";
import { type ErrorCode, ErrorCodes } from "../../../shared/contracts/errors.js";
import { type Pool, poolSchema } from "../../../shared/contracts/pool.js";
import {
  type ExportEnvelope,
  exportEnvelopeSchema,
  type Session,
  sessionSchema,
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

export type BaselineParseResult =
  | { ok: true; baseline: Baseline }
  | { ok: false; issues: ImportIssue[] };

export type PoolParseResult = { ok: true; pool: Pool } | { ok: false; issues: ImportIssue[] };

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
  const privacyIssues = findPrivacySuspectIssues(parsed.data);
  if (privacyIssues.length > 0) {
    return { ok: false, issues: privacyIssues };
  }
  const catalog = normalizeCatalog(parsed.data);
  const consistencyIssues = findCatalogConsistencyIssues(catalog);
  if (consistencyIssues.length > 0) {
    return { ok: false, issues: consistencyIssues };
  }
  // 再跑一遍 Schema，确保规范化后仍合法（如教师拆分后为空）
  const reparsed = catalogSchema.safeParse(catalog);
  if (!reparsed.success) {
    return { ok: false, issues: zodIssuesToImportIssues(reparsed.error) };
  }
  return { ok: true, catalog: reparsed.data };
}

/**
 * 规范化 catalog（字段修正，docs/08 §5.1）：
 * - 字符串 trim；
 * - teachers 按 `<br>` / `<br/>` / 换行拆分并去空；
 * - section.courseCode / courseName 与所属课程对齐（以课程为准）。
 */
export function normalizeCatalog(catalog: Catalog): Catalog {
  return {
    ...catalog,
    courses: catalog.courses.map((course) => {
      const courseCode = course.courseCode.trim();
      const courseName = course.courseName.trim();
      return {
        ...course,
        courseCode,
        courseName,
        college: course.college === null ? null : course.college.trim() || null,
        category: course.category === null ? null : course.category.trim() || null,
        sections: course.sections.map((section) => ({
          ...section,
          sectionId: section.sectionId.trim(),
          courseCode,
          courseName,
          teachers: splitTeachers(section.teachers),
          place: section.place === null ? null : section.place.trim() || null,
          examTime:
            section.examTime === null
              ? null
              : {
                  examKey: section.examTime.examKey.trim(),
                  raw: section.examTime.raw.trim(),
                },
          unverifiedRaw: section.unverifiedRaw
            ? Object.fromEntries(
                Object.entries(section.unverifiedRaw).map(([key, value]) => [
                  key.trim(),
                  value.trim(),
                ]),
              )
            : undefined,
        })),
      };
    }),
  };
}

/** 拆分 zdbk 风格多师字符串（`<br>` / 换行）；已是单名则 trim */
export function splitTeachers(teachers: string[]): string[] {
  const parts: string[] = [];
  for (const raw of teachers) {
    for (const piece of raw.split(/<br\s*\/?>|\n|\r/i)) {
      const name = piece.trim();
      if (name.length > 0) {
        parts.push(name);
      }
    }
  }
  return parts;
}

/**
 * catalog 内部一致性：同一 courseCode 不得重复出现。
 * （section 与课程的 code/name 已在 normalize 中对齐）
 */
export function findCatalogConsistencyIssues(catalog: Catalog): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const seenCourse = new Map<string, number>();
  catalog.courses.forEach((course, ci) => {
    const prev = seenCourse.get(course.courseCode);
    if (prev !== undefined) {
      issues.push({
        path: `courses[${ci}].courseCode`,
        code: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
        message: `课程代码 ${course.courseCode} 与 courses[${prev}] 重复`,
      });
    } else {
      seenCourse.set(course.courseCode, ci);
    }
  });
  return issues;
}

/**
 * 隐私疑似扫描（D41 / docs/05 未脱敏样例）：命中则拒绝导入，不落库。
 * 保守规则，避免误杀合成 demo（课程代码/考试 key 中的年份数字不单独触发）。
 */
export function findPrivacySuspectIssues(catalog: Catalog): ImportIssue[] {
  const issues: ImportIssue[] = [];

  const checkString = (path: string, value: string): void => {
    if (PRIVACY_LABEL_RE.test(value) || PRIVACY_STUDENT_ID_RE.test(value)) {
      issues.push({
        path,
        code: ErrorCodes.IMPORT_PRIVACY_SUSPECT,
        message: "疑似包含学号/隐私标识，已拒绝导入",
      });
    }
    if (PRIVACY_COOKIE_RE.test(value)) {
      issues.push({
        path,
        code: ErrorCodes.IMPORT_PRIVACY_SUSPECT,
        message: "疑似包含 Cookie/会话片段，已拒绝导入",
      });
    }
  };

  const checkKey = (path: string, key: string): void => {
    if (PRIVACY_KEY_RE.test(key)) {
      issues.push({
        path,
        code: ErrorCodes.IMPORT_PRIVACY_SUSPECT,
        message: `字段名疑似隐私相关（${key}），已拒绝导入`,
      });
    }
  };

  catalog.courses.forEach((course, ci) => {
    checkString(`courses[${ci}].courseName`, course.courseName);
    if (course.college) {
      checkString(`courses[${ci}].college`, course.college);
    }
    course.sections.forEach((section, si) => {
      const base = `courses[${ci}].sections[${si}]`;
      checkString(`${base}.courseName`, section.courseName);
      section.teachers.forEach((teacher, ti) => {
        checkString(`${base}.teachers[${ti}]`, teacher);
      });
      if (section.place) {
        checkString(`${base}.place`, section.place);
      }
      if (section.unverifiedRaw) {
        for (const [key, value] of Object.entries(section.unverifiedRaw)) {
          checkKey(`${base}.unverifiedRaw.${key}`, key);
          checkString(`${base}.unverifiedRaw.${key}`, value);
        }
      }
    });
  });

  return issues;
}

/** 学号/隐私标签（含「学号: 3230101234」类） */
const PRIVACY_LABEL_RE = /学号\s*[:：]?\s*\d{6,12}/;
/** 独立 8–12 位纯数字（常见学号长度）；不匹配含字母的考试 key */
const PRIVACY_STUDENT_ID_RE = /(?:^|[^\dA-Za-z])(\d{8,12})(?:$|[^\dA-Za-z])/;
const PRIVACY_COOKIE_RE = /(?:^|[;\s])(?:session|sid|token|jwt)=[^;\s]+/i;
const PRIVACY_KEY_RE = /^(cookie|password|passwd|token|authorization|学号|student[_-]?id|xsid)$/i;

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

/** 解析 baseline.v1（仅 Schema；section 引用需配合 catalog 校验） */
export function parseBaselineJson(text: string): BaselineParseResult {
  const json = parseJsonText(text);
  if (!json.ok) {
    return json;
  }
  const parsed = baselineSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToImportIssues(parsed.error) };
  }
  return { ok: true, baseline: parsed.data };
}

/** 解析 pool.v1（仅 Schema；section/课程归属需配合 catalog 校验） */
export function parsePoolJson(text: string): PoolParseResult {
  const json = parseJsonText(text);
  if (!json.ok) {
    return json;
  }
  const parsed = poolSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToImportIssues(parsed.error) };
  }
  return { ok: true, pool: parsed.data };
}

/** baseline 内 sectionId 必须存在于 catalog */
export function validateBaselineSectionRefs(catalog: Catalog, baseline: Baseline): ImportIssue[] {
  const known = collectSectionIds(catalog);
  const issues: ImportIssue[] = [];

  baseline.selected.forEach((sectionId, index) => {
    if (!known.has(sectionId)) {
      issues.push({
        path: `baseline.selected[${index}]`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `未知教学班引用: ${sectionId}`,
      });
    }
  });

  baseline.volunteers.forEach((volunteer, index) => {
    if (!known.has(volunteer.sectionId)) {
      issues.push({
        path: `baseline.volunteers[${index}].sectionId`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `未知教学班引用: ${volunteer.sectionId}`,
      });
    }
  });

  return issues;
}

/**
 * pool 联检：
 * 1) courseCode 必须存在于 catalog；
 * 2) 候选 sectionId 必须存在；
 * 3) 候选 section 必须属于该 courseCode（错挂课程 → UNKNOWN_SECTION_REF）。
 */
export function validatePoolSectionRefs(catalog: Catalog, pool: Pool): ImportIssue[] {
  const sectionToCourse = collectSectionCourseMap(catalog);
  const courseCodes = new Set(catalog.courses.map((course) => course.courseCode));
  const issues: ImportIssue[] = [];

  pool.targets.forEach((target, ti) => {
    if (!courseCodes.has(target.courseCode)) {
      issues.push({
        path: `pool.targets[${ti}].courseCode`,
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        message: `未知课程引用: ${target.courseCode}`,
      });
    }
    target.candidateSectionIds.forEach((sectionId, si) => {
      const owner = sectionToCourse.get(sectionId);
      if (!owner) {
        issues.push({
          path: `pool.targets[${ti}].candidateSectionIds[${si}]`,
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          message: `未知教学班引用: ${sectionId}`,
        });
        return;
      }
      if (owner !== target.courseCode) {
        issues.push({
          path: `pool.targets[${ti}].candidateSectionIds[${si}]`,
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          message: `教学班 ${sectionId} 属于课程 ${owner}，不属于 ${target.courseCode}`,
        });
      }
    });
  });

  return issues;
}

/**
 * 校验 session 内所有 sectionId 均存在于 catalog；
 * pool 额外校验候选班课程归属。
 */
export function validateSessionSectionRefs(catalog: Catalog, session: Session): ImportIssue[] {
  const issues: ImportIssue[] = [];

  for (const issue of validateBaselineSectionRefs(catalog, session.baseline)) {
    issues.push({
      ...issue,
      path: issue.path.startsWith("baseline.")
        ? `session.${issue.path}`
        : `session.baseline.${issue.path}`,
    });
  }

  for (const issue of validatePoolSectionRefs(catalog, session.pool)) {
    issues.push({
      ...issue,
      path: issue.path.startsWith("pool.") ? `session.${issue.path}` : `session.pool.${issue.path}`,
    });
  }

  const known = collectSectionIds(catalog);
  if (session.plan) {
    issues.push(...validatePlanSectionRefs(known, session.plan, "session.plan"));
  }

  session.history.forEach((entry, hi) => {
    for (const issue of validatePoolSectionRefs(catalog, entry.pool)) {
      const relative = issue.path.startsWith("pool.")
        ? issue.path.slice("pool.".length)
        : issue.path;
      issues.push({
        ...issue,
        path: `session.history[${hi}].pool.${relative}`,
      });
    }
    if (entry.plan) {
      issues.push(...validatePlanSectionRefs(known, entry.plan, `session.history[${hi}].plan`));
    }
  });

  return issues;
}

/** catalog + baseline 联检 */
export function parseBaselineWithCatalog(
  catalogJson: string,
  baselineJson: string,
):
  | { ok: true; catalog: Catalog; baseline: Baseline; incompleteSectionIds: string[] }
  | { ok: false; issues: ImportIssue[] } {
  const catalogResult = parseCatalogJson(catalogJson);
  if (!catalogResult.ok) {
    return catalogResult;
  }
  const baselineResult = parseBaselineJson(baselineJson);
  if (!baselineResult.ok) {
    return {
      ok: false,
      issues: baselineResult.issues.map((issue) => ({
        ...issue,
        path: issue.path ? `baseline.${issue.path}` : "baseline",
      })),
    };
  }
  const refIssues = validateBaselineSectionRefs(catalogResult.catalog, baselineResult.baseline);
  if (refIssues.length > 0) {
    return { ok: false, issues: refIssues };
  }
  return {
    ok: true,
    catalog: catalogResult.catalog,
    baseline: baselineResult.baseline,
    incompleteSectionIds: listIncompleteSectionIds(catalogResult.catalog),
  };
}

/** catalog + pool 联检（含课程归属） */
export function parsePoolWithCatalog(
  catalogJson: string,
  poolJson: string,
):
  | { ok: true; catalog: Catalog; pool: Pool; incompleteSectionIds: string[] }
  | { ok: false; issues: ImportIssue[] } {
  const catalogResult = parseCatalogJson(catalogJson);
  if (!catalogResult.ok) {
    return catalogResult;
  }
  const poolResult = parsePoolJson(poolJson);
  if (!poolResult.ok) {
    return {
      ok: false,
      issues: poolResult.issues.map((issue) => ({
        ...issue,
        path: issue.path ? `pool.${issue.path}` : "pool",
      })),
    };
  }
  const refIssues = validatePoolSectionRefs(catalogResult.catalog, poolResult.pool);
  if (refIssues.length > 0) {
    return { ok: false, issues: refIssues };
  }
  return {
    ok: true,
    catalog: catalogResult.catalog,
    pool: poolResult.pool,
    incompleteSectionIds: listIncompleteSectionIds(catalogResult.catalog),
  };
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

/** 解析 session.v1 JSON 文本 */
export function parseSessionJson(
  text: string,
): { ok: true; session: Session } | { ok: false; issues: ImportIssue[] } {
  const json = parseJsonText(text);
  if (!json.ok) {
    return json;
  }
  const parsed = sessionSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToImportIssues(parsed.error) };
  }
  return { ok: true, session: parsed.data };
}

/**
 * 从 session JSON 文本构造 export.v1（可选 catalog 联检）。
 * 供 E 在「导出当前 JSON」时走服务端同一套校验，避免只信客户端拼装。
 */
export function buildExportFromSessionJson(
  sessionJson: string,
  options: { catalogJson?: string; exportedAt?: string } = {},
):
  | { ok: true; envelope: ExportEnvelope; incompleteSectionIds: string[] }
  | { ok: false; issues: ImportIssue[] } {
  const sessionResult = parseSessionJson(sessionJson);
  if (!sessionResult.ok) {
    return sessionResult;
  }

  let incompleteSectionIds: string[] = [];
  if (options.catalogJson) {
    const catalogResult = parseCatalogJson(options.catalogJson);
    if (!catalogResult.ok) {
      return catalogResult;
    }
    const refIssues = validateSessionSectionRefs(catalogResult.catalog, sessionResult.session);
    if (refIssues.length > 0) {
      return { ok: false, issues: refIssues };
    }
    incompleteSectionIds = listIncompleteSectionIds(catalogResult.catalog);
  }

  return {
    ok: true,
    envelope: buildExportEnvelope(sessionResult.session, { exportedAt: options.exportedAt }),
    incompleteSectionIds,
  };
}

function collectSectionIds(catalog: Catalog): Set<string> {
  return new Set(collectSectionCourseMap(catalog).keys());
}

/** sectionId → 所属 courseCode */
function collectSectionCourseMap(catalog: Catalog): Map<string, string> {
  const map = new Map<string, string>();
  for (const course of catalog.courses) {
    for (const section of course.sections) {
      map.set(section.sectionId, course.courseCode);
    }
  }
  return map;
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

export const baselineRequestSchema = z.object({
  baselineJson: z.string().min(1),
  /** 提供则联检 section 引用 */
  catalogJson: z.string().min(1).optional(),
});

export const poolRequestSchema = z.object({
  poolJson: z.string().min(1),
  /** 提供则联检 section 引用与课程归属 */
  catalogJson: z.string().min(1).optional(),
});

export const buildExportRequestSchema = z.object({
  sessionJson: z.string().min(1),
  /** 提供则联检 session 内 section 引用 */
  catalogJson: z.string().min(1).optional(),
  /** 可选固定导出时间（ISO）；缺省为服务端当前时间 */
  exportedAt: z.string().min(1).optional(),
});
