import { z } from "zod";

export const CONTRACT_VERSION = "2.1.0" as const;
export const SchemaVersion = z.literal(1);
export const PlanSchemaVersion = z.literal(2);
export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const Text = z.string().min(1).max(2000);
export const Note = z.string().max(4000);
export const Revision = z.number().int().positive().max(999999999999999);
export const Count = z.number().int().nonnegative();
export const Credits = z.number().nonnegative().max(1000);
export const Timestamp = z.iso.datetime();
export const DateOnly = z.iso.date();
export const HttpsUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
}, "Use HTTPS without credentials, query parameters, or fragments");

// Wire fields never coerce null, the string "undefined", or an empty string to zero.
export const field = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), value }),
    z.strictObject({
      state: z.literal("unknown"),
      reason: z.enum([
        "not_provided",
        "not_parsed",
        "not_verified",
        "not_loaded",
      ]),
      displayText: Text.optional(),
    }),
    z.strictObject({ state: z.literal("not_applicable"), reason: Text }),
  ]);

export const unique = <T>(items: readonly T[]) =>
  new Set(items).size === items.length;
export const IdList = z.array(Id).max(10000).refine(unique, "Duplicate IDs");
export const Source = z.strictObject({
  provider: z.enum(["zdbk", "chalaoshi"]),
  url: HttpsUrl,
  observedAt: Timestamp,
});
export const Provenance = z
  .strictObject({
    origin: z.enum(["live", "imported", "fixture"]),
    synthetic: z.boolean(),
    sources: z.array(Source).max(20),
  })
  .refine(
    (value) =>
      (value.origin !== "fixture" || value.synthetic) &&
      (value.origin !== "live" || !value.synthetic),
    "Fixture/live provenance contradicts synthetic status",
  );

export const PlanRef = z.strictObject({
  planId: Id,
  expectedRevision: Revision,
});
export const DerivationStamp = z.strictObject({
  planId: Id,
  planRevision: Revision,
  snapshotId: Id,
  rulesetId: Id,
});

export function sameStamp(
  a: z.infer<typeof DerivationStamp>,
  b: z.infer<typeof DerivationStamp>,
) {
  return (
    a.planId === b.planId &&
    a.planRevision === b.planRevision &&
    a.snapshotId === b.snapshotId &&
    a.rulesetId === b.rulesetId
  );
}

export const errorStatus = {
  INVALID_REQUEST: 400,
  UNSUPPORTED_SCHEMA_VERSION: 400,
  LOCAL_AUTH_REQUIRED: 401,
  ORIGIN_REJECTED: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SNAPSHOT_MISMATCH: 409,
  RECONCILIATION_REQUIRED: 409,
  PREVIEW_EXPIRED: 409,
  SESSION_REQUIRED: 409,
  SESSION_EXPIRED: 409,
  SESSION_SCOPE_CHANGED: 409,
  OPERATION_IN_PROGRESS: 409,
  SOURCE_SWITCH_REQUIRED: 409,
  MATCH_CONFIRMATION_REQUIRED: 409,
  LLM_NOT_CONFIGURED: 409,
  EXTERNAL_ACCESS_DISABLED: 403,
  ENDPOINT_REJECTED: 403,
  VALIDATION_FAILED: 422,
  IMPORT_INVALID: 422,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  UPSTREAM_SCHEMA_CHANGED: 502,
  SYNC_INCOMPLETE: 502,
  LLM_OUTPUT_INVALID: 502,
  LLM_NOT_IMPLEMENTED: 501,
  FEATURE_NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
} as const;
export const ErrorCode = z.enum(
  Object.keys(errorStatus) as [
    keyof typeof errorStatus,
    ...Array<keyof typeof errorStatus>,
  ],
);
export const ApiError = z.strictObject({
  code: ErrorCode,
  message: Text,
  retryable: z.boolean(),
  // Sanitized field paths/codes only: never echo rejected values or upstream bodies.
  fields: z
    .array(
      z.strictObject({ path: z.array(z.string().max(100)).max(12), code: Id }),
    )
    .max(50),
});
export const Meta = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  requestId: Id,
  servedAt: Timestamp,
});
export const success = <T extends z.ZodType>(data: T) =>
  z.strictObject({ meta: Meta, data });
export const Failure = z.strictObject({ meta: Meta, error: ApiError });
export const Empty = z.strictObject({});
export const Ack = z.strictObject({ acknowledged: z.literal(true) });
export const Cursor = z.string().min(1).max(2048);
export const PageQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .optional(),
});
export const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: Cursor.nullable(),
  });
