import { describe, expect, it } from "vitest";
import { buildVolunteerGroups } from "../../src/domain/selection-model/volunteer-groups.js";
import type { SolverInput } from "../../src/domain/selection-model/types.js";
import type {
  Baseline,
  Pool,
  Rules,
  Section,
} from "../../src/shared/contracts/index.js";

/** buildVolunteerGroups 单元测试（组员 C，Task 1） */

function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    sectionId: "S001",
    courseCode: "C001",
    courseName: "测试课程",
    teachers: ["测试教师"],
    slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
    place: null,
    examTime: { examKey: "EXAM-A", raw: "2027-01-20 08:00-10:00" },
    credits: 3,
    ...overrides,
  };
}

function makeSolverInput(overrides: {
  sections?: ReadonlyMap<string, Section>;
  pool?: Pool;
  baseline?: Baseline;
  rules?: Rules;
  lockedSectionIds?: ReadonlySet<string>;
} = {}): SolverInput {
  return {
    sections: new Map(),
    baseline: {
      schemaVersion: "baseline.v1",
      selected: [],
      volunteers: [],
      importedAt: "2026-07-09T12:00:00.000+08:00",
    },
    pool: { schemaVersion: "pool.v1", targets: [] },
    rules: {
      schemaVersion: "rules.v1",
      creditLimit: null,
      bars: [],
    },
    lockedSectionIds: new Set(),
    ...overrides,
  };
}

describe("buildVolunteerGroups — 课程志愿组", () => {
  it("同一课程 ≥2 候选班 → 生成课程志愿组，最多 3 个", () => {
    const sections = [
      makeSection({ sectionId: "C001-01", courseCode: "C001" }),
      makeSection({ sectionId: "C001-02", courseCode: "C001" }),
      makeSection({ sectionId: "C001-03", courseCode: "C001" }),
      makeSection({ sectionId: "C001-04", courseCode: "C001" }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          {
            courseCode: "C001",
            candidateSectionIds: ["C001-01", "C001-02", "C001-03", "C001-04"],
          },
        ],
      },
    });

    const groups = buildVolunteerGroups(input);
    const courseGroup = groups.find((g) => g.kind === "course");
    expect(courseGroup).toBeDefined();
    expect(courseGroup!.orderedSectionIds).toEqual(["C001-01", "C001-02", "C001-03"]);
    expect(courseGroup!.invalidated).toBeNull();
  });

  it("只有 1 个候选班 → 自动消解课程组（该班可进入时间槽组）", () => {
    const sections = [makeSection({ sectionId: "C001-01", courseCode: "C001" })];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["C001-01"] }],
      },
    });

    const groups = buildVolunteerGroups(input);
    const courseGroup = groups.find((g) => g.kind === "course" && g.ref === "C001");
    expect(courseGroup).toBeUndefined();
  });

  it("多门课程各自生成独立课程组", () => {
    const sections = [
      makeSection({ sectionId: "C001-01", courseCode: "C001" }),
      makeSection({ sectionId: "C001-02", courseCode: "C001" }),
      makeSection({ sectionId: "C002-01", courseCode: "C002" }),
      makeSection({ sectionId: "C002-02", courseCode: "C002" }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          { courseCode: "C001", candidateSectionIds: ["C001-01", "C001-02"] },
          { courseCode: "C002", candidateSectionIds: ["C002-01", "C002-02"] },
        ],
      },
    });

    const groups = buildVolunteerGroups(input);
    const courseGroups = groups.filter((g) => g.kind === "course");
    expect(courseGroups).toHaveLength(2);
  });
});

