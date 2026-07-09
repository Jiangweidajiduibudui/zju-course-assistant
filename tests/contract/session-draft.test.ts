import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSessionDraft } from "../../src/client/features/import-export/sessionDraft.js";
import { catalogSchema, sessionSchema } from "../../src/shared/contracts/index.js";

const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function getDemoCatalog() {
  return catalogSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, "demo-catalog.synthetic.json"), "utf8")),
  );
}

describe("Demo session 草稿", () => {
  it("从合成 catalog 创建可校验的 session.v1 草稿", () => {
    const catalog = getDemoCatalog();
    const session = buildDemoSessionDraft(catalog, {
      id: "session-demo-test",
      name: "合成 Demo session",
      now: "2026-07-09T15:00:00.000+08:00",
    });

    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session).toMatchObject({
      schemaVersion: "session.v1",
      id: "session-demo-test",
      name: "合成 Demo session",
      createdAt: "2026-07-09T15:00:00.000+08:00",
      baseline: {
        schemaVersion: "baseline.v1",
        selected: [],
        volunteers: [],
        importedAt: "2026-07-09T15:00:00.000+08:00",
      },
      rules: {
        schemaVersion: "rules.v1",
        creditLimit: null,
        bars: [],
      },
      plan: null,
      history: [],
    });
  });

  it("待选池覆盖全部课程和候选教学班，包括考试/学分缺失项", () => {
    const catalog = getDemoCatalog();
    const session = buildDemoSessionDraft(catalog, {
      id: "session-demo-test",
      name: "合成 Demo session",
      now: "2026-07-09T15:00:00.000+08:00",
    });

    expect(session.pool).toEqual({
      schemaVersion: "pool.v1",
      targets: [
        { courseCode: "SYN101", candidateSectionIds: ["SYN101-01", "SYN101-02"] },
        { courseCode: "SYN201", candidateSectionIds: ["SYN201-01", "SYN201-02"] },
        { courseCode: "SYN301", candidateSectionIds: ["SYN301-01"] },
      ],
    });
    expect(session.pool.targets).toHaveLength(catalog.courses.length);
    expect(session.pool.targets.flatMap((target) => target.candidateSectionIds)).toEqual([
      "SYN101-01",
      "SYN101-02",
      "SYN201-01",
      "SYN201-02",
      "SYN301-01",
    ]);
  });
});
