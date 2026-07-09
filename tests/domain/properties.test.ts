import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SolverInput } from "../../src/domain/selection-model/index.js";
import {
  assessSchedulability,
  enumerateTopPlans,
  finalValidate,
} from "../../src/domain/selection-model/index.js";
import type {
  Baseline,
  CourseCode,
  Pool,
  Rules,
  Section,
  SectionId,
  TermSlot,
} from "../../src/shared/contracts/index.js";
import { ErrorCodes } from "../../src/shared/contracts/index.js";

/**
 * 求解器性质测试锚点（docs/05 §3.1 —— Task 1 门禁）。
 *
 * 组员 C 实现 selection-model 后，用 fast-check 4 将下列 todo 逐条变成
 * `await fc.assert(fc.asyncProperty(...))`（docs/07 §4.7：保留 seed/path 以便复现）。
 * 随机生成器建议：候选池（含缺失考试/学分的教学班）、锁定集、学分上限。
 */
describe("selection-model 性质（对任意随机输入必须成立）", () => {
  it.todo("1. 考试无硬冲突：不同课程不得同一考试时间；同课程不同班允许（D37）");
  it("2. 池内性：所有推荐教学班 ∈ 待选池（AC-4.2）", async () => {
    await fc.assert(
      fc.asyncProperty(solverInputCaseArbitrary(), async ({ input, groupOrderings }) => {
        const result = enumerateTopPlans(input, groupOrderings, 10);
        if (result.kind === "infeasible") {
          return;
        }

        const poolSectionIds = collectPoolSectionIds(input);
        for (const candidate of result.plans) {
          for (const volunteer of candidate.volunteers) {
            expect(poolSectionIds.has(volunteer.sectionId)).toBe(true);
          }
        }
      }),
      { numRuns: 100, seed: 20260710 },
    );
  });
  it.todo("3. 锁定保持：已选固定、已填志愿锁定、手动锁定不变（AC-6.1/6.2/7.1）");
  it.todo("4. 硬约束满足：学分上限/考试/锁定/志愿组全过；无解给出冲突来源且不放松（AC-5.2）");
  it.todo("5. 最小扰动：变更集不含锁定项，且无明显更少变更的等效解（启发式上界断言）");
  it.todo("6. 原子性：取消/失败路径不留下半成品状态（AC-6.4）");
  it.todo("7. 志愿合法性：志愿指向池内具体教学班；同课程≤3 且同时间段≤3 同时成立（D30）");
  it.todo("8. 模型边界：第三/四轮、补选、学分因素不进入录取优先级或概率估计（D30、D38）");
  it("9. 缺失硬字段：考试/学分缺失的教学班不进排课结果，留在待选池并给原因（D37、D38）", async () => {
    await fc.assert(
      fc.asyncProperty(solverInputCaseArbitrary(), async ({ input, groupOrderings }) => {
        const schedulability = assessSchedulability(input);
        const missingHardFieldReasonById = collectMissingHardFieldReasons(input);

        if (input.rules.creditLimit !== null) {
          for (const [sectionId, reasonCode] of missingHardFieldReasonById) {
            expect(schedulability.excluded).toContainEqual({ sectionId, reasonCode });
          }
        }

        const result = enumerateTopPlans(input, groupOrderings, 10);
        if (result.kind === "infeasible") {
          return;
        }

        for (const candidate of result.plans) {
          for (const volunteer of candidate.volunteers) {
            expect(missingHardFieldReasonById.has(volunteer.sectionId)).toBe(false);
          }
        }
      }),
      { numRuns: 100, seed: 20260711 },
    );
  });
  it("10. Top10 边界：候选方案 ≤10 且每个都能独立通过 finalValidate（D39）", async () => {
    await fc.assert(
      fc.asyncProperty(solverInputCaseArbitrary(), async ({ input, groupOrderings }) => {
        const result = enumerateTopPlans(input, groupOrderings, 10);

        if (result.kind === "infeasible") {
          expect(result.conflicts.length).toBeGreaterThan(0);
          return;
        }

        expect(result.plans.length).toBeLessThanOrEqual(10);
        for (const candidate of result.plans) {
          expect(finalValidate(input, candidate)).toEqual({ kind: "valid" });
        }
      }),
      { numRuns: 100, seed: 20260709 },
    );
  });
});

interface GeneratedCourse {
  courseCode: CourseCode;
  sectionCount: number;
}

interface GeneratedCase {
  input: SolverInput;
  groupOrderings: Array<{ groupId: string; orderedSectionIds: SectionId[] }>;
}

