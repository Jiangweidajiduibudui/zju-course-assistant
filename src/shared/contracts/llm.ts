import { z } from "zod";
import { Course, Section, Term } from "./catalog.js";
import {
  ApiError,
  Count,
  DerivationStamp,
  field,
  Id,
  IdList,
  Note,
  Revision,
  Source,
  sameStamp,
  Text,
  Timestamp,
  unique,
} from "./common.js";
import {
  Draft,
  HardConstraint,
  PreferenceCriterion,
  PreferenceProfile,
  Projection,
  ValidationReport,
} from "./planning.js";
import { Metric } from "./reviews.js";

// These are provider-facing, sanitized payloads, NOT browser-supplied prompts.
export const SummaryInput = z.strictObject({
  subjectRef: Id,
  untrustedComments: z
    .array(z.strictObject({ id: Id, text: z.string().min(1).max(2000) }))
    .min(1)
    .max(100),
  lowSampleThreshold: z.number().int().min(1).max(100),
});
export const SummaryOutput = z.strictObject({
  pros: z.array(Text).max(10),
  cons: z.array(Text).max(10),
  attendance: z.strictObject({
    status: z.enum(["reported", "insufficient_evidence"]),
    text: Text,
  }),
  sampleSize: Count,
  lowSample: z.boolean(),
});
export const SummaryExchange = z
  .strictObject({ input: SummaryInput, output: SummaryOutput })
  .superRefine(({ input, output }, ctx) => {
    if (
      output.sampleSize !== input.untrustedComments.length ||
      output.lowSample !==
        input.untrustedComments.length < input.lowSampleThreshold
    )
      ctx.addIssue({
        code: "custom",
        message: "Summary sample metadata must match supplied comments",
      });
  });
export const SummaryRecord = z.strictObject({
  id: Id,
  reviewId: Id,
  reviewRevision: Revision,
  endpointId: Id,
  endpointRevision: Revision,
  generatedAt: Timestamp,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  output: SummaryOutput,
});

export const InterpretationOutput = z.strictObject({
  suggestedHardConstraints: z.array(HardConstraint).max(200),
  suggestedCriteria: z.array(PreferenceCriterion).max(5).refine(unique),
  unresolvedClauses: z.array(Text).max(100),
  explanation: Text,
});
export const Interpretation = z.strictObject({
  stamp: DerivationStamp,
  synthetic: z.boolean(),
  output: InterpretationOutput,
});
export const InterpretPreferencesInput = z.strictObject({
  sanitizedText: Note,
  profile: PreferenceProfile,
});
export const PlanningReviewEvidence = z.strictObject({
  sectionId: Id,
  courseId: Id,
  reviewId: Id,
  reviewRevision: Revision,
  source: Source,
  synthetic: z.boolean(),
  teacherRating: field(Metric),
  courseGrade: field(Metric),
  summary: SummaryOutput.nullable(),
});
export const GenerateTimetableInput = z.strictObject({
  term: Term.optional(),
  profile: PreferenceProfile,
  targets: z
    .array(z.strictObject({ course: Course, orderedSectionIds: IdList.min(1) }))
    .min(1)
    .max(500),
  sections: z.array(Section).max(10000),
  baselineSectionIds: IdList,
  reviewEvidence: z.array(PlanningReviewEvidence).max(10000),
});
export const TimetableOutput = z.strictObject({
  selections: z
    .array(z.strictObject({ courseId: Id, sectionId: Id, reason: Text }))
    .min(1)
    .max(500)
    .refine(
      (items) =>
        unique(items.map((item) => item.courseId)) &&
        unique(items.map((item) => item.sectionId)),
    ),
  explanation: Text,
});
export const TimetableExchange = z
  .strictObject({ input: GenerateTimetableInput, output: TimetableOutput })
  .superRefine(({ input, output }, ctx) => {
    const targets = new Map(input.targets.map((t) => [t.course.id, t]));
    const sections = new Map(input.sections.map((s) => [s.id, s]));
    if (
      targets.size !== input.targets.length ||
      output.selections.length !== targets.size ||
      output.selections.some(
        (s) =>
          !targets.get(s.courseId)?.orderedSectionIds.includes(s.sectionId) ||
          sections.get(s.sectionId)?.courseId !== s.courseId ||
          input.baselineSectionIds.includes(s.sectionId),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Selections must cover exactly the supplied courses with their candidate sections",
      });
  });
export const PlanningProposal = z.strictObject({
  id: Id,
  jobId: Id,
  stamp: DerivationStamp,
  synthetic: z.boolean(),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  output: TimetableOutput,
  baselineSectionIds: IdList,
  validation: ValidationReport,
  analysis: z.strictObject({ projection: Projection, draft: Draft }).nullable(),
});
export const PlanningJob = z
  .strictObject({
    id: Id,
    stamp: DerivationStamp,
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "stale",
    ]),
    createdAt: Timestamp,
    finishedAt: Timestamp.nullable(),
    proposals: z.array(PlanningProposal).max(3),
    error: ApiError.nullable(),
  })
  .superRefine((job, ctx) => {
    const terminal = !["queued", "running"].includes(job.status);
    if (
      terminal !== (job.finishedAt !== null) ||
      (job.status === "succeeded"
        ? !job.proposals.length
        : job.proposals.length > 0) ||
      (job.status === "failed") !== (job.error !== null) ||
      job.proposals.some(
        (p) => p.jobId !== job.id || !sameStamp(p.stamp, job.stamp),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent planning job lifecycle",
      });
  });
export const GENERATION_LIMITS = {
  maxRequests: 2,
  deadlineMs: 60_000,
  maxInputCharacters: 120_000,
} as const;
export const ExplainProjectionInput = z.strictObject({
  subjectRef: Id,
  sanitizedQuestion: Text,
  sanitizedProjectionSummary: Text,
  sanitizedConflictDescriptions: z.array(Text).max(100),
});
export const ExplainProjectionOutput = z.strictObject({
  answer: z.string().min(1).max(8000),
});

export const llmTasks = {
  summarizeComments: {
    implementedIn: "P5",
    input: SummaryInput,
    output: SummaryOutput,
  },
  interpretPreferences: {
    implementedIn: "P5",
    input: InterpretPreferencesInput,
    output: InterpretationOutput,
  },
  generateTimetable: {
    implementedIn: "P5",
    input: GenerateTimetableInput,
    output: TimetableOutput,
  },
  explainProjection: {
    implementedIn: "P5",
    input: ExplainProjectionInput,
    output: ExplainProjectionOutput,
  },
} as const;
export const Explanation = z.strictObject({
  stamp: DerivationStamp,
  output: ExplainProjectionOutput,
});
