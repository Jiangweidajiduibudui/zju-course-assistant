import {
  Snapshot,
  type SnapshotData,
} from "../../src/shared/contracts/catalog.js";
import { Plan } from "../../src/shared/contracts/planning.js";

export const at = "2026-09-06T00:00:00Z";
export const known = <T>(value: T) => ({ state: "known" as const, value });
export const unknown = { state: "unknown", reason: "not_verified" } as const;
const termId = "term-synthetic-2026";
const weeks = Array.from({ length: 8 }, (_, index) => index + 1);
const courseRows = [
  ["math", "SYN-101", "微积分基础", 4, "基础课程"],
  ["code", "SYN-102", "程序设计实践", 3, "专业课程"],
  ["design", "SYN-103", "设计与生活", 2, "通识课程"],
  ["writing", "SYN-104", "学术写作", 2, "通识课程"],
  ["sport", "SYN-105", "体育基础", 1, "公共课程"],
] as const;

// Every name, section code, place and number in this module is invented.
// These are UI scenarios, never upstream observations or domain test oracles.
const sectionRows = [
  ["math-a", "math", "示例教师甲", 1, 1, 2, 12, "东区 201"],
  ["math-b", "math", "示例教师乙", 2, 3, 4, 0, "东区 203"],
  ["math-c", "math", "示例教师丙", 3, 6, 7, 8, "西区 101"],
  ["math-d", "math", "示例教师丁", 4, 3, 4, 6, "东区 205"],
  ["code-a", "code", "示例教师戊", 1, 1, 2, 9, "东区机房"],
  ["code-b", "code", "示例教师己", 4, 6, 8, 14, "东区机房"],
  ["design-a", "design", "示例教师庚", 5, 3, 4, 5, "西区工作室"],
  ["writing-a", "writing", "示例教师辛", 3, 9, 10, 3, "东区 301"],
  ["sport-a", "sport", "示例教师壬", 2, 6, 7, 0, "东区体育场"],
] as const;

export const originalSnapshot = Snapshot.parse({
  meta: {
    schemaVersion: 1,
    id: "snapshot-demo-1",
    termId,
    capturedAt: at,
    provenance: { origin: "fixture", synthetic: true, sources: [] },
    availability: "unknown",
    coverage: "complete",
    courseCount: courseRows.length,
    sectionCount: sectionRows.length,
  },
  term: {
    id: termId,
    label: "2026–2027 秋冬 · 演示学期",
    academicYearStart: 2026,
    upstreamCode: "SYNTHETIC",
    timezone: "Asia/Shanghai",
    parts: [
      { id: "autumn", label: "秋", weekOneMonday: unknown },
      { id: "winter", label: "冬", weekOneMonday: unknown },
    ],
  },
  courses: courseRows.map(([id, code, title, credits, category]) => ({
    id,
    termId,
    code,
    title,
    credits: known(credits),
    category: known({ code: id, label: category }),
    college: known("示例学院"),
    hasPrerequisite: known(id === "code"),
  })),
  sections: sectionRows.map(
    ([
      id,
      courseId,
      name,
      weekday,
      startPeriod,
      endPeriod,
      remaining,
      location,
    ]) => ({
      id,
      courseId,
      termId,
      selectionCode: known(`SYNTH-${id.toUpperCase()}`),
      listedInCatalog: true,
      teachers: known([
        { id: `teacher-${id}`, name, college: known("示例学院") },
      ]),
      partIds: ["autumn"],
      meetings: known([
        {
          slot: {
            partId: "autumn",
            weeks: id === "design-a" ? [5, 6, 7, 8] : weeks,
            weekday,
            startPeriod,
            endPeriod,
          },
          location: known(location),
        },
      ]),
      exams:
        courseId === "writing"
          ? unknown
          : known([
              {
                startsAt: `2026-11-${courseId === "math" ? "02" : courseId === "code" ? "03" : courseId === "design" ? "04" : "05"}T09:00:00+08:00`,
                endsAt: `2026-11-${courseId === "math" ? "02" : courseId === "code" ? "03" : courseId === "design" ? "04" : "05"}T11:00:00+08:00`,
                location: unknown,
              },
            ]),
      weeklyHours: known(endPeriod - startPeriod + 1),
      campus: known(location.startsWith("西") ? "西区" : "东区"),
      deliveryMode: known("线下"),
      targetAudience: unknown,
      internationalization: unknown,
      teachingMethod: unknown,
      quotas: {
        overall: {
          remaining: id === "writing-a" ? unknown : known(remaining),
          capacity: known(40),
        },
        male: { remaining: unknown, capacity: unknown },
        female: { remaining: unknown, capacity: unknown },
      },
      pending: {
        major: unknown,
        all:
          id === "writing-a"
            ? unknown
            : known(id === "math-a" ? 36 : id === "math-d" ? 0 : 24),
      },
      officialState: id === "math-b" ? "unavailable" : "available",
      officialTimeConflict: unknown,
      officialStateLabel: known(
        id === "math-b" ? "示例：不可选" : "示例：可选",
      ),
      volunteerTimeGroupIds: unknown,
    }),
  ),
  enrolledSectionIds: known(["sport-a"]),
  officialVolunteers: unknown,
  academicContext: { officialCreditLimit: unknown },
  rules: {
    id: "rules-demo",
    verification: "provisional",
    courseVolunteerLimit: 3,
    timeGroupVolunteerLimit: 3,
    evidence: [],
    unresolved: ["time_group_mapping", "priority_mapping", "rule_window"],
  },
});

const updated: SnapshotData = structuredClone(originalSnapshot);
updated.meta.id = "snapshot-demo-2";
updated.meta.capturedAt = "2026-09-06T01:30:00Z";
updated.sections = updated.sections
  .filter((section) => section.id !== "math-c")
  .map((section) => {
    if (section.id === "math-a")
      section.meetings = known([
        {
          slot: {
            partId: "autumn",
            weeks,
            weekday: 3,
            startPeriod: 1,
            endPeriod: 2,
          },
          location: known("东区 202"),
        },
      ]);
    if (section.id === "code-a") {
      section.quotas.overall.remaining = known(0);
      section.officialState = "unavailable";
      section.officialStateLabel = known("示例：不可选");
    }
    return section;
  });
updated.meta.sectionCount = updated.sections.length;
export const updatedSnapshot = Snapshot.parse(updated);

export const initialPlans = [
  Plan.parse({
    schemaVersion: 2,
    id: "plan-main",
    termId,
    snapshotId: originalSnapshot.meta.id,
    revision: 1,
    createdAt: at,
    updatedAt: at,
    content: {
      name: "秋冬 · 主计划",
      shortlist: [
        {
          courseId: "math",
          favorite: true,
          note: "先比较授课时间",
          items: ["math-a", "math-c"].map((sectionId) => ({
            sectionId,
            disposition: "candidate",
            favorite: false,
            note: sectionId === "math-c" ? "作为时间备选" : "",
          })),
        },
        {
          courseId: "code",
          favorite: false,
          note: "",
          items: [
            {
              sectionId: "code-a",
              disposition: "candidate",
              favorite: false,
              note: "关注实践安排",
            },
          ],
        },
      ],
      preferences: {
        orderedCriteria: [],
        hardConstraints: [],
        courseOverrides: [],
        unresolvedClauses: [],
        textConfirmed: false,
        creditLimit: 18,
        preferredCampuses: [],
        timePreferences: [],
        note: "",
      },
    },
    unresolvedCourseIds: [],
    history: [],
  }),
];