function solverInputCaseArbitrary(): fc.Arbitrary<GeneratedCase> {
  return fc
    .array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 })
    .chain((sectionCounts) => {
      const courses = sectionCounts.map((sectionCount, courseIndex): GeneratedCourse => {
        const courseNumber = courseIndex + 1;
        return {
          courseCode: `COURSE_${courseNumber}` as CourseCode,
          sectionCount,
        };
      });
      const sectionIds = courses.flatMap((course, courseIndex) =>
        Array.from({ length: course.sectionCount }, (_, sectionIndex) =>
          sectionIdFor(courseIndex, sectionIndex),
        ),
      );

      return fc
        .record({
          creditLimit: fc.option(fc.integer({ min: 0, max: 18 }), { nil: null }),
          missingExamIds: fc.subarray(sectionIds),
          missingCreditIds: fc.subarray(sectionIds),
          conflictingExamIds: fc.subarray(sectionIds),
          reversedGroupIds: fc.subarray(
            courses.filter((course) => course.sectionCount >= 2).map((course) => course.courseCode),
          ),
        })
        .map((options) => buildGeneratedCase(courses, options));
    });
}

function buildGeneratedCase(
  courses: readonly GeneratedCourse[],
  options: {
    creditLimit: number | null;
    missingExamIds: SectionId[];
    missingCreditIds: SectionId[];
    conflictingExamIds: SectionId[];
    reversedGroupIds: CourseCode[];
  },
): GeneratedCase {
  const missingExamIds = new Set(options.missingExamIds);
  const missingCreditIds = new Set(options.missingCreditIds);
  const conflictingExamIds = new Set(options.conflictingExamIds);
  const reversedGroupIds = new Set(options.reversedGroupIds);
  const sections = courses.flatMap((course, courseIndex) =>
    Array.from({ length: course.sectionCount }, (_, sectionIndex) => {
      const sectionId = sectionIdFor(courseIndex, sectionIndex);
      return sectionFor({
        sectionId,
        courseCode: course.courseCode,
        slot: slotFor(courseIndex, sectionIndex),
        examKey: conflictingExamIds.has(sectionId)
          ? "shared-conflict"
          : `exam-${courseIndex + 1}-${sectionIndex + 1}`,
        examMissing: missingExamIds.has(sectionId),
        creditMissing: missingCreditIds.has(sectionId),
      });
    }),
  );
  const poolTargets: Pool["targets"] = courses.map((course, courseIndex) => ({
    courseCode: course.courseCode,
    candidateSectionIds: Array.from({ length: course.sectionCount }, (_, sectionIndex) =>
      sectionIdFor(courseIndex, sectionIndex),
    ),
  }));
  const groupOrderings = poolTargets.flatMap((target) => {
    if (target.candidateSectionIds.length < 2) {
      return [];
    }

    return [
      {
        groupId: `course:${target.courseCode}`,
        orderedSectionIds: reversedGroupIds.has(target.courseCode)
          ? target.candidateSectionIds.slice().reverse()
          : target.candidateSectionIds.slice(),
      },
    ];
  });

  return {
    input: {
      sections: new Map(sections.map((section) => [section.sectionId, section])),
      baseline: baseline(),
      pool: { schemaVersion: "pool.v1", targets: poolTargets },
      rules: rules(options.creditLimit),
      lockedSectionIds: new Set(),
    },
    groupOrderings,
  };
}

function sectionFor(input: {
  sectionId: SectionId;
  courseCode: CourseCode;
  slot: TermSlot;
  examKey: string;
  examMissing: boolean;
  creditMissing: boolean;
}): Section {
  return {
    sectionId: input.sectionId,
    courseCode: input.courseCode,
    courseName: `课程 ${input.courseCode}`,
    teachers: ["合成教师"],
    slots: [input.slot],
    place: null,
    examTime: input.examMissing
      ? null
      : { examKey: input.examKey, raw: `2026-12-${input.examKey}` },
    credits: input.creditMissing ? null : 3,
  };
}

function sectionIdFor(courseIndex: number, sectionIndex: number): SectionId {
  return `sec-${courseIndex + 1}-${sectionIndex + 1}` as SectionId;
}

function slotFor(courseIndex: number, sectionIndex: number): TermSlot {
  return {
    term: "autumn",
    dayOfWeek: ((courseIndex + sectionIndex) % 7) + 1,
    period: (sectionIndex % 12) + 1,
  };
}

function baseline(): Baseline {
  return {
    schemaVersion: "baseline.v1",
    selected: [],
    volunteers: [],
    importedAt: "2026-07-09T10:00:00.000+08:00",
  };
}

function rules(creditLimit: number | null): Rules {
  return {
    schemaVersion: "rules.v1",
    creditLimit,
    bars: [],
  };
}

function collectPoolSectionIds(input: SolverInput): Set<SectionId> {
  return new Set(input.pool.targets.flatMap((target) => target.candidateSectionIds));
}

function collectMissingHardFieldReasons(input: SolverInput): Map<SectionId, string> {
  const reasonById = new Map<SectionId, string>();
  const poolSectionIds = collectPoolSectionIds(input);

  for (const sectionId of poolSectionIds) {
    const section = input.sections.get(sectionId);
    if (!section) {
      continue;
    }
    if (section.examTime === null) {
      reasonById.set(sectionId, ErrorCodes.MODEL_MISSING_EXAM_TIME);
      continue;
    }
    if (section.credits === null) {
      reasonById.set(sectionId, ErrorCodes.MODEL_MISSING_CREDIT);
    }
  }

  return reasonById;
}
