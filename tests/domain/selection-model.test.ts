import { describe, expect, it } from "vitest";
import type { SolverInput } from "../../src/domain/selection-model/index.js";
import {
  assessSchedulability,
  buildVolunteerGroups,
  classTimesOverlap,
  enumerateTopPlans,
  estimateRisk,
  finalValidate,
  timeslotKey,
} from "../../src/domain/selection-model/index.js";
import type {
  Baseline,
  CandidatePlan,
  Pool,
  Rules,
  Section,
  SectionId,
  TermSlot,
} from "../../src/shared/contracts/index.js";
import { ErrorCodes } from "../../src/shared/contracts/index.js";

const importedAt = "2026-07-09T10:00:00.000+08:00";

function section(overrides: Partial<Section> & Pick<Section, "sectionId" | "courseCode">): Section {
  const defaultExamTime: Section["examTime"] = {
    examKey: `exam-${overrides.courseCode}`,
    raw: "2026-12-31 08:00-10:00",
  };
  const examTime: Section["examTime"] =
    overrides.examTime === undefined ? defaultExamTime : overrides.examTime;
  const credits: Section["credits"] = overrides.credits === undefined ? 3 : overrides.credits;

  return {
    sectionId: overrides.sectionId,
    courseCode: overrides.courseCode,
    courseName: overrides.courseName ?? `课程 ${overrides.courseCode}`,
    teachers: overrides.teachers ?? ["合成教师"],
    slots: overrides.slots ?? [{ term: "autumn", dayOfWeek: 1, period: 1 }],
    place: overrides.place ?? null,
    examTime,
    credits,
    unverifiedRaw: overrides.unverifiedRaw,
  };
}

function inputFor(
  sections: readonly Section[],
  options: {
    creditLimit?: number | null;
    poolTargets?: Pool["targets"];
    baseline?: Partial<Baseline>;
    lockedSectionIds?: readonly SectionId[];
  } = {},
): SolverInput {
  const poolTargets =
    options.poolTargets ??
    sections.map((item) => ({
      courseCode: item.courseCode,
      candidateSectionIds: [item.sectionId],
    }));

  const baseline: Baseline = {
    schemaVersion: "baseline.v1",
    selected: [],
    volunteers: [],
    importedAt,
    ...options.baseline,
  };

  const pool: Pool = { schemaVersion: "pool.v1", targets: poolTargets };
  const rules: Rules = {
    schemaVersion: "rules.v1",
    creditLimit: options.creditLimit === undefined ? 18 : options.creditLimit,
    bars: [],
  };

  return {
    sections: new Map(sections.map((item) => [item.sectionId, item])),
    baseline,
    pool,
    rules,
    lockedSectionIds: new Set(options.lockedSectionIds ?? []),
  };
}

function plan(
  volunteers: CandidatePlan["volunteers"],
  totalCredits = volunteers.length * 3,
): CandidatePlan {
  return {
    planId: "plan-1",
    volunteers,
    groups: [],
    totalCredits,
  };
}

/** 已实现部分的真实测试（组员 C 在 Task 1 持续扩充本目录）。 */
describe("timeslot 归一化（D37）", () => {
  it("同 学期+星期+节次 生成同一 key，不含单双周维度", () => {
    const a: TermSlot = { term: "autumn", dayOfWeek: 1, period: 1 };
    const b: TermSlot = { term: "autumn", dayOfWeek: 1, period: 1 };
    expect(timeslotKey(a)).toBe(timeslotKey(b));
    expect(timeslotKey(a)).toBe("autumn-1-1");
  });

  it("上课时间重叠可被检测（重叠 ≠ 无解，仅供软排序参考）", () => {
    const mon12: TermSlot[] = [
      { term: "autumn", dayOfWeek: 1, period: 1 },
      { term: "autumn", dayOfWeek: 1, period: 2 },
    ];
    const mon2: TermSlot[] = [{ term: "autumn", dayOfWeek: 1, period: 2 }];
    const tue3: TermSlot[] = [{ term: "autumn", dayOfWeek: 2, period: 3 }];
    expect(classTimesOverlap(mon12, mon2)).toBe(true);
    expect(classTimesOverlap(mon12, tue3)).toBe(false);
  });
});

