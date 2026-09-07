import type { Analysis } from "../../src/client/data/port.js";
import { project, toDraft } from "../../src/domain/planning.js";
import type { SnapshotData } from "../../src/shared/contracts/catalog.js";
import type { PlanData } from "../../src/shared/contracts/planning.js";
export function fixtureAnalysis(
  plan: PlanData,
  snapshot: SnapshotData,
  stale: boolean,
): Analysis {
  const context = {
    plan,
    snapshot,
    latestLiveSnapshotId: stale ? "snapshot-demo-2" : null,
  };
  return { projection: project(context), draft: toDraft(context) };
}
