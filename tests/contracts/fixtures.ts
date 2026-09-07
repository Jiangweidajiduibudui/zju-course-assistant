import { Snapshot } from "../../src/shared/contracts/catalog.js";
import { Plan } from "../../src/shared/contracts/planning.js";

export const at = "2026-09-06T00:00:00Z";
export const known = <T>(value: T) => ({ state: "known" as const, value });
export const unknown = { state: "unknown", reason: "not_verified" } as const;
export const snapshot = Snapshot.parse({
  meta: {
    schemaVersion: 1,
    id: "snapshot-fixture-1",
    termId: "term-fixture",
    capturedAt: at,
    provenance: { origin: "fixture", synthetic: true, sources: [] },
    availability: "unknown",
    coverage: "complete",
    courseCount: 1,
    sectionCount: 2,
  },
  term: {
    id: "term-fixture",
    label: "Synthetic term",
    academicYearStart: 2026,
    upstreamCode: "synthetic",
    timezone: "Asia/Shanghai",
    parts: [
      { id: "part-fixture", label: "Synthetic part", weekOneMonday: unknown },
    ],
  },
  courses: [
    {
      id: "course-fixture",
      termId: "term-fixture",
      code: "SYNTH-001",
      title: "Synthetic course",
      credits: known(2.5),
      category: unknown,
      college: unknown,
      hasPrerequisite: known(true),
    },
  ],
  sections: ["section-a", "section-b"].map((id) => ({
    id,
    courseId: "course-fixture",
    termId: "term-fixture",
    selectionCode: known(`SYNTH-${id}`),
    listedInCatalog: true,
    teachers: known([
      { id: `teacher-${id}`, name: "Synthetic teacher", college: unknown },
    ]),
    partIds: ["part-fixture"],
    meetings: known([
      {
        slot: {
          partId: "part-fixture",
          weeks: [1, 2, 3],
          weekday: 1,
          startPeriod: 1,
          endPeriod: 2,
        },
        location: unknown,
      },
    ]),
    exams: unknown,
    weeklyHours: unknown,
    campus: unknown,
    deliveryMode: unknown,
    targetAudience: unknown,
    internationalization: unknown,
    teachingMethod: unknown,
    quotas: {
      overall: { remaining: known(0), capacity: known(30) },
      male: { remaining: unknown, capacity: unknown },
      female: { remaining: unknown, capacity: unknown },
    },
    pending: { major: unknown, all: unknown },
    officialState: "unknown",
    officialTimeConflict: known(false),
    officialStateLabel: unknown,
    volunteerTimeGroupIds: unknown,
  })),
  enrolledSectionIds: known([]),
  officialVolunteers: unknown,
  academicContext: { officialCreditLimit: unknown },
  rules: {
    id: "rules-provisional",
    verification: "provisional",
    courseVolunteerLimit: 3,
    timeGroupVolunteerLimit: 3,
    evidence: [],
    unresolved: ["time_group_mapping", "priority_mapping", "rule_window"],
  },
});
export const plan = Plan.parse({
  schemaVersion: 2,
  id: "plan-fixture",
  termId: "term-fixture",
  snapshotId: snapshot.meta.id,
  revision: 1,
  createdAt: at,
  updatedAt: at,
  content: {
    name: "Synthetic plan",
    shortlist: [
      {
        courseId: "course-fixture",
        favorite: false,
        note: "",
        items: ["section-a", "section-b"].map((sectionId) => ({
          sectionId,
          disposition: "candidate",
          favorite: false,
          note: "",
        })),
      },
    ],
    preferences: {
      orderedCriteria: [],
      hardConstraints: [],
      courseOverrides: [],
      unresolvedClauses: [],
      textConfirmed: false,
      creditLimit: 20,
      preferredCampuses: [],
      timePreferences: [],
      note: "",
    },
  },
  unresolvedCourseIds: [],
  history: [],
});
export const stamp = {
  planId: plan.id,
  planRevision: plan.revision,
  snapshotId: snapshot.meta.id,
  rulesetId: snapshot.rules.id,
};
