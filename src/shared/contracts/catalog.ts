import { z } from "zod";
import {
  Count,
  Credits,
  DateOnly,
  field,
  Id,
  IdList,
  Provenance,
  SchemaVersion,
  Source,
  Text,
  Timestamp,
  unique,
} from "./common.js";

export const TeachingSlot = z
  .strictObject({
    partId: Id,
    weeks: z
      .array(z.number().int().min(1).max(60))
      .min(1)
      .max(60)
      .refine(unique, "Duplicate weeks"),
    weekday: z.number().int().min(1).max(7),
    startPeriod: z.number().int().min(1).max(13),
    endPeriod: z.number().int().min(1).max(13),
  })
  .refine(
    (slot) => slot.endPeriod >= slot.startPeriod,
    "Reversed period range",
  );
export const Meeting = z.strictObject({
  slot: TeachingSlot,
  location: field(Text),
});
export const Exam = z
  .strictObject({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    location: field(Text),
  })
  .refine(
    (exam) => Date.parse(exam.endsAt) > Date.parse(exam.startsAt),
    "Exam must end after it starts",
  );
export const Term = z
  .strictObject({
    id: Id,
    label: Text,
    academicYearStart: z.number().int().min(2000).max(2200),
    upstreamCode: Text,
    timezone: z.literal("Asia/Shanghai"),
    parts: z
      .array(
        z.strictObject({
          id: Id,
          label: Text,
          weekOneMonday: field(DateOnly),
          semesterWeeks: field(
            z
              .array(
                z.strictObject({
                  partWeek: z.number().int().min(1).max(60),
                  semesterWeek: z.number().int().min(1).max(60),
                }),
              )
              .min(1)
              .max(60)
              .refine(
                (rows) =>
                  unique(rows.map((r) => r.partWeek)) &&
                  unique(rows.map((r) => r.semesterWeek)),
              ),
          ).optional(),
        }),
      )
      .min(1)
      .max(12),
  })
  .refine(
    (term) => unique(term.parts.map((part) => part.id)),
    "Duplicate term parts",
  );

export const Course = z.strictObject({
  id: Id,
  termId: Id,
  code: Text,
  title: Text,
  credits: field(Credits),
  category: field(z.strictObject({ code: Text, label: Text })),
  college: field(Text),
  hasPrerequisite: field(z.boolean()),
});
export const Teacher = z.strictObject({
  id: Id,
  name: Text,
  college: field(Text),
});
export const Quota = z.strictObject({
  remaining: field(Count),
  capacity: field(Count),
});
export const Section = z.strictObject({
  id: Id,
  courseId: Id,
  termId: Id,
  selectionCode: field(Text),
  listedInCatalog: z.boolean(),
  teachers: field(z.array(Teacher).max(30)),
  partIds: IdList,
  meetings: field(z.array(Meeting).max(200)),
  exams: field(z.array(Exam).max(30)),
  weeklyHours: field(z.number().nonnegative()),
  campus: field(Text),
  deliveryMode: field(Text),
  targetAudience: field(Text),
  internationalization: field(Text),
  teachingMethod: field(Text),
  quotas: z.strictObject({ overall: Quota, male: Quota, female: Quota }),
  pending: z.strictObject({ major: field(Count), all: field(Count) }),
  officialState: z.enum(["available", "unavailable", "unknown"]),
  officialTimeConflict: field(z.boolean()),
  officialStateLabel: field(Text),
  // Independent of teaching overlap; never derive from our timetable grid.
  volunteerTimeGroupIds: field(IdList),
});

export const Ruleset = z
  .strictObject({
    id: Id,
    verification: z.enum(["provisional", "verified"]),
    courseVolunteerLimit: z.literal(3),
    timeGroupVolunteerLimit: z.literal(3),
    evidence: z.array(Source).max(20),
    unresolved: z
      .array(z.enum(["time_group_mapping", "priority_mapping", "rule_window"]))
      .max(3)
      .refine(unique),
  })
  .refine(
    (rules) =>
      rules.verification !== "verified" ||
      (rules.evidence.length > 0 && rules.unresolved.length === 0),
    "Verified rules require evidence and no unresolved mappings",
  );
export const OfficialVolunteer = z.strictObject({
  sectionId: Id,
  priority: field(z.number().int().min(1).max(3)),
  courseGroupId: field(Id),
  timeGroupIds: field(IdList),
});
export const SnapshotMeta = z.strictObject({
  schemaVersion: SchemaVersion,
  id: Id,
  termId: Id,
  capturedAt: Timestamp,
  provenance: Provenance,
  availability: z.enum(["selection_open", "selection_closed", "unknown"]),
  coverage: z.literal("complete"),
  courseCount: Count,
  sectionCount: Count,
});
export const Snapshot = z
  .strictObject({
    meta: SnapshotMeta,
    term: Term,
    courses: z.array(Course).max(50000),
    sections: z.array(Section).max(200000),
    enrolledSectionIds: field(IdList),
    officialVolunteers: field(z.array(OfficialVolunteer).max(1000)),
    academicContext: z.strictObject({ officialCreditLimit: field(Credits) }),
    rules: Ruleset,
  })
  .superRefine((snapshot, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const courses = new Set(snapshot.courses.map((course) => course.id));
    const sections = new Set(snapshot.sections.map((section) => section.id));
    const parts = new Set(snapshot.term.parts.map((part) => part.id));
    if (snapshot.meta.termId !== snapshot.term.id)
      fail("Snapshot term mismatch");
    if (
      courses.size !== snapshot.courses.length ||
      sections.size !== snapshot.sections.length
    )
      fail("Duplicate catalog IDs");
    if (
      snapshot.meta.courseCount !== courses.size ||
      snapshot.meta.sectionCount !== sections.size
    )
      fail("Snapshot counts mismatch");
    for (const course of snapshot.courses)
      if (course.termId !== snapshot.term.id) fail("Cross-term course");
    for (const section of snapshot.sections) {
      if (!courses.has(section.courseId) || section.termId !== snapshot.term.id)
        fail("Invalid section ownership");
      if (section.partIds.some((id) => !parts.has(id)))
        fail("Unknown term part");
      if (
        section.meetings.state === "known" &&
        section.meetings.value.some(
          (meeting) => !section.partIds.includes(meeting.slot.partId),
        )
      )
        fail("Meeting outside section term parts");
    }
    if (
      snapshot.enrolledSectionIds.state === "known" &&
      snapshot.enrolledSectionIds.value.some((id) => !sections.has(id))
    )
      fail("Baseline section absent from snapshot");
    if (
      snapshot.officialVolunteers.state === "known" &&
      snapshot.officialVolunteers.value.some(
        (entry) => !sections.has(entry.sectionId),
      )
    )
      fail("Official volunteer absent from snapshot");
  });

export const OfficialDetail = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("content"), text: Text, source: Source }),
  z.strictObject({ status: z.literal("empty"), source: Source }),
  z.strictObject({ status: z.literal("unavailable"), reason: Text }),
]);

export type SnapshotData = z.infer<typeof Snapshot>;
export type SectionData = z.infer<typeof Section>;
