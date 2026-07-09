import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

/**
 * import 路由 HTTP 契约（组员 A；docs/08 §11 Server 层）。
 * 用 Fastify inject，不启真实端口；覆盖成功 / 422 / 400。
 */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

describe("POST /api/import/*", () => {
  let app: FastifyInstance;
  const demoCatalogJson = readFixture("demo-catalog.synthetic.json");

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: "test" }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /catalog 成功返回规范化摘要与 incompleteSectionIds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: { catalogJson: demoCatalogJson },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.synthetic).toBe(true);
    expect(body.courseCount).toBeGreaterThan(0);
    expect(body.sectionCount).toBeGreaterThan(0);
    expect(body.incompleteSectionIds).toContain("SYN301-01");
    expect(body.catalog.schemaVersion).toBe("catalog.v1");
  });

  it("POST /catalog 非法 JSON → 422 IMPORT_INVALID_JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: { catalogJson: "{ not json" },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.errorCode).toBe(ErrorCodes.IMPORT_INVALID_JSON);
    expect(body.details[0].code).toBe(ErrorCodes.IMPORT_INVALID_JSON);
  });

  it("POST /catalog 缺字段 → 400 COMMON_VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe(ErrorCodes.COMMON_VALIDATION_FAILED);
  });

  it("POST /catalog 隐私疑似 → 422 IMPORT_PRIVACY_SUSPECT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: {
        catalogJson: readFixture("invalid-cases", "catalog-privacy-student-id.json"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errorCode).toBe(ErrorCodes.IMPORT_PRIVACY_SUSPECT);
  });

  it("POST /bundle 往返成功", async () => {
    const catalogRes = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: { catalogJson: demoCatalogJson },
    });
    expect(catalogRes.statusCode).toBe(200);
    const catalog = catalogRes.json().catalog;

    const exportJson = JSON.stringify({
      schemaVersion: "export.v1",
      exportedAt: "2026-07-09T13:00:00.000+08:00",
      session: {
        schemaVersion: "session.v1",
        id: "http-roundtrip",
        name: "HTTP 往返",
        createdAt: "2026-07-09T12:00:00.000+08:00",
        baseline: {
          schemaVersion: "baseline.v1",
          selected: [],
          volunteers: [],
          importedAt: "2026-07-09T12:00:00.000+08:00",
        },
        pool: {
          schemaVersion: "pool.v1",
          targets: catalog.courses.map(
            (course: { courseCode: string; sections: { sectionId: string }[] }) => ({
              courseCode: course.courseCode,
              candidateSectionIds: course.sections.map(
                (section: { sectionId: string }) => section.sectionId,
              ),
            }),
          ),
        },
        rules: { schemaVersion: "rules.v1", creditLimit: null, bars: [] },
        plan: null,
        history: [],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/import/bundle",
      payload: {
        catalogJson: JSON.stringify(catalog),
        exportJson,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.envelope.session.id).toBe("http-roundtrip");
  });

  it("POST /bundle 未知 section → 422 IMPORT_UNKNOWN_SECTION_REF", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/bundle",
      payload: {
        catalogJson: demoCatalogJson,
        exportJson: readFixture("invalid-cases", "export-unknown-section-ref.json"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errorCode).toBe(ErrorCodes.IMPORT_UNKNOWN_SECTION_REF);
  });

  it("POST /baseline 联检成功", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/baseline",
      payload: {
        catalogJson: demoCatalogJson,
        baselineJson: JSON.stringify({
          schemaVersion: "baseline.v1",
          selected: ["SYN101-01"],
          volunteers: [],
          importedAt: "2026-07-09T12:00:00.000+08:00",
        }),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().baseline.selected).toEqual(["SYN101-01"]);
  });

  it("POST /baseline 未知 section → 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/baseline",
      payload: {
        catalogJson: demoCatalogJson,
        baselineJson: readFixture("invalid-cases", "baseline-unknown-section.json"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errorCode).toBe(ErrorCodes.IMPORT_UNKNOWN_SECTION_REF);
  });

  it("POST /pool 挂错课程 → 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/pool",
      payload: {
        catalogJson: demoCatalogJson,
        poolJson: readFixture("invalid-cases", "pool-section-wrong-course.json"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errorCode).toBe(ErrorCodes.IMPORT_UNKNOWN_SECTION_REF);
  });

  it("POST /export-envelope 仅 Schema 成功（无 catalog 联检）", async () => {
    const exportJson = JSON.stringify({
      schemaVersion: "export.v1",
      exportedAt: "2026-07-09T13:00:00.000+08:00",
      session: {
        schemaVersion: "session.v1",
        id: "export-only",
        name: "仅信封",
        createdAt: "2026-07-09T12:00:00.000+08:00",
        baseline: {
          schemaVersion: "baseline.v1",
          selected: [],
          volunteers: [],
          importedAt: "2026-07-09T12:00:00.000+08:00",
        },
        pool: { schemaVersion: "pool.v1", targets: [] },
        rules: { schemaVersion: "rules.v1", creditLimit: null, bars: [] },
        plan: null,
        history: [],
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/import/export-envelope",
      payload: { exportJson },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessionId).toBe("export-only");
  });

  it("POST /build-export 由 session 构造 export.v1", async () => {
    const catalogRes = await app.inject({
      method: "POST",
      url: "/api/import/catalog",
      payload: { catalogJson: demoCatalogJson },
    });
    expect(catalogRes.statusCode).toBe(200);
    const catalog = catalogRes.json().catalog;
    const sessionJson = JSON.stringify({
      schemaVersion: "session.v1",
      id: "build-export-http",
      name: "HTTP 构造导出",
      createdAt: "2026-07-09T12:00:00.000+08:00",
      baseline: {
        schemaVersion: "baseline.v1",
        selected: [],
        volunteers: [],
        importedAt: "2026-07-09T12:00:00.000+08:00",
      },
      pool: {
        schemaVersion: "pool.v1",
        targets: catalog.courses.map(
          (course: { courseCode: string; sections: { sectionId: string }[] }) => ({
            courseCode: course.courseCode,
            candidateSectionIds: course.sections.map(
              (section: { sectionId: string }) => section.sectionId,
            ),
          }),
        ),
      },
      rules: { schemaVersion: "rules.v1", creditLimit: null, bars: [] },
      plan: null,
      history: [],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/import/build-export",
      payload: {
        sessionJson,
        catalogJson: JSON.stringify(catalog),
        exportedAt: "2026-07-09T16:00:00.000+08:00",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.envelope.schemaVersion).toBe("export.v1");
    expect(body.envelope.session.id).toBe("build-export-http");
    expect(body.exportJson).toContain("build-export-http");
    expect(body.incompleteSectionIds).toContain("SYN301-01");
  });

  it("POST /build-export 缺 sessionJson → 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/import/build-export",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe(ErrorCodes.COMMON_VALIDATION_FAILED);
  });
});
