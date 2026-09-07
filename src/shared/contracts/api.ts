import { z } from "zod";
import {
  Course,
  OfficialDetail,
  Section,
  Snapshot,
  SnapshotMeta,
  Term,
} from "./catalog.js";
import {
  Ack,
  Empty,
  type ErrorCode,
  Id,
  IdList,
  PageQuery,
  PlanRef,
  page,
  Revision,
  Text,
} from "./common.js";
import {
  Explanation,
  Interpretation,
  PlanningJob,
  SummaryRecord,
} from "./llm.js";
import { ArchiveInput } from "./migration.js";
import {
  Bootstrap,
  ClearPreview,
  ClearResult,
  ClearScope,
  CredentialInput,
  CredentialStatus,
  Diagnostics,
  ImportPreview,
  ImportResult,
  Job,
  LocalArchive,
  SessionStatus,
  Settings,
  SettingsInput,
} from "./operations.js";
import {
  Draft,
  FillingChecklist,
  Plan,
  PlanContent,
  PlanSummary,
  Projection,
  ReconciliationPreview,
} from "./planning.js";
import { Comment, Review, ReviewFetchResult, TeacherMatch } from "./reviews.js";

export const PlanView = z.strictObject({
  plan: Plan,
  latestLiveSnapshotId: Id.nullable(),
  requiresReconciliation: z.boolean(),
});
export const SnapshotOverview = z.strictObject({
  meta: SnapshotMeta,
  term: Term,
  enrolledSectionIds: Snapshot.shape.enrolledSectionIds,
  officialVolunteers: Snapshot.shape.officialVolunteers,
  academicContext: Snapshot.shape.academicContext,
  rules: Snapshot.shape.rules,
});
export const SnapshotQuery = z.strictObject({ snapshotId: Id });
export const VersionQuery = z.strictObject({
  expectedRevision: z.string().regex(/^[1-9][0-9]{0,14}$/),
});
const sourceId = z.enum(["primary", "fallback"]);

type EndpointDefinition = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  summary: string;
  params: z.ZodObject;
  query: z.ZodObject;
  body: z.ZodType | null;
  response: z.ZodType;
  successStatus: 200 | 201 | 202;
  auth: "bootstrap" | "local-token";
  idempotencyKey: boolean;
  availability: "available" | "reserved";
  errors: Array<z.infer<typeof ErrorCode>>;
};
const endpoint = <const B extends z.ZodType | null, const R extends z.ZodType>(
  value: Omit<
    EndpointDefinition,
    | "auth"
    | "idempotencyKey"
    | "availability"
    | "params"
    | "query"
    | "successStatus"
    | "errors"
    | "body"
    | "response"
  > &
    Partial<
      Pick<
        EndpointDefinition,
        | "auth"
        | "idempotencyKey"
        | "availability"
        | "params"
        | "query"
        | "successStatus"
        | "errors"
      >
    > & { body: B; response: R },
): EndpointDefinition & { body: B; response: R } => ({
  auth: "local-token",
  idempotencyKey: false,
  availability: "available",
  params: Empty,
  query: Empty,
  successStatus: 200,
  errors: [],
  ...value,
});

