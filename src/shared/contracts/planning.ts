import { z } from "zod";
import { TeachingSlot } from "./catalog.js";
import {
  Credits,
  DerivationStamp,
  field,
  Id,
  IdList,
  Note,
  PlanSchemaVersion,
  Revision,
  Text,
  Timestamp,
  unique,
} from "./common.js";

export const SelectionItem = z.strictObject({
  sectionId: Id,
  disposition: z.enum(["candidate", "excluded", "reference"]),
  favorite: z.boolean(),
  note: Note,
});
export const ShortlistCourse = z.strictObject({
  courseId: Id,
  favorite: z.boolean(),
  note: Note,
  items: z
    .array(SelectionItem)
    .max(1000)
    .refine(
      (items) => unique(items.map((item) => item.sectionId)),
      "Duplicate section preference",
    ),
});
export const PreferenceCriterion = z.enum([
  "candidate_order",
  "compact_days",
  "free_mornings",
  "campus",
  "review_evidence",
]);
export const HardConstraint = z.discriminatedUnion("kind", [
  z.strictObject({
    id: Id,
    kind: z.literal("blocked_time"),
    slot: TeachingSlot,
  }),
  z.strictObject({ id: Id, kind: z.literal("no_teaching_overlap") }),
  z.strictObject({ id: Id, kind: z.literal("credit_limit"), maximum: Credits }),
  z.strictObject({
    id: Id,
    kind: z.literal("campus"),
    campuses: z.array(Text).min(1).max(20).refine(unique),
  }),
]);
const RuleList = z
  .array(HardConstraint)
  .max(200)
  .refine((items) => unique(items.map((item) => item.id)));
const Criteria = z.array(PreferenceCriterion).max(5).refine(unique);
export const PreferenceProfile = z.strictObject({
  orderedCriteria: Criteria,
  hardConstraints: RuleList,
  courseOverrides: z
    .array(
      z.strictObject({
        courseId: Id,
        orderedCriteria: Criteria,
        hardConstraints: RuleList.refine(
          (rules) => rules.every((rule) => rule.kind !== "credit_limit"),
          "Total credit limits belong to the plan scope",
        ),
      }),
    )
    .max(500)
    .refine((items) => unique(items.map((item) => item.courseId))),
  unresolvedClauses: z.array(Text).max(100),
  textConfirmed: z.boolean(),
  creditLimit: Credits.nullable(),
  preferredCampuses: z.array(Text).max(20).refine(unique),
  timePreferences: z
    .array(
      z.strictObject({
        id: Id,
        slot: TeachingSlot,
        strength: z.enum(["prefer_free", "avoid", "blocked"]),
      }),
    )
    .max(200)
    .refine((items) => unique(items.map((item) => item.id))),
  note: Note,
});
export const Preferences = PreferenceProfile;
export const PlanContent = z
  .strictObject({
    name: z.string().min(1).max(100),
    shortlist: z
      .array(ShortlistCourse)
      .max(500)
      .refine(
        (items) => unique(items.map((item) => item.courseId)),
        "Duplicate shortlist course",
      ),
    preferences: Preferences,
  })
  .refine(
    (content) =>
      unique(
        content.shortlist.flatMap((course) =>
          course.items.map((item) => item.sectionId),
        ),
      ),
    "A section cannot belong to multiple shortlist courses",
  );
export const ArchivedSelection = z.strictObject({
  courseId: Id,
  courseLabel: Text,
  sectionLabel: Text.nullable(),
  previousItem: SelectionItem.nullable(),
  courseNote: Note,
  previousSnapshotId: Id,
  reason: z.enum(["section_cancelled", "course_missing", "enrolled"]),
  at: Timestamp,
});
export const Plan = z.strictObject({
  schemaVersion: PlanSchemaVersion,
  id: Id,
  termId: Id,
  snapshotId: Id,
  revision: Revision,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  content: PlanContent,
  unresolvedCourseIds: IdList,
  history: z.array(ArchivedSelection).max(10000),
});
export const PlanSummary = Plan.pick({
  id: true,
  termId: true,
  snapshotId: true,
  revision: true,
  updatedAt: true,
}).extend({ name: z.string().min(1).max(100) });

export const IssueCode = z.enum([
  "COURSE_VOLUNTEER_LIMIT",
  "TIME_GROUP_VOLUNTEER_LIMIT",
  "TIME_GROUP_UNKNOWN",
  "RULES_UNVERIFIED",
  "EXAM_CONFLICT",
  "EXAM_UNKNOWN",
  "CREDITS_UNKNOWN",
  "CREDIT_LIMIT_MISSING",
  "CREDIT_LIMIT_EXCEEDED",
  "TEACHING_OVERLAP",
  "TEACHING_TIME_UNKNOWN",
  "BLOCKED_TIME",
  "BASELINE_UNKNOWN",
  "BASELINE_LOCKED",
  "SECTION_UNAVAILABLE",
  "OFFICIAL_STATE_UNKNOWN",
  "SECTION_MISSING",
  "COURSE_MISSING",
  "NO_CANDIDATE",
  "SELECTION_CODE_UNKNOWN",
  "SNAPSHOT_STALE",
  "IMPORTED_SNAPSHOT",
  "FIXTURE_ONLY",
  "PROPOSAL_COVERAGE",
  "CANDIDATE_MEMBERSHIP",
  "PREFERENCES_UNCONFIRMED",
  "CAMPUS_UNKNOWN",
  "CAMPUS_MISMATCH",
  "PREFERENCE_WARNING",
]);
export const ValidationIssue = z.strictObject({
  id: Id,
  code: IssueCode,
  severity: z.enum(["error", "unknown", "warning"]),
  courseIds: IdList,
  sectionIds: IdList,
  timeGroupId: Id.nullable(),
  slot: TeachingSlot.nullable(),
  message: Text,
});
export const ValidationReport = z
  .strictObject({
    status: z.enum(["valid", "invalid", "indeterminate"]),
    issues: z.array(ValidationIssue).max(10000),
  })
  .superRefine((report, ctx) => {
    const expected = report.issues.some((issue) => issue.severity === "error")
      ? "invalid"
      : report.issues.some((issue) => issue.severity === "unknown")
        ? "indeterminate"
        : "valid";
    if (report.status !== expected)
      ctx.addIssue({
        code: "custom",
        message: "Validation status contradicts issue severities",
      });
  });
