// biome-ignore-all lint/style/noNonNullAssertion: Adversarial tests deliberately mutate required authored fixture rows.
import { describe, expect, it } from "vitest";
import {
  initialPlans,
  known,
  originalSnapshot,
  updatedSnapshot,
} from "../../fixtures/ui/catalog.js";
import type { PlanningContext } from "../../src/domain/contracts.js";
import {
  adoptedContent,
  creditSummary,
  diff,
  finalValidate,
  primarySelections,
  project,
  reconcile,
  stamp,
  teachingOverlaps,
  toDraft,
  validateChecklist,
  validateDraft,
  validateProposal,
} from "../../src/domain/planning.js";
import { Snapshot, TeachingSlot } from "../../src/shared/contracts/catalog.js";
import { Plan } from "../../src/shared/contracts/planning.js";

const context = (): PlanningContext => ({
  plan: Plan.parse(structuredClone(initialPlans[0])),
  snapshot: Snapshot.parse(structuredClone(originalSnapshot)),
  latestLiveSnapshotId: null,
});
const codes = (report: ReturnType<typeof validateDraft>) =>
  report.issues.map((i) => i.code);
const slot = TeachingSlot.parse({
  partId: "autumn",
  weeks: [1, 3],
  weekday: 1,
  startPeriod: 1,
  endPeriod: 2,
});
describe("interval semantics", () => {
  it.each([
    [{}, true],
    [{ partId: "winter" }, false],
    [{ weeks: [2, 4] }, false],
    [{ weeks: [3] }, true],
    [{ weekday: 2 }, false],
    [{ startPeriod: 3, endPeriod: 4 }, false],
    [{ startPeriod: 2, endPeriod: 3 }, true],
  ])(
    "uses parts, weeks and inclusive teaching periods: %o",
    (patch, expected) =>
      expect(teachingOverlaps(slot, { ...slot, ...patch })).toBe(expected),
  );
  it("treats adjacent exams as nonoverlapping but detects cross-course overlap", () => {
    const c = context();
    const a = c.snapshot.sections.find((s) => s.id === "math-a");
    const b = c.snapshot.sections.find((s) => s.id === "code-a");
    if (!a || !b) throw new Error("fixture");
    a.exams = known([
      {
        startsAt: "2026-11-01T01:00:00Z",
        endsAt: "2026-11-01T03:00:00Z",
        location: { state: "unknown", reason: "not_provided" },
      },
    ]);
    b.exams = known([
      {
        startsAt: "2026-11-01T03:00:00Z",
        endsAt: "2026-11-01T04:00:00Z",
        location: { state: "unknown", reason: "not_provided" },
      },
    ]);
    expect(codes(validateProposal(c, primarySelections(c.plan)))).not.toContain(
      "EXAM_CONFLICT",
    );
    b.exams.value[0]!.startsAt = "2026-11-01T02:59:00Z";
    expect(codes(validateProposal(c, primarySelections(c.plan)))).toContain(
      "EXAM_CONFLICT",
    );
  });
});
describe("distinct proposal, draft and checklist gates", () => {
  it("teaching overlap is only a warning until confirmed hard", () => {
    const c = context();
    const report = validateProposal(c, primarySelections(c.plan));
    expect(report.status).toBe("valid");
    expect(
      report.issues.find((i) => i.code === "TEACHING_OVERLAP")?.severity,
    ).toBe("warning");
    c.plan.content.preferences.hardConstraints = [
      { id: "hard", kind: "no_teaching_overlap" },
    ];
    expect(validateProposal(c, primarySelections(c.plan)).status).toBe(
      "invalid",
    );
  });
  it("rejects invented, duplicate, omitted, excluded and cross-course IDs", () => {
    const c = context();
    const selections = primarySelections(c.plan);
    for (const bad of [
      [],
      [...selections, selections[0]!],
      [{ courseId: "math", sectionId: "code-a" }],
      [{ courseId: "math", sectionId: "invented" }],
      selections.map((s) =>
        s.courseId === "math" ? { ...s, sectionId: "math-b" } : s,
      ),
    ])
      expect(validateProposal(c, bad).status).toBe("invalid");
    c.plan.content.shortlist[0]!.items[0]!.disposition = "excluded";
    expect(codes(validateProposal(c, selections))).toContain(
      "CANDIDATE_MEMBERSHIP",
    );
  });
  it("keeps missing data unknown instead of assuming zero or no exam", () => {
    const c = context();
    c.snapshot.courses.find((x) => x.id === "math")!.credits = {
      state: "unknown",
      reason: "not_provided",
    };
    c.snapshot.sections.find((s) => s.id === "math-a")!.exams = {
      state: "unknown",
      reason: "not_parsed",
    };
    c.snapshot.enrolledSectionIds = { state: "unknown", reason: "not_loaded" };
    const report = validateProposal(c, primarySelections(c.plan));
    expect(report.status).toBe("indeterminate");
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "BASELINE_UNKNOWN",
        "EXAM_UNKNOWN",
        "CREDITS_UNKNOWN",
      ]),
    );
    expect(creditSummary(c, ["math-a", "code-a"]).missingCourseIds).toContain(
      "math",
    );
  });
  it("locks baseline, includes its credits, and distrusts a supplied valid report", () => {
    const c = context();
    const projection = project(c);
    expect(projection.credits.knownTotal).toBe(8);
    expect(projection.baselineSectionIds).toEqual(["sport-a"]);
    const report = finalValidate({
      ...c,
      arrangement: {
        id: "forged",
        stamp: stamp(c),
        sectionIds: ["math-a", "code-a"],
        baselineSectionIds: [],
        credits: projection.credits,
        validation: { status: "valid", issues: [] },
      },
    });
    expect(codes(report)).toContain("BASELINE_LOCKED");
    c.plan.content.preferences.creditLimit = 7;
    expect(codes(validateProposal(c, primarySelections(c.plan)))).toContain(
      "CREDIT_LIMIT_EXCEEDED",
    );
  });
  it("checks scoped blocked time without converting soft text into a hard rule", () => {
    const c = context();
    c.plan.content.preferences.note = "Keep Monday free";
    expect(codes(validateProposal(c, primarySelections(c.plan)))).toContain(
      "PREFERENCES_UNCONFIRMED",
    );
    c.plan.content.preferences.textConfirmed = true;
    expect(codes(validateProposal(c, primarySelections(c.plan)))).not.toContain(
      "BLOCKED_TIME",
    );
    c.plan.content.preferences.courseOverrides = [
      {
        courseId: "math",
        orderedCriteria: [],
        hardConstraints: [{ id: "block", kind: "blocked_time", slot }],
      },
    ];
    const issues = validateProposal(c, primarySelections(c.plan)).issues.filter(
      (i) => i.code === "BLOCKED_TIME",
    );
    expect(issues.map((i) => i.sectionIds)).toEqual([["math-a"]]);
  });
  it("retains fourth preferences and independently counts overlapping periods", () => {
    const c = context();
    c.plan.content.shortlist[0]!.items.push(
      ...["math-b", "math-d"].map((sectionId) => ({
        sectionId,
        disposition: "candidate" as const,
        favorite: false,
        note: "preserved",
      })),
    );
    for (const s of c.snapshot.sections)
      s.meetings = known([
        { slot, location: { state: "unknown", reason: "not_provided" } },
      ]);
    const draft = toDraft(c);
    expect(draft.entries).toHaveLength(5);
    expect(draft.entries.some((e) => e.priority === 4)).toBe(true);
    expect(codes(draft.validation)).toEqual(
      expect.arrayContaining([
        "COURSE_VOLUNTEER_LIMIT",
        "TIME_GROUP_VOLUNTEER_LIMIT",
      ]),
    );
    expect(codes(project(c).validation)).not.toContain(
      "COURSE_VOLUNTEER_LIMIT",
    );
  });
  it("cannot export synthetic or imported evidence even when primary time checks pass", () => {
    const c = context();
    expect(validateProposal(c, primarySelections(c.plan)).status).toBe("valid");
    expect(codes(validateChecklist(c))).toContain("FIXTURE_ONLY");
    expect(codes(validateDraft(c))).not.toContain("TIME_GROUP_UNKNOWN");
    expect(codes(validateDraft(c))).not.toContain("RULES_UNVERIFIED");
    c.snapshot.meta.provenance = {
      origin: "imported",
      synthetic: false,
      sources: [],
    };
    expect(codes(validateChecklist(c))).toContain("IMPORTED_SNAPSHOT");
  });
  it("adopts a selected primary without losing fallback order, notes or exclusions", () => {
    const c = context();
    c.plan.content.shortlist[0]!.items.push({
      sectionId: "math-b",
      disposition: "excluded",
      favorite: true,
      note: "keep exclusion",
    });
    const before = structuredClone(c.plan);
    const content = adoptedContent(
      c.plan,
      {
        selections: [
          { courseId: "math", sectionId: "math-c", reason: "test" },
          { courseId: "code", sectionId: "code-a", reason: "test" },
        ],
        explanation: "test",
      },
      "AI copy",
    );
    expect(content.shortlist[0]!.items.map((i) => i.sectionId)).toEqual([
      "math-c",
      "math-a",
      "math-b",
    ]);
    expect(content.shortlist[0]!.items[0]!.note).toBe("作为时间备选");
    expect(content.shortlist[0]!.items[2]!.disposition).toBe("excluded");
    expect(c.plan).toEqual(before);
  });
});
describe("reconciliation", () => {
  it("reports selected field changes, archives cancelled notes and preserves the old plan", () => {
    const c = context();
    const before = structuredClone(c);
    const changes = diff({ ...c, target: updatedSnapshot });
    expect(changes).toHaveLength(3);
    const next = reconcile(c, updatedSnapshot, "2026-09-07T00:00:00Z");
    expect(next.revision).toBe(2);
    expect(next.history[0]!.previousItem!.note).toBe("作为时间备选");
    expect(
      next.content.shortlist[0]!.items.map((i) => i.sectionId),
    ).not.toContain("math-c");
    expect(c).toEqual(before);
  });
  it("retains missing courses as unresolved and moves newly enrolled candidates to history", () => {
    const c = context();
    const target = structuredClone(updatedSnapshot);
    target.courses = target.courses.filter((c) => c.id !== "math");
    target.sections = target.sections.filter((s) => s.courseId !== "math");
    target.meta.courseCount = target.courses.length;
    target.meta.sectionCount = target.sections.length;
    target.enrolledSectionIds = known(["sport-a", "code-a"]);
    const next = reconcile(c, Snapshot.parse(target), "2026-09-07T00:00:00Z");
    expect(next.unresolvedCourseIds).toEqual(["math"]);
    expect(next.content.shortlist.some((c) => c.courseId === "code")).toBe(
      false,
    );
    expect(next.history.some((h) => h.reason === "enrolled")).toBe(true);
    expect(
      next.history.filter((h) => h.reason === "course_missing"),
    ).toHaveLength(2);
  });
});