// Route registry only; implementations must bind these schemas in Hono later.
export const api = {
  bootstrap: endpoint({
    method: "GET",
    path: "/api/bootstrap",
    summary:
      "Same-origin bootstrap; issue a local request token, never a school token",
    body: null,
    response: Bootstrap,
    auth: "bootstrap",
  }),
  getSession: endpoint({
    method: "GET",
    path: "/api/session",
    summary: "Read school session status without authentication material",
    body: null,
    response: SessionStatus,
  }),
  startLogin: endpoint({
    method: "POST",
    path: "/api/session/login",
    summary: "Start the owned headed CAS login window",
    body: Empty,
    response: Job,
    successStatus: 202,
    idempotencyKey: true,
    errors: ["OPERATION_IN_PROGRESS"],
  }),
  logout: endpoint({
    method: "DELETE",
    path: "/api/session",
    summary: "Cancel login/sync and erase school session; preserve plans",
    body: Empty,
    response: SessionStatus,
  }),
  getJob: endpoint({
    method: "GET",
    path: "/api/jobs/{jobId}",
    summary: "Poll a login/sync job",
    params: z.strictObject({ jobId: Id }),
    body: null,
    response: Job,
  }),
  cancelJob: endpoint({
    method: "POST",
    path: "/api/jobs/{jobId}/cancel",
    summary:
      "Cancel uncommitted job work without publishing a partial snapshot",
    params: z.strictObject({ jobId: Id }),
    body: Empty,
    response: Job,
  }),
  listTerms: endpoint({
    method: "GET",
    path: "/api/terms",
    summary: "Read available terms; dynamic school codes and part labels",
    query: PageQuery,
    body: null,
    response: page(Term),
    errors: [
      "SESSION_REQUIRED",
      "SESSION_EXPIRED",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_SCHEMA_CHANGED",
    ],
  }),
  startSync: endpoint({
    method: "POST",
    path: "/api/sync-jobs",
    summary:
      "Read a complete term and atomically publish an immutable snapshot",
    body: z.strictObject({ termId: Id }),
    response: Job,
    successStatus: 202,
    idempotencyKey: true,
    errors: [
      "SESSION_REQUIRED",
      "SESSION_EXPIRED",
      "SESSION_SCOPE_CHANGED",
      "OPERATION_IN_PROGRESS",
    ],
  }),
  listSnapshots: endpoint({
    method: "GET",
    path: "/api/snapshots",
    summary: "List metadata and identify the latest live snapshot for one term",
    query: PageQuery.extend({ termId: Id }),
    body: null,
    response: page(SnapshotMeta).extend({
      latestLiveSnapshotId: Id.nullable(),
    }),
  }),
  getSnapshot: endpoint({
    method: "GET",
    path: "/api/snapshots/{snapshotId}",
    summary: "Read snapshot context; catalog rows are paginated separately",
    params: z.strictObject({ snapshotId: Id }),
    body: null,
    response: SnapshotOverview,
  }),
  listCourses: endpoint({
    method: "GET",
    path: "/api/courses",
    summary:
      "Search one immutable snapshot; section filters match a single section",
    query: PageQuery.extend({
      snapshotId: Id,
      q: Text.optional(),
      courseCode: Text.optional(),
      teacher: Text.optional(),
      categoryCode: Text.optional(),
      college: Text.optional(),
      location: Text.optional(),
      partId: Id.optional(),
      weekday: z
        .string()
        .regex(/^[1-7]$/)
        .optional(),
      period: z
        .string()
        .regex(/^(?:[1-9]|1[0-3])$/)
        .optional(),
      availableOnly: z.enum(["true", "false"]).optional(),
    }),
    body: null,
    response: page(Course).extend({ snapshotId: Id }),
  }),
  listSections: endpoint({
    method: "GET",
    path: "/api/courses/{courseId}/sections",
    summary:
      "Read distinct teaching sections; do not merge time-equivalent classes",
    params: z.strictObject({ courseId: Id }),
    query: PageQuery.extend({ snapshotId: Id }),
    body: null,
    response: page(Section).extend({ snapshotId: Id }),
  }),
  getSection: endpoint({
    method: "GET",
    path: "/api/sections/{sectionId}",
    summary: "Read one section from the specified snapshot",
    params: z.strictObject({ sectionId: Id }),
    query: SnapshotQuery,
    body: null,
    response: Section,
  }),
  getCourseDetail: endpoint({
    availability: "reserved",
    method: "GET",
    path: "/api/courses/{courseId}/detail",
    summary:
      "Read an official course description; empty is a first-class result",
    params: z.strictObject({ courseId: Id }),
    query: SnapshotQuery,
    body: null,
    response: OfficialDetail,
    errors: ["SESSION_REQUIRED", "SESSION_EXPIRED", "UPSTREAM_UNAVAILABLE"],
  }),
  getTeacherDetail: endpoint({
    availability: "reserved",
    method: "GET",
    path: "/api/teachers/{teacherId}/detail",
    summary: "Read an official teacher description",
    params: z.strictObject({ teacherId: Id }),
    query: SnapshotQuery,
    body: null,
    response: OfficialDetail,
    errors: ["SESSION_REQUIRED", "SESSION_EXPIRED", "UPSTREAM_UNAVAILABLE"],
  }),
  listPlans: endpoint({
    method: "GET",
    path: "/api/plans",
    summary: "List plans in one term",
    query: PageQuery.extend({ termId: Id }),
    body: null,
    response: page(PlanSummary),
  }),
  createPlan: endpoint({
    method: "POST",
    path: "/api/plans",
    summary: "Create an empty plan or copy a revision of an existing plan",
    body: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("empty"),
        snapshotId: Id,
        name: z.string().min(1).max(100),
      }),
      z.strictObject({
        mode: z.literal("copy"),
        source: PlanRef,
        name: z.string().min(1).max(100),
      }),
    ]),
    response: PlanView,
    successStatus: 201,
    idempotencyKey: true,
    errors: ["REVISION_CONFLICT", "SNAPSHOT_MISMATCH"],
  }),
  getPlan: endpoint({
    method: "GET",
    path: "/api/plans/{planId}",
    summary: "Read plan and reconciliation state",
    params: z.strictObject({ planId: Id }),
    body: null,
    response: PlanView,
  }),
  updatePlan: endpoint({
    method: "PUT",
    path: "/api/plans/{planId}",
    summary:
      "Replace editable content with optimistic concurrency; never accept derived state",
    params: z.strictObject({ planId: Id }),
    body: z.strictObject({ expectedRevision: Revision, content: PlanContent }),
    response: PlanView,
    errors: ["REVISION_CONFLICT", "SNAPSHOT_MISMATCH", "VALIDATION_FAILED"],
  }),
  deletePlan: endpoint({
    method: "DELETE",
    path: "/api/plans/{planId}",
    summary: "Delete exactly one plan revision",
    params: z.strictObject({ planId: Id }),
    body: z.strictObject({ expectedRevision: Revision }),
    response: Ack,
    errors: ["REVISION_CONFLICT"],
  }),
  analyzePlan: endpoint({
    method: "GET",
    path: "/api/plans/{planId}/analysis",
    summary: "Derive projection and draft for one pinned plan revision",
    params: z.strictObject({ planId: Id }),
    query: VersionQuery,
    body: null,
    response: z.strictObject({ projection: Projection, draft: Draft }),
    errors: ["REVISION_CONFLICT"],
  }),
  previewReconciliation: endpoint({
    method: "POST",
    path: "/api/plans/{planId}/reconciliations",
    summary:
      "Preview all changes against the latest live snapshot; no plan mutation",
    params: z.strictObject({ planId: Id }),
    body: z.strictObject({ expectedRevision: Revision, targetSnapshotId: Id }),
    response: ReconciliationPreview,
    successStatus: 201,
    errors: ["REVISION_CONFLICT", "SNAPSHOT_MISMATCH"],
  }),
  applyReconciliation: endpoint({
    method: "POST",
    path: "/api/plans/{planId}/reconciliations/{previewId}/apply",
    summary: "Acknowledge every diff and atomically advance the plan snapshot",
    params: z.strictObject({ planId: Id, previewId: Id }),
    body: z.strictObject({
      expectedRevision: Revision,
      acknowledgedChangeIds: IdList,
    }),
    response: PlanView,
    idempotencyKey: true,
    errors: [
      "REVISION_CONFLICT",
      "PREVIEW_EXPIRED",
      "SNAPSHOT_MISMATCH",
      "VALIDATION_FAILED",
    ],
  }),
  exportChecklist: endpoint({
    method: "POST",
    path: "/api/plans/{planId}/checklist",
    summary:
      "Export manual instructions after current validation and explicit exclusion acknowledgement",
    params: z.strictObject({ planId: Id }),
    body: z.strictObject({
      expectedRevision: Revision,
      acknowledgedExcludedSectionIds: IdList,
    }),
    response: z.strictObject({
      checklist: FillingChecklist,
      text: z.string().max(200000),
    }),
    errors: [
      "REVISION_CONFLICT",
      "RECONCILIATION_REQUIRED",
      "VALIDATION_FAILED",
    ],
  }),
  lookupReviewMatch: endpoint({
    method: "POST",
    path: "/api/review-matches",
    summary: "Find teacher candidates in exactly one configured review source",
    body: z.strictObject({ snapshotId: Id, teacherId: Id, sourceId }),
    response: TeacherMatch,
    errors: [
      "EXTERNAL_ACCESS_DISABLED",
      "UPSTREAM_UNAVAILABLE",
      "ENDPOINT_REJECTED",
    ],
  }),
  confirmReviewMatch: endpoint({
    method: "PUT",
    path: "/api/review-matches/{matchId}",
    summary: "Confirm an offered teacher candidate in the same source",
    params: z.strictObject({ matchId: Id }),
    body: z.strictObject({ expectedRevision: Revision, externalTeacherId: Id }),
    response: TeacherMatch,
    errors: ["REVISION_CONFLICT", "VALIDATION_FAILED"],
  }),
  fetchReview: endpoint({
    method: "POST",
    path: "/api/reviews/fetch",
    summary:
      "Fetch or reuse one-source review data; failover requires an explicit new request",
    body: z.strictObject({
      snapshotId: Id,
      courseId: Id,
      matchId: Id,
      matchRevision: Revision,
      sourceId,
      refresh: z.boolean(),
    }),
    response: ReviewFetchResult,
    errors: [
      "EXTERNAL_ACCESS_DISABLED",
      "MATCH_CONFIRMATION_REQUIRED",
      "REVISION_CONFLICT",
      "UPSTREAM_UNAVAILABLE",
      "ENDPOINT_REJECTED",
    ],
  }),
  getReview: endpoint({
    method: "GET",
    path: "/api/reviews/{reviewId}",
    summary: "Read cached review metadata and course-specific grade matching",
    params: z.strictObject({ reviewId: Id }),
    body: null,
    response: Review,
  }),
  listComments: endpoint({
    method: "GET",
    path: "/api/reviews/{reviewId}/comments",
    summary: "Read cached anonymous comments at a stable review revision",
    params: z.strictObject({ reviewId: Id }),
    query: PageQuery.extend(VersionQuery.shape),
    body: null,
    response: page(Comment).extend({ reviewId: Id, reviewRevision: Revision }),
    errors: ["REVISION_CONFLICT"],
  }),
  confirmCourseGrade: endpoint({
    method: "PUT",
    path: "/api/reviews/{reviewId}/course-match",
    summary:
      "Confirm a course grade from this review; never borrow another course's GPA",
    params: z.strictObject({ reviewId: Id }),
    body: z.strictObject({ expectedRevision: Revision, externalCourseId: Id }),
    response: Review,
    errors: ["REVISION_CONFLICT", "VALIDATION_FAILED"],
  }),
  getSettings: endpoint({
    method: "GET",
    path: "/api/settings",
    summary: "Read non-secret settings",
    body: null,
    response: Settings,
  }),
  updateSettings: endpoint({
    method: "PUT",
    path: "/api/settings",
    summary:
      "Update settings; summary trigger is manual and keys are never persisted",
    body: z.strictObject({
      expectedRevision: Revision,
      content: SettingsInput,
    }),
    response: Settings,
    errors: ["REVISION_CONFLICT", "ENDPOINT_REJECTED"],
  }),
  putCredential: endpoint({
    method: "PUT",
    path: "/api/llm/endpoints/{endpointId}/credential",
    summary:
      "Set a process-memory-only model key; disable request-body logging",
    params: z.strictObject({ endpointId: Id }),
    body: CredentialInput,
    response: CredentialStatus,
  }),
  getCredentialStatus: endpoint({
    method: "GET",
    path: "/api/llm/endpoints/{endpointId}/credential",
    summary: "Read presence only; never return the key",
    params: z.strictObject({ endpointId: Id }),
    body: null,
    response: CredentialStatus,
  }),
  deleteCredential: endpoint({
    method: "DELETE",
    path: "/api/llm/endpoints/{endpointId}/credential",
    summary: "Forget a model key in memory",
    params: z.strictObject({ endpointId: Id }),
    body: Empty,
    response: CredentialStatus,
  }),
  summarizeComments: endpoint({
    method: "POST",
    path: "/api/llm/summarize",
    summary:
      "Manual summary; server loads and sanitizes comments, browser sends references only",
    body: z.strictObject({
      reviewId: Id,
      expectedReviewRevision: Revision,
      endpointId: Id,
    }),
    response: SummaryRecord,
    idempotencyKey: true,
    errors: [
      "REVISION_CONFLICT",
      "LLM_NOT_CONFIGURED",
      "EXTERNAL_ACCESS_DISABLED",
      "ENDPOINT_REJECTED",
      "VALIDATION_FAILED",
      "UPSTREAM_UNAVAILABLE",
      "LLM_OUTPUT_INVALID",
    ],
  }),
  getSummary: endpoint({
    method: "GET",
    path: "/api/reviews/{reviewId}/summary",
    summary: "Read a cached summary without triggering a model request",
    params: z.strictObject({ reviewId: Id }),
    query: VersionQuery.extend({ endpointId: Id }),
    body: null,
    response: SummaryRecord,
    errors: ["REVISION_CONFLICT"],
  }),
  interpretPreferences: endpoint({
    method: "POST",
    path: "/api/llm/interpret-preferences",
    summary: "Suggest editable preferences; never silently confirm hard rules",
    body: z.strictObject({ plan: PlanRef, endpointId: Id }),
    response: Interpretation,
    errors: [
      "LLM_NOT_CONFIGURED",
      "EXTERNAL_ACCESS_DISABLED",
      "ENDPOINT_REJECTED",
      "REVISION_CONFLICT",
      "LLM_OUTPUT_INVALID",
      "UPSTREAM_UNAVAILABLE",
    ],
  }),
  generateTimetable: endpoint({
    method: "POST",
    path: "/api/llm/generate-timetable",
    summary: "Start direct timetable proposal generation",
    body: z.strictObject({ plan: PlanRef, endpointId: Id }),
    response: PlanningJob,
    successStatus: 202,
    idempotencyKey: true,
    errors: [
      "LLM_NOT_CONFIGURED",
      "EXTERNAL_ACCESS_DISABLED",
      "ENDPOINT_REJECTED",
      "OPERATION_IN_PROGRESS",
      "REVISION_CONFLICT",
      "RECONCILIATION_REQUIRED",
      "VALIDATION_FAILED",
    ],
  }),
  getPlanningJob: endpoint({
    method: "GET",
    path: "/api/planning-jobs/{jobId}",
    summary: "Read proposal generation status",
    params: z.strictObject({ jobId: Id }),
    body: null,
    response: PlanningJob,
  }),
  cancelPlanningJob: endpoint({
    method: "POST",
    path: "/api/planning-jobs/{jobId}/cancel",
    summary: "Cancel and reject any late proposal",
    params: z.strictObject({ jobId: Id }),
    body: Empty,
    response: PlanningJob,
  }),
  adoptPlanningProposal: endpoint({
    method: "POST",
    path: "/api/planning-proposals/{proposalId}/adopt",
    summary: "Revalidate and create an independent plan atomically",
    params: z.strictObject({ proposalId: Id }),
    body: z.strictObject({ plan: PlanRef, name: z.string().min(1).max(100) }),
    response: PlanView,
    successStatus: 201,
    idempotencyKey: true,
    errors: [
      "REVISION_CONFLICT",
      "PREVIEW_EXPIRED",
      "RECONCILIATION_REQUIRED",
      "VALIDATION_FAILED",
    ],
  }),
  explainProjection: endpoint({
    method: "POST",
    path: "/api/llm/explain",
    summary: "Projection explanation slot; pure text and no state mutation",
    body: z.strictObject({ plan: PlanRef, question: Text, endpointId: Id }),
    response: Explanation,
    errors: [
      "LLM_NOT_CONFIGURED",
      "EXTERNAL_ACCESS_DISABLED",
      "ENDPOINT_REJECTED",
      "OPERATION_IN_PROGRESS",
      "REVISION_CONFLICT",
      "LLM_OUTPUT_INVALID",
      "UPSTREAM_UNAVAILABLE",
    ],
  }),
  exportLocalData: endpoint({
    method: "POST",
    path: "/api/local-data/export",
    summary:
      "Export selected plans and referenced snapshots, or all planning data; exclude secrets/reviews/settings",
    body: z.discriminatedUnion("scope", [
      z.strictObject({ scope: z.literal("all") }),
      z.strictObject({ scope: z.literal("plans"), planIds: IdList.min(1) }),
    ]),
    response: LocalArchive,
  }),
  previewImport: endpoint({
    method: "POST",
    path: "/api/local-data/import-previews",
    summary:
      "Validate an archive and preview additive import; no live-data mutation",
    body: z.strictObject({ archive: ArchiveInput }),
    response: ImportPreview,
    successStatus: 201,
    errors: [
      "IMPORT_INVALID",
      "UNSUPPORTED_SCHEMA_VERSION",
      "PAYLOAD_TOO_LARGE",
    ],
  }),
  applyImport: endpoint({
    method: "POST",
    path: "/api/local-data/import-previews/{previewId}/apply",
    summary:
      "Import as new IDs atomically; imported snapshots never become latest live snapshots",
    params: z.strictObject({ previewId: Id }),
    body: z.strictObject({
      expectedDataRevision: Revision,
      confirm: z.literal(true),
    }),
    response: ImportResult,
    idempotencyKey: true,
    errors: ["PREVIEW_EXPIRED", "REVISION_CONFLICT", "IMPORT_INVALID"],
  }),
  previewClear: endpoint({
    method: "POST",
    path: "/api/local-data/clear-previews",
    summary: "Preview planning-only or complete local deletion",
    body: z.strictObject({ scope: ClearScope }),
    response: ClearPreview,
    successStatus: 201,
  }),
  applyClear: endpoint({
    method: "POST",
    path: "/api/local-data/clear-previews/{previewId}/apply",
    summary:
      "Confirm the preview against the same data revision and delete atomically",
    params: z.strictObject({ previewId: Id }),
    body: z.strictObject({
      expectedDataRevision: Revision,
      confirm: z.literal(true),
    }),
    response: ClearResult,
    idempotencyKey: true,
    errors: ["PREVIEW_EXPIRED", "REVISION_CONFLICT"],
  }),
  exportDiagnostics: endpoint({
    method: "POST",
    path: "/api/diagnostics/export",
    summary: "Export only allowlisted operational metadata",
    body: Empty,
    response: Diagnostics,
  }),
} as const satisfies Record<string, EndpointDefinition>;

export type OperationId = keyof typeof api;
export type ApiResponse<K extends OperationId> = z.infer<
  (typeof api)[K]["response"]
>;
