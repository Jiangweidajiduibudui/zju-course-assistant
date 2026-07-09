import {
  type CandidatePlan,
  type ConflictReport,
  type CourseCode,
  ErrorCodes,
  type Section,
  type SectionId,
} from "../../shared/contracts/index.js";
import { enumerateTopPlans } from "./enumerate.js";
import type { EnumerationResult, GroupOrdering, PlanChangeSet, SolverInput } from "./types.js";

/**
 * 重新优化 / 最小扰动（docs/04 §3.2；AC-7.1、AC-7.2）：
 *
 * 以当前方案为参照，锁定项不动，目标函数加入"变更数最小化"项；
 * 输出附变更集供 UI 高亮。变更集不得包含锁定项（docs/05 §3.1 性质 5）。
 *
 * Task 1 交付；测试锚点：tests/domain/perturbation.test.ts。
 */
export function reoptimizeWithMinimalChange(
  input: SolverInput,
  currentPlan: CandidatePlan,
  groupOrderings: readonly GroupOrdering[],
): { result: EnumerationResult; changeSet: PlanChangeSet | null } {
  const enumerated = enumerateTopPlans(input, groupOrderings, 10);
  if (enumerated.kind === "infeasible") {
    return { result: enumerated, changeSet: null };
  }

  let bestCandidate: CandidatePlan | null = null;
  let bestChangeSet: PlanChangeSet | null = null;
  let bestChangeCount = Number.POSITIVE_INFINITY;

  for (const candidate of enumerated.plans) {
    if (!preservesLockedVolunteers(input, currentPlan, candidate)) {
      continue;
    }

    const changeSet = buildChangeSet(currentPlan, candidate, input.lockedSectionIds);
    const changeCount =
      changeSet.added.length + changeSet.removed.length + changeSet.rankChanged.length;

    if (changeCount < bestChangeCount) {
      bestCandidate = candidate;
      bestChangeSet = changeSet;
      bestChangeCount = changeCount;
    }
  }

  if (!bestCandidate || !bestChangeSet) {
    return {
      result: {
        kind: "infeasible",
        conflicts: [lockedConflict(input, currentPlan)],
      },
      changeSet: null,
    };
  }

  return {
    result: { kind: "plans", plans: [bestCandidate] },
    changeSet: bestChangeSet,
  };
}

function preservesLockedVolunteers(
  input: SolverInput,
  currentPlan: CandidatePlan,
  candidate: CandidatePlan,
): boolean {
  const currentBySectionId = volunteerBySectionId(currentPlan);
  const candidateBySectionId = volunteerBySectionId(candidate);

  for (const currentVolunteer of currentPlan.volunteers) {
    if (!currentVolunteer.locked && !input.lockedSectionIds.has(currentVolunteer.sectionId)) {
      continue;
    }

    const candidateVolunteer = candidateBySectionId.get(currentVolunteer.sectionId);
    if (!candidateVolunteer || candidateVolunteer.rank !== currentVolunteer.rank) {
      return false;
    }
  }

  for (const lockedSectionId of input.lockedSectionIds) {
    const currentVolunteer = currentBySectionId.get(lockedSectionId);
    if (!currentVolunteer) {
      continue;
    }

    const candidateVolunteer = candidateBySectionId.get(lockedSectionId);
    if (!candidateVolunteer || candidateVolunteer.rank !== currentVolunteer.rank) {
      return false;
    }
  }

  return true;
}

function buildChangeSet(
  currentPlan: CandidatePlan,
  candidate: CandidatePlan,
  lockedSectionIds: ReadonlySet<SectionId>,
): PlanChangeSet {
  const currentBySectionId = volunteerBySectionId(currentPlan);
  const candidateBySectionId = volunteerBySectionId(candidate);
  const added: PlanChangeSet["added"] = [];
  const removed: PlanChangeSet["removed"] = [];
  const rankChanged: PlanChangeSet["rankChanged"] = [];

  for (const candidateVolunteer of candidate.volunteers) {
    if (lockedSectionIds.has(candidateVolunteer.sectionId)) {
      continue;
    }

    const currentVolunteer = currentBySectionId.get(candidateVolunteer.sectionId);
    if (!currentVolunteer) {
      added.push(candidateVolunteer.sectionId);
      continue;
    }

    if (currentVolunteer.rank !== candidateVolunteer.rank) {
      rankChanged.push({
        sectionId: candidateVolunteer.sectionId,
        from: currentVolunteer.rank,
        to: candidateVolunteer.rank,
      });
    }
  }

  for (const currentVolunteer of currentPlan.volunteers) {
    if (lockedSectionIds.has(currentVolunteer.sectionId)) {
      continue;
    }

    if (!candidateBySectionId.has(currentVolunteer.sectionId)) {
      removed.push(currentVolunteer.sectionId);
    }
  }

  return { added, removed, rankChanged };
}

function volunteerBySectionId(
  plan: CandidatePlan,
): Map<SectionId, CandidatePlan["volunteers"][number]> {
  return new Map(plan.volunteers.map((volunteer) => [volunteer.sectionId, volunteer]));
}

function lockedConflict(input: SolverInput, currentPlan: CandidatePlan): ConflictReport {
  const lockedSectionIds = currentPlan.volunteers
    .filter((volunteer) => volunteer.locked || input.lockedSectionIds.has(volunteer.sectionId))
    .map((volunteer) => volunteer.sectionId);

  return {
    errorCode: ErrorCodes.MODEL_LOCK_VIOLATION,
    involvedSectionIds: [...new Set(lockedSectionIds)],
    involvedCourseCodes: courseCodesFor(input, lockedSectionIds),
    description: "没有候选方案能在重新优化时保持当前锁定项及其顺位",
  };
}

function courseCodesFor(input: SolverInput, sectionIds: readonly SectionId[]): CourseCode[] {
  return [
    ...new Set(
      sectionIds.flatMap((sectionId) => {
        const section: Section | undefined = input.sections.get(sectionId);
        return section ? [section.courseCode] : [];
      }),
    ),
  ];
}
