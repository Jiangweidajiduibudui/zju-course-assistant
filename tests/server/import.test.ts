import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExportEnvelope,
  listIncompleteSectionIds,
  parseCatalogExportBundle,
  parseCatalogJson,
  parseExportEnvelopeJson,
  validateSessionSectionRefs,
} from "../../src/server/modules/import/service.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";
import type { Catalog, Session } from "../../src/shared/contracts/index.js";

/** 导入校验器（组员 A；docs/05 §1）：正常 / 非法 JSON / Schema / 重复 / 往返 / 未知引用。 */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

function buildDemoSession(catalog: Catalog, overrides: Partial<Session> = {}): Session {
  const createdAt = "2026-07-09T12:00:00.000+08:00";
  return {
    schemaVersion: "session.v1",
    id: "demo-session-roundtrip",
    name: "合成 Demo session",
    createdAt,
    baseline: {
      schemaVersion: "baseline.v1",
      selected: [],
      volunteers: [],
      importedAt: createdAt,
    },
    pool: {
      schemaVersion: "pool.v1",
      targets: catalog.courses.map((course) => ({
        courseCode: course.courseCode,
        candidateSectionIds: course.sections.map((section) => section.sectionId),
      })),
    },
    rules: {
      schemaVersion: "rules.v1",
      creditLimit: null,
      bars: [],
    },
    plan: null,
    history: [],
    ...overrides,
  };
}

describe("parseCatalogJson", () => {
  it("合成 demo catalog 解析成功", () => {
    const result = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.synthetic).toBe(true);
      expect(result.catalog.courses.length).toBeGreaterThan(0);
    }
  });

  it("非法 JSON → IMPORT_INVALID_JSON", () => {
    const result = parseCatalogJson("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe(ErrorCodes.IMPORT_INVALID_JSON);
    }
  });

  it("Schema 违规（teachers 为空）→ IMPORT_SCHEMA_MISMATCH，含路径定位", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-schema-mismatch.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_SCHEMA_MISMATCH)).toBe(true);
      expect(result.issues.some((i) => i.path.includes("teachers"))).toBe(true);
    }
  });

  it("缺少 schemaVersion → IMPORT_SCHEMA_MISMATCH", () => {
    const result = parseCatalogJson(
      readFixture("invalid-cases", "catalog-missing-schema-version.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_SCHEMA_MISMATCH)).toBe(true);
      expect(result.issues.some((i) => i.path.includes("schemaVersion"))).toBe(true);
    }
  });

  it("空 courses 数组当前 Schema 允许解析成功", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-empty-courses.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.courses).toEqual([]);
    }
  });

  it("重复 sectionId → IMPORT_DUPLICATE_SECTION", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-duplicate-section.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_DUPLICATE_SECTION)).toBe(true);
    }
  });

  it("credits/examTime 缺失不误杀，并列入 incompleteSectionIds", () => {
    const result = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const incomplete = listIncompleteSectionIds(result.catalog);
    expect(incomplete).toContain("SYN201-02"); // examTime null
    expect(incomplete).toContain("SYN301-01"); // credits null
  });
});

describe("export envelope + section refs", () => {
  it("合法 export.v1 解析成功", () => {
    const catalogResult = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) {
      return;
    }
    const session = buildDemoSession(catalogResult.catalog);
    const envelope = buildExportEnvelope(session, {
      exportedAt: "2026-07-09T12:30:00.000+08:00",
    });
    const parsed = parseExportEnvelopeJson(JSON.stringify(envelope));
    expect(parsed.ok).toBe(true);
  });

  it("未知 section 引用 → IMPORT_UNKNOWN_SECTION_REF + 路径", () => {
    const catalogResult = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) {
      return;
    }
    const exportResult = parseExportEnvelopeJson(
      readFixture("invalid-cases", "export-unknown-section-ref.json"),
    );
    expect(exportResult.ok).toBe(true);
    if (!exportResult.ok) {
      return;
    }
    const issues = validateSessionSectionRefs(catalogResult.catalog, exportResult.envelope.session);
    expect(issues.some((i) => i.code === ErrorCodes.IMPORT_UNKNOWN_SECTION_REF)).toBe(true);
    expect(issues.some((i) => i.path.includes("candidateSectionIds"))).toBe(true);
    expect(issues.some((i) => i.message.includes("DOES-NOT-EXIST"))).toBe(true);
  });
});

describe("Task 2 门禁：导入→修改→导出→再导入", () => {
  it("往返后关键字段一致", () => {
    const catalogJson = readFixture("demo-catalog.synthetic.json");
    const catalogResult = parseCatalogJson(catalogJson);
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) {
      return;
    }

    // 模拟用户修改：改一门课名
    const modified: Catalog = {
      ...catalogResult.catalog,
      courses: catalogResult.catalog.courses.map((course, index) =>
        index === 0 ? { ...course, courseName: "合成微积分演示（已改名）" } : course,
      ),
    };

    const session = buildDemoSession(modified, { name: "往返测试 session" });
    const envelope = buildExportEnvelope(session, {
      exportedAt: "2026-07-09T13:00:00.000+08:00",
    });

    const bundle = parseCatalogExportBundle(JSON.stringify(modified), JSON.stringify(envelope));
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) {
      return;
    }

    expect(bundle.catalog.courses[0]?.courseName).toBe("合成微积分演示（已改名）");
    expect(bundle.envelope.session.name).toBe("往返测试 session");
    expect(bundle.envelope.session.pool.targets.map((t) => t.courseCode).sort()).toEqual(
      modified.courses.map((c) => c.courseCode).sort(),
    );
    expect(bundle.incompleteSectionIds).toEqual(listIncompleteSectionIds(modified));

    // 再导出一次，session 主体应稳定（忽略 exportedAt）
    const again = buildExportEnvelope(bundle.envelope.session, {
      exportedAt: "2026-07-09T14:00:00.000+08:00",
    });
    expect(again.session).toEqual(bundle.envelope.session);
  });

  it("bundle 联检拒绝未知 section 引用", () => {
    const catalogJson = readFixture("demo-catalog.synthetic.json");
    const exportJson = readFixture("invalid-cases", "export-unknown-section-ref.json");
    const bundle = parseCatalogExportBundle(catalogJson, exportJson);
    expect(bundle.ok).toBe(false);
    if (!bundle.ok) {
      expect(bundle.issues.some((i) => i.code === ErrorCodes.IMPORT_UNKNOWN_SECTION_REF)).toBe(
        true,
      );
    }
  });
});
