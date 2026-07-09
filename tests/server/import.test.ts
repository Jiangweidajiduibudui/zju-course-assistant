import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import {
  buildExportEnvelope,
  listIncompleteSectionIds,
  parseBaselineWithCatalog,
  parseCatalogExportBundle,
  parseCatalogJson,
  parseExportEnvelopeJson,
  parsePoolWithCatalog,
  validateSessionSectionRefs,
} from "../../src/server/modules/import/service.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";
import type { Catalog, Session } from "../../src/shared/contracts/index.js";

/** 导入校验器（组员 A；docs/05 §1）：catalog / export / baseline / pool / 往返。 */
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

  it("嵌套 export Schema 错误定位到 session.pool", () => {
    const result = parseExportEnvelopeJson(
      readFixture("invalid-cases", "export-nested-schema-mismatch.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        code: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
        path: "session.pool.targets.0.candidateSectionIds",
      });
    }
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

describe("baseline / pool 独立校验", () => {
  it("合法 baseline + catalog 联检通过", () => {
    const catalogJson = readFixture("demo-catalog.synthetic.json");
    const baselineJson = JSON.stringify({
      schemaVersion: "baseline.v1",
      selected: ["SYN101-01"],
      volunteers: [{ sectionId: "SYN201-01", rank: 1 }],
      importedAt: "2026-07-09T12:00:00.000+08:00",
    });
    const result = parseBaselineWithCatalog(catalogJson, baselineJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.baseline.selected).toEqual(["SYN101-01"]);
      expect(result.incompleteSectionIds).toContain("SYN301-01");
    }
  });

  it("baseline 未知 section → IMPORT_UNKNOWN_SECTION_REF", () => {
    const result = parseBaselineWithCatalog(
      readFixture("demo-catalog.synthetic.json"),
      readFixture("invalid-cases", "baseline-unknown-section.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_UNKNOWN_SECTION_REF)).toBe(
        true,
      );
      expect(result.issues.some((i) => i.path.includes("baseline.selected"))).toBe(true);
    }
  });

  it("合法 pool + catalog 联检通过", () => {
    const catalogJson = readFixture("demo-catalog.synthetic.json");
    const poolJson = JSON.stringify({
      schemaVersion: "pool.v1",
      targets: [
        {
          courseCode: "SYN101",
          candidateSectionIds: ["SYN101-01", "SYN101-02"],
        },
      ],
    });
    const result = parsePoolWithCatalog(catalogJson, poolJson);
    expect(result.ok).toBe(true);
  });

  it("候选班挂错课程 → IMPORT_UNKNOWN_SECTION_REF", () => {
    const result = parsePoolWithCatalog(
      readFixture("demo-catalog.synthetic.json"),
      readFixture("invalid-cases", "pool-section-wrong-course.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_UNKNOWN_SECTION_REF)).toBe(
        true,
      );
      expect(result.issues.some((i) => i.message.includes("不属于 SYN101"))).toBe(true);
    }
  });

  it("未知 courseCode → IMPORT_UNKNOWN_SECTION_REF", () => {
    const result = parsePoolWithCatalog(
      readFixture("demo-catalog.synthetic.json"),
      readFixture("invalid-cases", "pool-unknown-course.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path.includes("courseCode"))).toBe(true);
      expect(result.issues.some((i) => i.message.includes("NO-SUCH-COURSE"))).toBe(true);
    }
  });

  it("未知候选 sectionId → IMPORT_UNKNOWN_SECTION_REF", () => {
    const result = parsePoolWithCatalog(
      readFixture("demo-catalog.synthetic.json"),
      readFixture("invalid-cases", "pool-unknown-section.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          path: "pool.targets[0].candidateSectionIds[0]",
        }),
      );
      expect(result.issues.some((i) => i.message.includes("SYN999-01"))).toBe(true);
    }
  });

  it("session 联检也会拒绝挂错课程的 pool", () => {
    const catalogResult = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) {
      return;
    }
    const session = buildDemoSession(catalogResult.catalog, {
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "SYN101", candidateSectionIds: ["SYN201-01"] }],
      },
    });
    const issues = validateSessionSectionRefs(catalogResult.catalog, session);
    expect(issues.some((i) => i.path.startsWith("session.pool."))).toBe(true);
    expect(issues.some((i) => i.message.includes("不属于 SYN101"))).toBe(true);
  });
});

describe("导入 API 路由", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: "test" }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("catalog API 返回规范化数据和摘要", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: { catalogJson: readFixture("demo-catalog.synthetic.json") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      synthetic: true,
      courseCount: 3,
      sectionCount: 5,
      catalog: { schemaVersion: "catalog.v1" },
    });
  });

  it("pool API 返回精确引用错误和对应顶层错误码", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/pool",
      payload: {
        catalogJson: readFixture("demo-catalog.synthetic.json"),
        poolJson: readFixture("invalid-cases", "pool-unknown-section.json"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
      details: [
        {
          code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
          path: "pool.targets[0].candidateSectionIds[0]",
        },
      ],
    });
  });

  it("bundle API 跑通导入 → 修改 → 导出 → 再导入主路径", async () => {
    const catalogResult = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) {
      return;
    }
    const session = buildDemoSession(catalogResult.catalog, { name: "API 往返测试 session" });
    const envelope = buildExportEnvelope(session, {
      exportedAt: "2026-07-09T13:00:00.000+08:00",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/import/bundle",
      payload: {
        catalogJson: readFixture("demo-catalog.synthetic.json"),
        exportJson: JSON.stringify(envelope),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      envelope: { session: { name: "API 往返测试 session" } },
    });
  });
});
