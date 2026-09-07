import { z } from "zod";
import { Snapshot } from "./catalog.js";
import {
  Ack,
  ApiError,
  Count,
  HttpsUrl,
  Id,
  IdList,
  PlanSchemaVersion,
  Revision,
  SchemaVersion,
  Text,
  Timestamp,
  unique,
} from "./common.js";
import { PlanSnapshot } from "./context.js";
import { Plan } from "./planning.js";

export const SessionStatus = z.strictObject({
  state: z.enum(["logged_out", "logging_in", "authenticated", "expired"]),
  checkedAt: Timestamp,
});
export const Job = z.union([
  z.strictObject({
    id: Id,
    kind: z.enum(["login", "sync"]),
    status: z.enum(["queued", "running"]),
    phase: Text,
    completedUnits: Count,
    totalUnits: Count.nullable(),
    createdAt: Timestamp,
  }),
  z.strictObject({
    id: Id,
    kind: z.literal("login"),
    status: z.literal("succeeded"),
    session: SessionStatus,
    finishedAt: Timestamp,
  }),
  z.strictObject({
    id: Id,
    kind: z.literal("sync"),
    status: z.literal("succeeded"),
    snapshotId: Id,
    finishedAt: Timestamp,
  }),
  z.strictObject({
    id: Id,
    kind: z.enum(["login", "sync"]),
    status: z.literal("failed"),
    error: ApiError,
    finishedAt: Timestamp,
  }),
  z.strictObject({
    id: Id,
    kind: z.enum(["login", "sync"]),
    status: z.literal("cancelled"),
    error: ApiError.nullable(),
    finishedAt: Timestamp,
  }),
]);
export const Endpoint = z.strictObject({
  id: Id,
  revision: Revision,
  label: Text,
  baseUrl: HttpsUrl,
  model: Text,
});
export const SettingsContent = z.strictObject({
  reviewsEnabled: z.boolean(),
  reviewSources: z.strictObject({ primary: HttpsUrl, fallback: HttpsUrl }),
  llmEnabled: z.boolean(),
  summaryTrigger: z.literal("manual"),
  endpoints: z
    .array(Endpoint)
    .max(10)
    .refine((items) => unique(items.map((item) => item.id))),
});
export const SettingsInput = SettingsContent.omit({ endpoints: true }).extend({
  endpoints: z
    .array(
      z.strictObject({
        id: Id.nullable(),
        label: Text,
        baseUrl: HttpsUrl,
        model: Text,
      }),
    )
    .max(10)
    .refine((items) =>
      unique(items.flatMap((item) => (item.id === null ? [] : [item.id]))),
    ),
});
export const Settings = z.strictObject({
  revision: Revision,
  content: SettingsContent,
});
export const CredentialInput = z.strictObject({
  apiKey: z.string().min(1).max(4096).meta({ writeOnly: true }),
});
export const CredentialStatus = z.strictObject({
  endpointId: Id,
  configured: z.boolean(),
  storage: z.literal("process_memory"),
});
export const Bootstrap = z.strictObject({
  localRequestToken: z.string().min(32).max(256),
  session: SessionStatus,
  settings: Settings,
  dataRevision: Revision,
  dataDirectory: Text,
  capabilities: z.strictObject({
    adviseOnly: z.literal(true),
    admissionRisk: z.literal("not_evaluable"),
    llm: z.strictObject({
      summarizeComments: z.boolean(),
      interpretPreferences: z.boolean(),
      generateTimetable: z.boolean(),
      explainProjection: z.boolean(),
    }),
  }),
});

export const LocalArchive = z
  .strictObject({
    format: z.literal("zju-course-assistant"),
    schemaVersion: PlanSchemaVersion,
    exportedAt: Timestamp,
    snapshots: z.array(Snapshot).max(1000),
    plans: z.array(Plan).max(1000),
  })
  .superRefine((archive, ctx) => {
    const snapshots = new Map(
      archive.snapshots.map((snapshot) => [snapshot.meta.id, snapshot]),
    );
    if (
      snapshots.size !== archive.snapshots.length ||
      !unique(archive.plans.map((plan) => plan.id))
    )
      ctx.addIssue({ code: "custom", message: "Duplicate archive IDs" });
    for (const plan of archive.plans) {
      const snapshot = snapshots.get(plan.snapshotId);
      if (!snapshot || !PlanSnapshot.safeParse({ plan, snapshot }).success)
        ctx.addIssue({
          code: "custom",
          message: "Invalid plan/snapshot references in archive",
        });
      for (const entry of plan.history) {
        const previous = snapshots.get(entry.previousSnapshotId);
        if (
          !previous ||
          previous.meta.termId !== plan.termId ||
          !previous.courses.some((course) => course.id === entry.courseId)
        )
          ctx.addIssue({
            code: "custom",
            message: "Archive history has no owning course/snapshot",
          });
        if (
          entry.previousItem &&
          !previous?.sections.some(
            (section) =>
              section.id === entry.previousItem?.sectionId &&
              section.courseId === entry.courseId,
          )
        )
          ctx.addIssue({
            code: "custom",
            message: "Invalid archived section reference",
          });
      }
    }
  });
export const ImportPreview = z.strictObject({
  id: Id,
  expiresAt: Timestamp,
  archiveHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedDataRevision: Revision,
  strategy: z.literal("add_as_new"),
  snapshotCount: Count,
  planCount: Count,
  warnings: z.array(Text).max(100),
});
export const ImportResult = z.strictObject({
  planIds: IdList,
  snapshotIds: IdList,
  dataRevision: Revision,
});
export const ClearScope = z.enum(["planning", "all"]);
export const ClearPreview = z.strictObject({
  id: Id,
  scope: ClearScope,
  expiresAt: Timestamp,
  expectedDataRevision: Revision,
  planCount: Count,
  snapshotCount: Count,
});
export const ClearResult = Ack.extend({ dataRevision: Revision });
export const Diagnostics = z.strictObject({
  schemaVersion: SchemaVersion,
  generatedAt: Timestamp,
  applicationVersion: Text,
  counts: z.strictObject({ plans: Count, snapshots: Count }),
  events: z
    .array(
      z.strictObject({
        requestId: Id,
        action: Id,
        module: Id,
        durationMs: Count,
        status: z.enum(["ok", "error"]),
        errorCode: ApiError.shape.code.nullable(),
        schemaVersion: SchemaVersion,
      }),
    )
    .max(1000),
});