describe("录取风险冻结（D01、D30 —— 硬规则 H3）", () => {
  it("estimateRisk 恒返回 unavailable，直至规则档闭环并新增解冻决策", () => {
    const section = {} as Section; // 输入无关紧要 —— 冻结期实现与输入无关
    expect(estimateRisk(section, null)).toEqual({ status: "unavailable" });
  });
});

describe("可排性硬字段筛选（Task 1 / C1）", () => {
  it("把考试时间或学分缺失的教学班留在待选池，并给出稳定原因码", () => {
    const ready = section({ sectionId: "sec-ready", courseCode: "COURSE_READY" });
    const missingExam = section({
      sectionId: "sec-no-exam",
      courseCode: "COURSE_EXAM",
      examTime: null,
    });
    const missingCredit = section({
      sectionId: "sec-no-credit",
      courseCode: "COURSE_CREDIT",
      credits: null,
    });

    const result = assessSchedulability(inputFor([ready, missingExam, missingCredit]));

    expect(result.schedulable).toEqual(["sec-ready"]);
    expect(result.excluded).toEqual([
      { sectionId: "sec-no-exam", reasonCode: ErrorCodes.MODEL_MISSING_EXAM_TIME },
      { sectionId: "sec-no-credit", reasonCode: ErrorCodes.MODEL_MISSING_CREDIT },
    ]);
  });

  it("学分上限未填写时，不让任何待选池教学班进入排课", () => {
    const first = section({ sectionId: "sec-a", courseCode: "COURSE_A" });
    const second = section({ sectionId: "sec-b", courseCode: "COURSE_B" });

    const result = assessSchedulability(inputFor([first, second], { creditLimit: null }));

    expect(result.schedulable).toEqual([]);
    expect(result.excluded).toEqual([
      { sectionId: "sec-a", reasonCode: ErrorCodes.MODEL_CREDIT_LIMIT_MISSING },
      { sectionId: "sec-b", reasonCode: ErrorCodes.MODEL_CREDIT_LIMIT_MISSING },
    ]);
  });
});

