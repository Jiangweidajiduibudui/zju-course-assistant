import { describe, expect, it } from "vitest";
import { applyPlanAtomically } from "../../src/client/features/session/sessionPlan.js";
import type { SolverInput } from "../../src/domain/selection-model/index.js";
import type { CandidatePlan, Section, Session } from "../../src/shared/contracts/index.js";
import { ErrorCodes, sessionSchema } from "../../src/shared/contracts/index.js";

const importedAt = "2026-07-09T10:00:00.000+08:00";

function section(overrides: Partial<Section> & Pick<Section, "sectionId" | "courseCode">): Section {
  return {
    sectionId: overrides.sectionId,
    courseCode: overrides.courseCode,
    courseName: overrides.courseName ?? `课程 ${overrides.courseCode}`,
    teachers: overrides.teachers ?? ["合成教师"],
    slots: overrides.slots ?? [{ term: "autumn", dayOfWeek: 1, period: 1 }],
    place: overrides.place ?? null,
    examTime: overrides.examTime ?? {
      examKey: `exam-${overrides.courseCode}`,
      raw: "2026-12-31 08:00-10:00",
    },
    credits: overrides.credits ?? 3,
  };
}

function sessionFor(sections: readonly Section[]): Session {
  return sessionSchema.parse({
    schemaVersion: "session.v1",
    id: "session-atomicity-test",
    name: "原子应用测试 session",
    createdAt: importedAt,
    baseline: {
      schemaVersion: "baseline.v1",
      selected: [],
      volunteers: [],
      importedAt,
    },
    pool: {
      schemaVersion: "pool.v1",
      targets: sections.map((item) => ({
        courseCode: item.courseCode,
        candidateSectionIds: [item.sectionId],
      })),
    },
    rules: { schemaVersion: "rules.v1", creditLimit: 18, bars: [] },
    plan: null,
    history: [],
  });
}

function inputFor(session: Session, sections: readonly Section[]): SolverInput {
  return {
    sections: new Map(sections.map((item) => [item.sectionId, item])),
    baseline: session.baseline,
    pool: session.pool,
    rules: session.rules,
    lockedSectionIds: new Set(),
  };
}

function plan(volunteers: CandidatePlan["volunteers"]): CandidatePlan {
  return {
    planId: "plan-invalid",
    volunteers,
    groups: [],
    totalCredits: 3,
  };
}

describe("session 方案原子应用（AC-6.4 / D27）", () => {
  it("终校验通过时一次性写入 plan，并把旧完整状态入 history", () => {
    const inPool = section({ sectionId: "sec-in-pool", courseCode: "COURSE_A" });
    const session = sessionFor([inPool]);
    const input = inputFor(session, [inPool]);
    const candidatePlan = plan([
      {
        sectionId: "sec-in-pool",
        courseCode: "COURSE_A",
        rank: 1,
        groupId: "course:COURSE_A",
        locked: false,
      },
    ]);

    const result = applyPlanAtomically(session, input, candidatePlan, {
      label: "应用合法方案",
      now: importedAt,
    });

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") {
      return;
    }
    expect(result.session.plan).toEqual(candidatePlan);
    expect(result.session.history).toEqual([
      {
        at: importedAt,
        label: "应用合法方案",
        pool: session.pool,
        rules: session.rules,
        plan: session.plan,
      },
    ]);
    expect(session.plan).toBeNull();
    expect(session.history).toEqual([]);
  });

  it("终校验失败时返回原 session，不写入 plan 或 history", () => {
    const inPool = section({ sectionId: "sec-in-pool", courseCode: "COURSE_A" });
    const outsidePool = section({ sectionId: "sec-outside", courseCode: "COURSE_B" });
    const session = sessionFor([inPool]);
    const input = inputFor(session, [inPool, outsidePool]);

    const result = applyPlanAtomically(
      session,
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
      { label: "应用非法方案", now: importedAt },
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") {
      return;
    }
    expect(result.session).toEqual(session);
    expect(result.errorCode).toBe(ErrorCodes.PLAN_FINAL_VALIDATION_FAILED);
    expect(session.plan).toBeNull();
    expect(session.history).toEqual([]);
  });
});