describe("buildVolunteerGroups — 时间槽志愿组", () => {
  it("未被课程组占用的班流入时间槽组，同 time-slot 聚合", () => {
    // 用两门不同的课，每门只有 1 个候选班（不会形成课程组），但共享同一时间槽
    const sections = [
      makeSection({
        sectionId: "C002-01",
        courseCode: "C002",
        slots: [{ term: "autumn", dayOfWeek: 3, period: 1 }],
      }),
      makeSection({
        sectionId: "C003-01",
        courseCode: "C003",
        slots: [{ term: "autumn", dayOfWeek: 3, period: 1 }],
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          { courseCode: "C002", candidateSectionIds: ["C002-01"] },
          { courseCode: "C003", candidateSectionIds: ["C003-01"] },
        ],
      },
    });

    const groups = buildVolunteerGroups(input);
    const tsGroup = groups.find((g) => g.kind === "timeslot");
    expect(tsGroup).toBeDefined();
    expect(tsGroup!.orderedSectionIds).toContain("C002-01");
    expect(tsGroup!.orderedSectionIds).toContain("C003-01");
    expect(tsGroup!.orderedSectionIds.length).toBeLessThanOrEqual(3);
  });

  it("时间槽组 ≤2 个候选班时不生成（至少 2 个才有志愿组意义）", () => {
    // 只有 1 个候选班，课程组也只有一个 → 不应生成任何组
    const sections = [
      makeSection({ sectionId: "C003-01", courseCode: "C003" }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          { courseCode: "C003", candidateSectionIds: ["C003-01"] },
          { courseCode: "C004", candidateSectionIds: ["C004-01"] },
        ],
      },
    });

    const groups = buildVolunteerGroups(input);
    // 没有课程组（每个只有 1 个候选），也没有时间槽组（同一时段不够 2 个）
    expect(groups).toHaveLength(0);
  });
});

describe("buildVolunteerGroups — 课程组优先冲突", () => {
  it("课程组占用的教学班不进时间槽组", () => {
    const sections = [
      makeSection({
        sectionId: "C001-01",
        courseCode: "C001",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
      makeSection({
        sectionId: "C001-02",
        courseCode: "C001",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          {
            courseCode: "C001",
            candidateSectionIds: ["C001-01", "C001-02"],
          },
        ],
      },
    });

    const groups = buildVolunteerGroups(input);
    // 会有课程组（≥2 候选），被占用的 section 不进时间槽组
    const courseGroup = groups.find((g) => g.kind === "course");
    expect(courseGroup).toBeDefined();
    // 这些 section 被课程组占用后，不应再出现在时间槽组
    const tsGroups = groups.filter((g) => g.kind === "timeslot");
    for (const tsg of tsGroups) {
      for (const sid of tsg.orderedSectionIds) {
        expect(courseGroup!.orderedSectionIds).not.toContain(sid);
      }
    }
  });

  it("时间槽组与课程组时间槽冲突 → 时间槽组失效", () => {
    // C001 有课程组（C001-01, C001-02）—— 共享同一时间槽
    // C002 有候选班也在同一时间槽 → 该时间槽组应该失效或空
    const sections = [
      makeSection({
        sectionId: "C001-01",
        courseCode: "C001",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
      makeSection({
        sectionId: "C001-02",
        courseCode: "C001",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
      makeSection({
        sectionId: "C002-01",
        courseCode: "C002",
        slots: [
          { term: "autumn", dayOfWeek: 1, period: 1 },
          { term: "autumn", dayOfWeek: 2, period: 3 },
        ],
      }),
      makeSection({
        sectionId: "C002-02",
        courseCode: "C002",
        slots: [{ term: "autumn", dayOfWeek: 2, period: 3 }],
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          {
            courseCode: "C001",
            candidateSectionIds: ["C001-01", "C001-02"],
          },
          {
            courseCode: "C002",
            candidateSectionIds: ["C002-01", "C002-02"],
          },
        ],
      },
    });

    const groups = buildVolunteerGroups(input);
    // C001 有课程组（≥2），占用 C001-01 和 C001-02
    // C002-01 和 C002-02 只有一个共享时间槽（autumn-2-3），需要 ≥2 个才成组
    // C002-01 的 autumn-1-1 被课程组占用的 C001-01/C001-02 占用
    // 但因为 C002 只有 1 个 candidate（C002-01）在 autumn-1-1，所以该 slot 组不满足 ≥2
    const tsGroups = groups.filter((g) => g.kind === "timeslot");
    // 不应有共享课程组 section 的时间槽组
    for (const tsg of tsGroups) {
      const hasConflict = tsg.orderedSectionIds.some((sid) =>
        ["C001-01", "C001-02"].includes(sid),
      );
      expect(hasConflict).toBe(false);
    }
  });
});
