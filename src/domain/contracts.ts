import type { z } from "zod";
import type { Snapshot } from "../shared/contracts/catalog.js";
import type { PlanningContextSchema } from "../shared/contracts/context.js";
import type {
  Arrangement,
  Draft,
  Projection,
  ReconciliationChange,
  ValidationReport,
} from "../shared/contracts/planning.js";

export type PlanningContext = Readonly<z.infer<typeof PlanningContextSchema>>;
export type FinalValidationInput = PlanningContext &
  Readonly<{ arrangement: z.infer<typeof Arrangement> }>;

// Type-level port, not a fake implementation. Functions must be pure and must
// recompute validation from context rather than trust a supplied report.
export interface DomainContracts {
  project(input: PlanningContext): z.infer<typeof Projection>;
  toDraft(input: PlanningContext): z.infer<typeof Draft>;
  validateDraft(input: PlanningContext): z.infer<typeof ValidationReport>;
  finalValidate(input: FinalValidationInput): z.infer<typeof ValidationReport>;
  diff(
    input: PlanningContext & Readonly<{ target: z.infer<typeof Snapshot> }>,
  ): z.infer<typeof ReconciliationChange>[];
}