it("cross-part calendars need evidence and not-applicable exam fields do not certify availability", () => {
  const c = context();
  const section = c.snapshot.sections.find((s) => s.id === "code-a")!;
  section.partIds = ["winter"];
  if (section.meetings.state !== "known")
    throw new Error("Fixture meeting missing");
  section.meetings.value[0]!.slot.partId = "winter";
  expect(codes(validateProposal(c, primarySelections(c.plan)))).toContain(
    "TEACHING_TIME_UNKNOWN",
  );
  c.snapshot.term.parts[0]!.weekOneMonday = known("2026-09-07");
  c.snapshot.term.parts[1]!.weekOneMonday = known("2026-09-07");
  expect(codes(validateProposal(c, primarySelections(c.plan)))).toContain(
    "TEACHING_OVERLAP",
  );
  c.snapshot.term.parts[1]!.weekOneMonday = known("2026-12-07");
  expect(codes(validateProposal(c, primarySelections(c.plan)))).not.toContain(
    "TEACHING_OVERLAP",
  );
  section.exams = { state: "not_applicable", reason: "Unverified assumption" };
  expect(codes(validateProposal(c, primarySelections(c.plan)))).toContain(
    "EXAM_UNKNOWN",
  );
});

it("uses observed common-semester week mappings without inventing calendar dates", async () => {
  const { calendarOverlap } = await import("../../src/domain/planning.js");
  const snapshot = structuredClone(originalSnapshot);
  snapshot.term.parts = [
    {
      id: "autumn",
      label: "秋",
      weekOneMonday: { state: "unknown", reason: "not_verified" },
      semesterWeeks: known([{ partWeek: 1, semesterWeek: 1 }]),
    },
    {
      id: "winter",
      label: "冬",
      weekOneMonday: { state: "unknown", reason: "not_verified" },
      semesterWeeks: known([{ partWeek: 1, semesterWeek: 9 }]),
    },
  ];
  const a = { ...slot, weeks: [1] },
    b = { ...a, partId: "winter" };
  expect(calendarOverlap(snapshot, a, b)).toBe(false);
  snapshot.term.parts[1]!.semesterWeeks = known([
    { partWeek: 1, semesterWeek: 1 },
  ]);
  expect(calendarOverlap(snapshot, a, b)).toBe(true);
  expect(calendarOverlap(snapshot, { ...a, weeks: [2] }, b)).toBe(null);
});

