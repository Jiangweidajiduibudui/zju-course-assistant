import { describe, expect, it } from "vitest";
import { projectTimetable } from "../../src/domain/selection-model/projection.js";
import type { SolverInput } from "../../src/domain/selection-model/types.js";
import type {
  Baseline,
  CandidatePlan,
  Pool,
  Rules,
  Section,
} from "../../src/shared/contracts/index.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

/** projectTimetable 单元测试（组员 C，Task 1） */

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

function makePlan(overrides: Partial<CandidatePlan> = {}): CandidatePlan {
  return {
    planId: "plan-1",
    volunteers: [],
    groups: [],
    totalCredits: 0,
    ...overrides,
  };
}

describe("projectTimetable — 基础投影", () => {
  it("单个 volunteer 投影到对应 time slot", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        slots: [
          { term: "autumn", dayOfWeek: 1, period: 1 },
          { term: "autumn", dayOfWeek: 1, period: 2 },
        ],
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({ sections: sectionMap });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
      ],
    });
    const projection = projectTimetable(input, plan);

    expect(projection.schemaVersion).toBe("projection.v1");
    expect(projection.planId).toBe("plan-1");
    expect(projection.cells).toHaveLength(2);
    expect(projection.cells.map((c) => c.primarySectionId)).toContain("S001");
  });

  it("多个 volunteer 不重叠 → 各自成为 primary", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
      makeSection({
        sectionId: "S002",
        courseCode: "C002",
        slots: [{ term: "autumn", dayOfWeek: 2, period: 3 }],
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({ sections: sectionMap });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
    });
    const projection = projectTimetable(input, plan);

    expect(projection.cells).toHaveLength(2);
    const primaries = projection.cells.map((c) => c.primarySectionId);
    expect(primaries).toContain("S001");
    expect(primaries).toContain("S002");
  });

  it("两个 volunteer 同一 time slot → primary + stacked + classTimeOverlap flag", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
      makeSection({
        sectionId: "S002",
        courseCode: "C002",
        slots: [{ term: "autumn", dayOfWeek: 1, period: 1 }],
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          { courseCode: "C001", candidateSectionIds: ["S001"] },
          { courseCode: "C002", candidateSectionIds: ["S002"] },
        ],
      },
    });
    // rank 1 is higher priority → becomes primary
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 2, groupId: "g2", locked: false },
      ],
    });
    const projection = projectTimetable(input, plan);

    // only one cell since both share the same slot
    expect(projection.cells).toHaveLength(1);
    const cell = projection.cells[0]!;
    expect(cell.primarySectionId).toBe("S001"); // rank 1 wins
    expect(cell.stackedSectionIds).toContain("S002");
    expect(cell.flags).toContain("classTimeOverlap");
  });
});

describe("projectTimetable — 缺失硬字段排除", () => {
  it("考试时间缺失 → excluded + MODEL_MISSING_EXAM_TIME", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        examTime: null,
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({ sections: sectionMap });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
      ],
    });
    const projection = projectTimetable(input, plan);

    expect(projection.cells).toHaveLength(0);
    expect(projection.excluded).toHaveLength(1);
    expect(projection.excluded[0]!.sectionId).toBe("S001");
    expect(projection.excluded[0]!.reasonCode).toBe(ErrorCodes.MODEL_MISSING_EXAM_TIME);
  });

  it("学分缺失 → excluded + MODEL_MISSING_CREDIT", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        credits: null,
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({ sections: sectionMap });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
      ],
    });
    const projection = projectTimetable(input, plan);

    expect(projection.excluded).toHaveLength(1);
    expect(projection.excluded[0]!.sectionId).toBe("S001");
    expect(projection.excluded[0]!.reasonCode).toBe(ErrorCodes.MODEL_MISSING_CREDIT);
  });

  it("考试和学分都缺失 → 两条 excluded 记录", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        examTime: null,
        credits: null,
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({ sections: sectionMap });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
      ],
    });
    const projection = projectTimetable(input, plan);
    expect(projection.excluded).toHaveLength(2);
  });
});

describe("projectTimetable — 空 plan", () => {
  it("空 plan → 返回空 cells", () => {
    const projection = projectTimetable(makeSolverInput(), makePlan());
    expect(projection.cells).toHaveLength(0);
    expect(projection.excluded).toHaveLength(0);
  });
});