describe("终校验基础硬约束（Task 1 / C1）", () => {
  it("接受池内、无考试冲突、未超学分且保持锁定的方案", () => {
    const first = section({ sectionId: "sec-a", courseCode: "COURSE_A", credits: 3 });
    const second = section({ sectionId: "sec-b", courseCode: "COURSE_B", credits: 4 });
    const input = inputFor([first, second], {
      creditLimit: 10,
      baseline: { volunteers: [{ sectionId: "sec-a", rank: 1 }] },
      lockedSectionIds: ["sec-b"],
    });

    const result = finalValidate(
      input,
      plan(
        [
          {
            sectionId: "sec-a",
            courseCode: "COURSE_A",
            rank: 1,
            groupId: "course:COURSE_A",
            locked: true,
          },
          {
            sectionId: "sec-b",
            courseCode: "COURSE_B",
            rank: 1,
            groupId: "course:COURSE_B",
            locked: true,
          },
        ],
        7,
      ),
    );

    expect(result).toEqual({ kind: "valid" });
  });

  it("拒绝池外教学班，避免 LLM 或 planner 引入用户未选择的班级", () => {
    const inPool = section({ sectionId: "sec-in-pool", courseCode: "COURSE_A" });
    const outsidePool = section({ sectionId: "sec-outside", courseCode: "COURSE_B" });
    const input = inputFor([inPool, outsidePool], {
      poolTargets: [{ courseCode: "COURSE_A", candidateSectionIds: ["sec-in-pool"] }],
    });

    const result = finalValidate(
      input,
      plan([
        {
          sectionId: "sec-outside",
          courseCode: "COURSE_B",
          rank: 1,
          groupId: "course:COURSE_B",
          locked: false,
        },
      ]),
    );

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" ? result.conflicts[0]?.errorCode : null).toBe(
      ErrorCodes.MODEL_SECTION_NOT_IN_POOL,
    );
  });

  it("拒绝不同课程的同一考试时间硬冲突", () => {
    const first = section({
      sectionId: "sec-a",
      courseCode: "COURSE_A",
      examTime: { examKey: "same-exam", raw: "2026-12-31 08:00-10:00" },
    });
    const second = section({
      sectionId: "sec-b",
      courseCode: "COURSE_B",
      examTime: { examKey: "same-exam", raw: "2026-12-31 08:00-10:00" },
    });

    const result = finalValidate(
      inputFor([first, second]),
      plan([
        {
          sectionId: "sec-a",
          courseCode: "COURSE_A",
          rank: 1,
          groupId: "course:COURSE_A",
          locked: false,
        },
        {
          sectionId: "sec-b",
          courseCode: "COURSE_B",
          rank: 1,
          groupId: "course:COURSE_B",
          locked: false,
        },
      ]),
    );

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" ? result.conflicts[0]?.errorCode : null).toBe(
      ErrorCodes.MODEL_EXAM_CONFLICT,
    );
  });

  it("把已正式选上的教学班纳入考试和学分硬校验", () => {
    const selected = section({
      sectionId: "sec-selected",
      courseCode: "COURSE_SELECTED",
      credits: 4,
      examTime: { examKey: "same-exam", raw: "2026-12-31 08:00-10:00" },
    });
    const candidate = section({
      sectionId: "sec-candidate",
      courseCode: "COURSE_CANDIDATE",
      credits: 4,
      examTime: { examKey: "same-exam", raw: "2026-12-31 08:00-10:00" },
    });

    const result = finalValidate(
      inputFor([selected, candidate], {
        creditLimit: 6,
        baseline: { selected: ["sec-selected"] },
        poolTargets: [{ courseCode: "COURSE_CANDIDATE", candidateSectionIds: ["sec-candidate"] }],
      }),
      plan(
        [
          {
            sectionId: "sec-candidate",
            courseCode: "COURSE_CANDIDATE",
            rank: 1,
            groupId: "course:COURSE_CANDIDATE",
            locked: false,
          },
        ],
        4,
      ),
    );

    expect(result.kind).toBe("invalid");
    const errorCodes =
      result.kind === "invalid" ? result.conflicts.map((item) => item.errorCode) : [];
    expect(errorCodes).toContain(ErrorCodes.MODEL_EXAM_CONFLICT);
    expect(errorCodes).toContain(ErrorCodes.MODEL_CREDIT_LIMIT_EXCEEDED);
  });

  it("拒绝超出用户学分上限的方案", () => {
    const first = section({ sectionId: "sec-a", courseCode: "COURSE_A", credits: 4 });
    const second = section({ sectionId: "sec-b", courseCode: "COURSE_B", credits: 4 });

    const result = finalValidate(
      inputFor([first, second], { creditLimit: 6 }),
      plan([
        {
          sectionId: "sec-a",
          courseCode: "COURSE_A",
          rank: 1,
          groupId: "course:COURSE_A",
          locked: false,
        },
        {
          sectionId: "sec-b",
          courseCode: "COURSE_B",
          rank: 1,
          groupId: "course:COURSE_B",
          locked: false,
        },
      ]),
    );

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" ? result.conflicts[0]?.errorCode : null).toBe(
      ErrorCodes.MODEL_CREDIT_LIMIT_EXCEEDED,
    );
  });

  it("拒绝删除或改动已填志愿 / 手动锁定项", () => {
    const locked = section({ sectionId: "sec-locked", courseCode: "COURSE_A" });
    const input = inputFor([locked], {
      baseline: { volunteers: [{ sectionId: "sec-locked", rank: 2 }] },
      lockedSectionIds: ["sec-locked"],
    });

    const result = finalValidate(
      input,
      plan([
        {
          sectionId: "sec-locked",
          courseCode: "COURSE_A",
          rank: 1,
          groupId: "course:COURSE_A",
          locked: true,
        },
      ]),
    );

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" ? result.conflicts[0]?.errorCode : null).toBe(
      ErrorCodes.MODEL_LOCK_VIOLATION,
    );
  });
});

