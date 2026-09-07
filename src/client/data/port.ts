import type { z } from "zod";
import type { api, PlanView } from "../../shared/contracts/api.js";
import type { SnapshotData } from "../../shared/contracts/catalog.js";
import type {
  PlanData,
  ReconciliationPreview,
} from "../../shared/contracts/planning.js";

// A renderer view explicitly lists loaded section groups; never validate or export it as a complete Snapshot.
export type SnapshotView = SnapshotData & { loadedCourseIds: string[] };

export type Analysis = z.infer<typeof api.analyzePlan.response>;
export type Preview = z.infer<typeof ReconciliationPreview>;
export type View = z.infer<typeof PlanView>;

// Adapter methods use frozen operation bodies and response schemas. No HTTP
// handlers or school session are implemented by the synthetic adapter.
export interface WorkspacePort {
  interpretPreferences(
    input: z.infer<typeof api.interpretPreferences.body>,
  ): Promise<InterpretationData>;
  generateTimetable(
    input: z.infer<typeof api.generateTimetable.body>,
    key: string,
  ): Promise<PlanningJobData>;
  getPlanningJob(id: string): Promise<PlanningJobData>;
  cancelPlanningJob(id: string): Promise<PlanningJobData>;
  adoptPlanningProposal(
    id: string,
    input: z.infer<typeof api.adoptPlanningProposal.body>,
    key: string,
  ): Promise<View>;
  listPlans(): Promise<z.infer<typeof api.listPlans.response>>;
  getPlan(id: string): Promise<View>;
  getSnapshot(id: string, courseIds?: string[]): Promise<SnapshotView>;
  getAnalysis(plan: PlanData): Promise<Analysis>;
  createPlan(input: z.infer<typeof api.createPlan.body>): Promise<View>;
  updatePlan(
    id: string,
    input: z.infer<typeof api.updatePlan.body>,
  ): Promise<View>;
  deletePlan(id: string, revision: number): Promise<void>;
  previewReconciliation(
    id: string,
    input: z.infer<typeof api.previewReconciliation.body>,
  ): Promise<Preview>;
  applyReconciliation(
    id: string,
    previewId: string,
    input: z.infer<typeof api.applyReconciliation.body>,
  ): Promise<View>;
}

export type InterpretationData = z.infer<
  typeof api.interpretPreferences.response
>;
export type PlanningJobData = z.infer<typeof api.getPlanningJob.response>;
