import { describe, expect, it } from "vitest";
import { finalValidate } from "../../src/domain/selection-model/validate.js";
import type { SolverInput } from "../../src/domain/selection-model/types.js";
import type {
  Baseline,
  CandidatePlan,
  Pool,
  Rules,
  Section,
} from "../../src/shared/contracts/index.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

/** finalValidate 单元测试（组员 C，Task 1） */

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
      creditLimit: 25,
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

describe("finalValidate — 步骤 1: 防御性复查", () => {
  it("空 planId → 无效", () => {
    const result = finalValidate(
      makeSolverInput(),
      makePlan({ planId: "", volunteers: [] }),
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_NO_FEASIBLE_PLAN)).toBe(
        true,
      );
    }
  });

  it("无任何 volunteer → 无效", () => {
    const result = finalValidate(
      makeSolverInput(),
      makePlan({ planId: "p1", volunteers: [] }),
    );
    expect(result.kind).toBe("invalid");
  });
});

describe("finalValidate — 步骤 2: 池内性", () => {
  it("volunteer section 不在 sections 中 → MODEL_SECTION_NOT_IN_POOL", () => {
    const input = makeSolverInput({
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["S001"] }],
      },
    });
    const plan = makePlan({
      volunteers: [
        {
          sectionId: "S001",
          courseCode: "C001",
          rank: 1,
          groupId: "g1",
          locked: false,
        },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_SECTION_NOT_IN_POOL),
      ).toBe(true);
    }
  });

  it("volunteer section 存在但不在池中 → MODEL_SECTION_NOT_IN_POOL", () => {
    const sections = [makeSection({ sectionId: "S001", courseCode: "C001" })];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["S002"] }],
      },
    });
    const plan = makePlan({
      volunteers: [
        {
          sectionId: "S001",
          courseCode: "C001",
          rank: 1,
          groupId: "g1",
          locked: false,
        },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_SECTION_NOT_IN_POOL),
      ).toBe(true);
    }
  });

  it("volunteer section 存在且在池中 → 该步通过", () => {
    const sections = [makeSection({ sectionId: "S001", courseCode: "C001" })];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["S001"] }],
      },
      rules: { schemaVersion: "rules.v1", creditLimit: 25, bars: [] },
    });
    const plan = makePlan({
      volunteers: [
        {
          sectionId: "S001",
          courseCode: "C001",
          rank: 1,
          groupId: "g1",
          locked: false,
        },
      ],
    });
    const result = finalValidate(input, plan);
    // 池内性通过，可能因其他原因失败（如学分上限），但不会因池内性失败
    if (result.kind === "invalid") {
      const poolErrors = result.conflicts.filter(
        (c) => c.errorCode === ErrorCodes.MODEL_SECTION_NOT_IN_POOL,
      );
      expect(poolErrors).toHaveLength(0);
    }
  });
});

describe("finalValidate — 步骤 3: 课程覆盖", () => {
  it("池中目标课程未被覆盖 → MODEL_NO_FEASIBLE_PLAN", () => {
    const sections = [makeSection({ sectionId: "S001", courseCode: "C001" })];
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
    const plan = makePlan({
      volunteers: [
        {
          sectionId: "S001",
          courseCode: "C001",
          rank: 1,
          groupId: "g1",
          locked: false,
        },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      const coverageErrors = result.conflicts.filter(
        (c) =>
          c.errorCode === ErrorCodes.MODEL_NO_FEASIBLE_PLAN &&
          c.involvedCourseCodes.includes("C002"),
      );
      expect(coverageErrors.length).toBeGreaterThan(0);
    }
  });
});

describe("finalValidate — 步骤 5: 锁定保持", () => {
  it("baseline.selected 被移除 → MODEL_LOCK_VIOLATION", () => {
    const sections = [
      makeSection({ sectionId: "S001", courseCode: "C001" }),
      makeSection({ sectionId: "S001-ALT", courseCode: "C001" }),
      makeSection({ sectionId: "S002", courseCode: "C002" }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          { courseCode: "C001", candidateSectionIds: ["S001", "S001-ALT"] },
          { courseCode: "C002", candidateSectionIds: ["S002"] },
        ],
      },
      baseline: {
        schemaVersion: "baseline.v1",
        selected: ["S001"], // ← 已选，必须在 plan 中出现
        volunteers: [],
        importedAt: "2026-07-09T12:00:00.000+08:00",
      },
    });
    // plan 用 S001-ALT 覆盖 C001，但缺少 baseline.selected 的 S001
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001-ALT", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_LOCK_VIOLATION),
      ).toBe(true);
    }
  });

  it("手动锁定项在 plan 中缺失 → MODEL_LOCK_VIOLATION", () => {
    const sections = [
      makeSection({ sectionId: "S001", courseCode: "C001" }),
      makeSection({ sectionId: "S001-ALT", courseCode: "C001" }),
      makeSection({ sectionId: "S002", courseCode: "C002" }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [
          { courseCode: "C001", candidateSectionIds: ["S001", "S001-ALT"] },
          { courseCode: "C002", candidateSectionIds: ["S002"] },
        ],
      },
      lockedSectionIds: new Set(["S001"]),
    });
    // plan 用 S001-ALT 覆盖 C001，但缺少手动锁定的 S001
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001-ALT", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_LOCK_VIOLATION),
      ).toBe(true);
    }
  });

  it("手动锁定项 locked 标记丢失 → MODEL_LOCK_VIOLATION", () => {
    const sections = [makeSection({ sectionId: "S001", courseCode: "C001" })];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["S001"] }],
      },
      lockedSectionIds: new Set(["S001"]),
    });
    const plan = makePlan({
      volunteers: [
        {
          sectionId: "S001",
          courseCode: "C001",
          rank: 1,
          groupId: "g1",
          locked: false, // ← 应为 true
        },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some(
          (c) =>
            c.errorCode === ErrorCodes.MODEL_LOCK_VIOLATION &&
            c.involvedSectionIds.includes("S001"),
        ),
      ).toBe(true);
    }
  });
});