describe("志愿组 Top3 与候选枚举（Task 1 / C2）", () => {
  it("课程志愿组超过 3 个候选时，按 LLM GroupOrdering 选出最优 3 个并保留顺序", () => {
    const sections = [
      section({ sectionId: "sec-1", courseCode: "COURSE_A" }),
      section({ sectionId: "sec-2", courseCode: "COURSE_A" }),
      section({ sectionId: "sec-3", courseCode: "COURSE_A" }),
      section({ sectionId: "sec-4", courseCode: "COURSE_A" }),
    ];
    const input = inputFor(sections, {
      poolTargets: [
        { courseCode: "COURSE_A", candidateSectionIds: ["sec-1", "sec-2", "sec-3", "sec-4"] },
      ],
    });

    const groups = buildVolunteerGroups(input, [
      { groupId: "course:COURSE_A", orderedSectionIds: ["sec-4", "sec-2", "sec-3", "sec-1"] },
    ]);

    expect(groups).toEqual([
      {
        groupId: "course:COURSE_A",
        kind: "course",
        ref: "COURSE_A",
        orderedSectionIds: ["sec-4", "sec-2", "sec-3"],
        invalidated: null,
      },
    ]);
  });

  it("LLM GroupOrdering 引用组外教学班时，枚举失败且不生成部分方案", () => {
    const sections = [
      section({ sectionId: "sec-1", courseCode: "COURSE_A" }),
      section({ sectionId: "sec-2", courseCode: "COURSE_A" }),
      section({ sectionId: "sec-outside", courseCode: "COURSE_B" }),
    ];
    const input = inputFor(sections, {
      poolTargets: [{ courseCode: "COURSE_A", candidateSectionIds: ["sec-1", "sec-2"] }],
    });

    const result = enumerateTopPlans(input, [
      { groupId: "course:COURSE_A", orderedSectionIds: ["sec-1", "sec-outside"] },
    ]);

    expect(result.kind).toBe("infeasible");
    expect(result.kind === "infeasible" ? result.conflicts[0]?.errorCode : null).toBe(
      ErrorCodes.LLM_ID_OUT_OF_INPUT,
    );
  });

  it("枚举出的候选方案使用 LLM Top3 顺序，且能通过 finalValidate", () => {
    const sections = [
      section({ sectionId: "sec-1", courseCode: "COURSE_A", credits: 3 }),
      section({ sectionId: "sec-2", courseCode: "COURSE_A", credits: 3 }),
      section({ sectionId: "sec-3", courseCode: "COURSE_A", credits: 3 }),
      section({ sectionId: "sec-4", courseCode: "COURSE_A", credits: 3 }),
    ];
    const input = inputFor(sections, {
      creditLimit: 6,
      poolTargets: [
        { courseCode: "COURSE_A", candidateSectionIds: ["sec-1", "sec-2", "sec-3", "sec-4"] },
      ],
    });

    const result = enumerateTopPlans(input, [
      { groupId: "course:COURSE_A", orderedSectionIds: ["sec-4", "sec-2", "sec-3", "sec-1"] },
    ]);

    expect(result.kind).toBe("plans");
    if (result.kind !== "plans") {
      return;
    }

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.volunteers.map((item) => [item.sectionId, item.rank])).toEqual([
      ["sec-4", 1],
      ["sec-2", 2],
      ["sec-3", 3],
    ]);
    expect(result.plans[0] ? finalValidate(input, result.plans[0]) : null).toEqual({
      kind: "valid",
    });
  });
});

describe("课程组优先与时间槽组失效（Task 1 / C3.1）", () => {
  it("课程志愿组占用某个时间槽时，返回带原因的失效时间槽组供 UI 解释", () => {
    const sharedSlot: TermSlot = { term: "autumn", dayOfWeek: 1, period: 1 };
    const sections = [
      section({ sectionId: "sec-a-1", courseCode: "COURSE_A", slots: [sharedSlot] }),
      section({
        sectionId: "sec-a-2",
        courseCode: "COURSE_A",
        slots: [{ term: "autumn", dayOfWeek: 2, period: 1 }],
      }),
      section({ sectionId: "sec-b-1", courseCode: "COURSE_B", slots: [sharedSlot] }),
    ];
    const input = inputFor(sections, {
      poolTargets: [
        { courseCode: "COURSE_A", candidateSectionIds: ["sec-a-1", "sec-a-2"] },
        { courseCode: "COURSE_B", candidateSectionIds: ["sec-b-1"] },
      ],
    });

    const groups = buildVolunteerGroups(input);

    expect(groups).toContainEqual({
      groupId: "course:COURSE_A",
      kind: "course",
      ref: "COURSE_A",
      orderedSectionIds: ["sec-a-1", "sec-a-2"],
      invalidated: null,
    });
    expect(groups).toContainEqual({
      groupId: "timeslot:autumn-1-1",
      kind: "timeslot",
      ref: "autumn-1-1",
      orderedSectionIds: ["sec-a-1", "sec-b-1"],
      invalidated: {
        reason: "时间槽组包含已进入课程志愿组的教学班，按课程组优先规则失效",
        byGroupId: "course:COURSE_A",
      },
    });
  });
});
