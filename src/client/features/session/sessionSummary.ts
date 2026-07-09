import type { Session } from "../../../shared/contracts/index.js";

export function countSessionPoolSections(session: Session): number {
  return session.pool.targets.reduce(
    (total, target) => total + target.candidateSectionIds.length,
    0,
  );
}