export const CreditSummary = z.strictObject({
  knownTotal: Credits,
  missingCourseIds: IdList,
  limit: Credits.nullable(),
  includesBaseline: z.literal(true),
});
export const Projection = z.strictObject({
  stamp: DerivationStamp,
  primarySectionIds: IdList,
  baselineSectionIds: IdList,
  alternatives: z
    .array(z.strictObject({ courseId: Id, sectionIds: IdList }))
    .max(500),
  entries: z
    .array(
      z.strictObject({
        sectionId: Id,
        courseId: Id,
        role: z.enum(["baseline", "primary", "alternative"]),
        slot: TeachingSlot,
        location: field(Text),
      }),
    )
    .max(20000),
  credits: CreditSummary,
  validation: ValidationReport,
});
export const Draft = z.strictObject({
  stamp: DerivationStamp,
  entries: z
    .array(
      z.strictObject({
        courseId: Id,
        sectionId: Id,
        // Invalid fourth+ preferences remain visible for validation; no truncation.
        priority: z.number().int().positive(),
        timeGroupIds: field(IdList),
      }),
    )
    .max(10000),
  validation: ValidationReport,
});
export const Arrangement = z.strictObject({
  id: Id,
  stamp: DerivationStamp,
  sectionIds: IdList,
  baselineSectionIds: IdList,
  credits: CreditSummary,
  validation: ValidationReport,
});
export const FillingChecklist = z
  .strictObject({
    stamp: DerivationStamp,
    generatedAt: Timestamp,
    snapshotCapturedAt: Timestamp,
    adviseOnly: z.literal(true),
    entries: z
      .array(
        z.strictObject({
          courseId: Id,
          courseCode: Text,
          courseTitle: Text,
          sectionId: Id,
          selectionCode: Text,
          priority: z.number().int().min(1).max(3),
        }),
      )
      .min(1)
      .max(1500),
    excluded: z
      .array(
        z.strictObject({
          sectionId: Id,
          reasons: z.array(ValidationIssue).min(1).max(100),
        }),
      )
      .max(10000),
    validation: ValidationReport,
    admissionRisk: z.literal("not_evaluable"),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (value.validation.status !== "valid")
      fail("An executable checklist must pass validation");
    const ids = value.entries.map((entry) => entry.sectionId);
    if (
      !unique(ids) ||
      !unique(
        value.entries.map((entry) => `${entry.courseId}/${entry.priority}`),
      )
    )
      fail("Duplicate checklist section or course priority");
    if (
      !unique(value.excluded.map((entry) => entry.sectionId)) ||
      value.excluded.some((entry) => ids.includes(entry.sectionId))
    )
      fail("Included and excluded sections must be distinct");
  });

export const ReconciliationChange = z.strictObject({
  id: Id,
  kind: z.enum([
    "section_cancelled",
    "course_missing",
    "course_changed",
    "section_changed",
    "status_changed",
    "baseline_changed",
    "rules_changed",
  ]),
  courseId: Id.nullable(),
  sectionId: Id.nullable(),
  fields: z.array(Text).max(30),
  before: z.array(Text).max(30),
  after: z.array(Text).max(30),
  suggestedSectionIds: IdList,
});
export const ReconciliationPreview = z
  .strictObject({
    id: Id,
    planId: Id,
    expectedRevision: Revision,
    fromSnapshotId: Id,
    targetSnapshotId: Id,
    expiresAt: Timestamp,
    changes: z.array(ReconciliationChange).max(10000),
    proposedPlan: Plan,
  })
  .superRefine((preview, ctx) => {
    if (
      preview.proposedPlan.id !== preview.planId ||
      preview.proposedPlan.snapshotId !== preview.targetSnapshotId ||
      preview.proposedPlan.revision !== preview.expectedRevision + 1 ||
      preview.fromSnapshotId === preview.targetSnapshotId
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent reconciliation transition",
      });
    if (!unique(preview.changes.map((change) => change.id)))
      ctx.addIssue({
        code: "custom",
        message: "Duplicate reconciliation change IDs",
      });
  });

export type PlanData = z.infer<typeof Plan>;
export type ArrangementData = z.infer<typeof Arrangement>;
export type ValidationData = z.infer<typeof ValidationReport>;
