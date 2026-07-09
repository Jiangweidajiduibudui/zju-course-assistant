import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import {
  parseCatalogJson,
  parseExportJson,
  parsePoolJson,
  serializeExportEnvelope,
} from "../../src/server/modules/import/service.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";
import type { ExportEnvelope } from "../../src/shared/contracts/session.js";

const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

function readCatalog() {
  const result = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
  if (!result.ok) {
    throw new Error("合成 catalog fixture 应当有效");
  }
  return result.catalog;
}

function makeEnvelope(): ExportEnvelope {
  return {
    schemaVersion: "export.v1",
    exportedAt: "2026-07-09T13:00:00.000+08:00",
    session: {
      schemaVersion: "session.v1",
      id: "synthetic-session",
      name: "合成往返测试",
      createdAt: "2026-07-09T12:30:00.000+08:00",
      baseline: {
        schemaVersion: "baseline.v1",
        selected: [],
        volunteers: [],
        importedAt: "2026-07-09T12:30:00.000+08:00",
      },
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "SYN101", candidateSectionIds: ["SYN101-01"] }],
      },
      rules: { schemaVersion: "rules.v1", creditLimit: 24, bars: [] },
      plan: null,
      history: [],
    },
  };
}

describe("导入与导出服务", () => {
  it("合成 demo catalog 解析成功", () => {
    const result = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(result.ok).toBe(true);
  });

  it("非法 JSON → IMPORT_INVALID_JSON，根路径为空", () => {
    const result = parseCatalogJson("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        code: ErrorCodes.IMPORT_INVALID_JSON,
        path: "",
      });
    }
  });

  it("Schema 违规含 JavaScript 风格精确路径", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-schema-mismatch.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: ErrorCodes.IMPORT_SCHEMA_MISMATCH,
          path: "courses[0].sections[0].teachers",
        }),
      );
    }
  });

  it("重复 sectionId → IMPORT_DUPLICATE_SECTION 和精确路径", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-duplicate-section.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: ErrorCodes.IMPORT_DUPLICATE_SECTION,
          path: "courses[0].sections[1].sectionId",
        }),
      );
    }
  });

  it("课程池接受考试时间或学分缺失的教学班", () => {
    const poolJson = JSON.stringify({
      schemaVersion: "pool.v1",
      targets: [
        { courseCode: "SYN201", candidateSectionIds: ["SYN201-02"] },
        { courseCode: "SYN301", candidateSectionIds: ["SYN301-01"] },
      ],
    });
    const result = parsePoolJson(poolJson, readCatalog());
    expect(result).toEqual({
      ok: true,
      data: JSON.parse(poolJson),
    });
  });

  it("课程池未知教学班返回候选项精确路径", () => {
    const result = parsePoolJson(
      readFixture("invalid-cases", "pool-unknown-section.json"),
      readCatalog(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        code: ErrorCodes.IMPORT_UNKNOWN_SECTION_REF,
        path: "targets[0].candidateSectionIds[0]",
      });
    }
  });

  it("课程池拒绝归属其他课程的教学班", () => {
    const result = parsePoolJson(
      JSON.stringify({
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "SYN101", candidateSectionIds: ["SYN201-01"] }],
      }),
      readCatalog(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("targets[0].candidateSectionIds[0]");
    }
  });

  it("嵌套 export Schema 错误定位到 session.pool", () => {
    const result = parseExportJson(
      readFixture("invalid-cases", "export-nested-schema-mismatch.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("session.pool.targets[0].candidateSectionIds");
    }
  });

  it("导出使用两空格缩进、尾随换行且结果确定", () => {
    const envelope = makeEnvelope();
    const first = serializeExportEnvelope(envelope, readCatalog());
    const second = serializeExportEnvelope(envelope, readCatalog());
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data).toContain('\n  "schemaVersion": "export.v1"');
      expect(first.data.endsWith("\n")).toBe(true);
    }
  });

  it("导入 → 修改 → 导出 → 再导入语义一致", () => {
    const initial = makeEnvelope();
    const imported = parseExportJson(JSON.stringify(initial), readCatalog());
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }
    const modified: ExportEnvelope = {
      ...imported.data,
      session: {
        ...imported.data.session,
        pool: {
          schemaVersion: "pool.v1",
          targets: [
            {
              courseCode: "SYN201",
              candidateSectionIds: ["SYN201-01", "SYN201-02"],
            },
          ],
        },
      },
    };
    const exported = serializeExportEnvelope(modified, readCatalog());
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const reimported = parseExportJson(exported.data, readCatalog());
    expect(reimported).toEqual({ ok: true, data: modified });
  });
});

describe("导入与导出 API", () => {
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
          path: "targets[0].candidateSectionIds[0]",
        },
      ],
    });
  });

  it("export API 输出可由 import API 原样重新导入", async () => {
    const exportResponse = await app.inject({
      method: "POST",
      url: "/api/import/export",
      payload: {
        envelope: makeEnvelope(),
        catalogJson: readFixture("demo-catalog.synthetic.json"),
      },
    });
    expect(exportResponse.statusCode).toBe(200);
    const exportJson = exportResponse.json().exportJson as string;
    const importResponse = await app.inject({
      method: "POST",
      url: "/api/import/export/import",
      payload: {
        exportJson,
        catalogJson: readFixture("demo-catalog.synthetic.json"),
      },
    });
    expect(importResponse.statusCode).toBe(200);
    expect(importResponse.json().envelope).toEqual(makeEnvelope());
  });
});