it("warns about missing exams without blocking proposals or losing known conflicts", () => {
  const c = context();
  const missing = c.snapshot.sections.find((s) => s.id === "math-a")!;
  missing.exams = { state: "unknown", reason: "not_provided" };
  const report = validateProposal(c, primarySelections(c.plan));
  expect(report.status).toBe("valid");
  expect(report.issues.find((i) => i.code === "EXAM_UNKNOWN")).toMatchObject({
    severity: "warning",
    sectionIds: [missing.id],
  });
  expect(missing.exams.state).toBe("unknown");
  const knownSections = c.snapshot.sections.filter(
    (s) =>
      s.id === "code-a" ||
      (c.snapshot.enrolledSectionIds.state === "known" &&
        c.snapshot.enrolledSectionIds.value.includes(s.id)),
  );
  expect(knownSections.length).toBeGreaterThanOrEqual(2);
  for (const section of knownSections)
    section.exams = known([
      {
        startsAt: "2026-11-01T01:00:00Z",
        endsAt: "2026-11-01T03:00:00Z",
        location: { state: "unknown", reason: "not_provided" },
      },
    ]);
  const conflicted = validateProposal(c, primarySelections(c.plan));
  expect(conflicted.status).toBe("invalid");
  expect(
    conflicted.issues.find((i) => i.code === "EXAM_CONFLICT")?.severity,
  ).toBe("error");
});
