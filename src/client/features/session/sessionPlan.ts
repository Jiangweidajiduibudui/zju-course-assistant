import { finalValidate, type SolverInput } from "../../../domain/selection-model/index.js";
import {
  type CandidatePlan,
  type ConflictReport,
  type ErrorCode,
  ErrorCodes,
  type Session,
  sessionSchema,
} from "../../../shared/contracts/index.js";

export interface ApplyPlanAtomicallyOptions {
  label: string;
  now?: Date | string;
  cancelled?: boolean;
  staleGeneration?: boolean;
}

export type ApplyPlanAtomicallyResult =
  | { kind: "applied"; session: Session }
  | {
      kind: "rejected";
      session: Session;
      errorCode: ErrorCode;
      conflicts?: ConflictReport[];
    };

export function applyPlanAtomically(
  session: Session,
  input: SolverInput,
  candidatePlan: CandidatePlan,
  options: ApplyPlanAtomicallyOptions,
): ApplyPlanAtomicallyResult {
  if (options.cancelled) {
    return rejected(session, ErrorCodes.PLAN_GENERATION_CANCELLED);
  }

  if (options.staleGeneration) {
    return rejected(session, ErrorCodes.PLAN_STALE_GENERATION);
  }

  const validation = finalValidate(input, candidatePlan);
  if (validation.kind === "invalid") {
    return rejected(session, ErrorCodes.PLAN_FINAL_VALIDATION_FAILED, validation.conflicts);
  }

  const updated = sessionSchema.parse({
    ...session,
    plan: candidatePlan,
    history: [
      ...session.history,
      {
        at: normalizeTimestamp(options.now),
        label: options.label,
        pool: session.pool,
        rules: session.rules,
        plan: session.plan,
      },
    ],
  });

  return { kind: "applied", session: updated };
}

function rejected(
  session: Session,
  errorCode: ErrorCode,
  conflicts?: ConflictReport[],
): ApplyPlanAtomicallyResult {
  return conflicts
    ? { kind: "rejected", session, errorCode, conflicts }
    : { kind: "rejected", session, errorCode };
}

function normalizeTimestamp(now: Date | string | undefined): string {
  if (now instanceof Date) {
    return now.toISOString();
  }
  return now ?? new Date().toISOString();
}