describe("finalValidate — 步骤 6a: 考试冲突", () => {
  it("不同课程同一考试时段 → MODEL_EXAM_CONFLICT", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        examTime: { examKey: "EXAM-A", raw: "2027-01-20 08:00-10:00" },
      }),
      makeSection({
        sectionId: "S002",
        courseCode: "C002",
        examTime: { examKey: "EXAM-A", raw: "2027-01-20 08:00-10:00" },
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
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_EXAM_CONFLICT),
      ).toBe(true);
    }
  });

  it("同一课程不同教学班同一考试时段 → 不冲突", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        examTime: { examKey: "EXAM-A", raw: "2027-01-20 08:00-10:00" },
      }),
      makeSection({
        sectionId: "S002",
        courseCode: "C001",
        examTime: { examKey: "EXAM-A", raw: "2027-01-20 08:00-10:00" },
      }),
    ];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["S001", "S002"] }],
      },
    });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C001", rank: 2, groupId: "g1", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    // 同一课程允许同一考试时段
    if (result.kind === "invalid") {
      const examErrors = result.conflicts.filter(
        (c) => c.errorCode === ErrorCodes.MODEL_EXAM_CONFLICT,
      );
      expect(examErrors).toHaveLength(0);
    }
  });
});

describe("finalValidate — 步骤 6b: 学分上限", () => {
  it("学分上限未填写 → MODEL_CREDIT_LIMIT_MISSING", () => {
    const sections = [makeSection({ sectionId: "S001", courseCode: "C001", credits: 3 })];
    const sectionMap = new Map(sections.map((s) => [s.sectionId, s]));
    const input = makeSolverInput({
      sections: sectionMap,
      pool: {
        schemaVersion: "pool.v1",
        targets: [{ courseCode: "C001", candidateSectionIds: ["S001"] }],
      },
      rules: { schemaVersion: "rules.v1", creditLimit: null, bars: [] },
    });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_CREDIT_LIMIT_MISSING),
      ).toBe(true);
    }
  });

  it("总学分超过上限 → MODEL_CREDIT_LIMIT_EXCEEDED", () => {
    const sections = [
      makeSection({ sectionId: "S001", courseCode: "C001", credits: 20 }),
      makeSection({ sectionId: "S002", courseCode: "C002", credits: 10 }),
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
      rules: { schemaVersion: "rules.v1", creditLimit: 25, bars: [] },
    });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(
        result.conflicts.some((c) => c.errorCode === ErrorCodes.MODEL_CREDIT_LIMIT_EXCEEDED),
      ).toBe(true);
    }
  });

  it("总学分在上限内 → 学分检查通过", () => {
    const sections = [
      makeSection({ sectionId: "S001", courseCode: "C001", credits: 10 }),
      makeSection({ sectionId: "S002", courseCode: "C002", credits: 10 }),
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
      rules: { schemaVersion: "rules.v1", creditLimit: 25, bars: [] },
    });
    const plan = makePlan({
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
    });
    const result = finalValidate(input, plan);
    if (result.kind === "invalid") {
      const creditErrors = result.conflicts.filter(
        (c) =>
          c.errorCode === ErrorCodes.MODEL_CREDIT_LIMIT_EXCEEDED ||
          c.errorCode === ErrorCodes.MODEL_CREDIT_LIMIT_MISSING,
      );
      expect(creditErrors).toHaveLength(0);
    }
  });
});

describe("finalValidate — 合法方案通过", () => {
  it("完全合法方案 → kind=valid", () => {
    const sections = [
      makeSection({
        sectionId: "S001",
        courseCode: "C001",
        credits: 10,
        examTime: { examKey: "EXAM-A", raw: "2027-01-20 08:00-10:00" },
      }),
      makeSection({
        sectionId: "S002",
        courseCode: "C002",
        credits: 10,
        examTime: { examKey: "EXAM-B", raw: "2027-01-21 14:00-16:00" },
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
      rules: { schemaVersion: "rules.v1", creditLimit: 25, bars: [] },
    });
    const plan = makePlan({
      planId: "plan-valid",
      volunteers: [
        { sectionId: "S001", courseCode: "C001", rank: 1, groupId: "g1", locked: false },
        { sectionId: "S002", courseCode: "C002", rank: 1, groupId: "g2", locked: false },
      ],
      totalCredits: 20,
    });
    const result = finalValidate(input, plan);
    expect(result.kind).toBe("valid");
  });
});
