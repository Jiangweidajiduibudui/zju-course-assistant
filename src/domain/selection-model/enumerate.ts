import {
  type CandidatePlan,
  type ConflictReport,
  type CourseCode,
  ErrorCodes,
  type Section,
  type SectionId,
  type VolunteerGroup,
} from "../../shared/contracts/index.js";
import { assessSchedulability } from "./feasibility.js";
import { timeslotKey } from "./timeslot.js";
import type { EnumerationResult, GroupOrdering, SolverInput } from "./types.js";
import { finalValidate } from "./validate.js";
import { buildVolunteerGroups } from "./volunteer-groups.js";

/**
 * 候选枚举（阶段④；D39；docs/04 §3.2）：
 *
 * 按 LLM 组内顺序（阶段③产出、已过 ID 池内性校验）枚举可行组合，
 * 输出最多 Top10 完整候选方案；每个候选必须能独立通过 finalValidate
 * （docs/05 §3.1 性质 10）。
 *
 * 无解时输出冲突来源（哪些约束互斥、涉及哪些课/班），不自动放松任何规则、
 * 不允许 LLM 决定牺牲哪条硬约束（D17）。
 *
 * 性能边界：典型输入持续超过 200ms 才考虑 worker thread（docs/07 §7），先 benchmark。
 *
 * Task 1 交付；测试锚点：tests/domain/enumerate.test.ts + properties.test.ts。
 */
export function enumerateTopPlans(
  input: SolverInput,
  groupOrderings: readonly GroupOrdering[],
  maxPlans = 10,
): EnumerationResult {
  if (maxPlans <= 0) {
    return { kind: "plans", plans: [] };
  }

  const orderingConflicts = validateGroupOrderings(input, groupOrderings);
  if (orderingConflicts.length > 0) {
    return { kind: "infeasible", conflicts: orderingConflicts };
  }

  const schedulableSectionIds = new Set(assessSchedulability(input).schedulable);
  const groups = buildVolunteerGroups(input, groupOrderings);
  const groupById = new Map(groups.map((group) => [group.groupId, group]));
  const infeasibleConflicts: ConflictReport[] = [];
  const searchTargets: SearchTarget[] = [];

  for (const target of input.pool.targets) {
    const orderedSectionIds = orderTargetCandidates(input, target, groupOrderings).filter(
      (sectionId) => schedulableSectionIds.has(sectionId),
    );
    if (orderedSectionIds.length === 0) {
      infeasibleConflicts.push(
        conflict(
          ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
          target.candidateSectionIds,
          [target.courseCode],
          "待选池目标课程没有可排教学班",
        ),
      );
      continue;
    }

    const formalCourseGroup = groupById.get(courseGroupId(target.courseCode));
    const variants = buildVolunteerVariants(orderedSectionIds);
    if (variants.length === 0) {
      infeasibleConflicts.push(
        conflict(
          ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
          target.candidateSectionIds,
          [target.courseCode],
          "LLM 排序后的课程志愿组没有可排教学班",
        ),
      );
      continue;
    }

    searchTargets.push({
      courseCode: target.courseCode,
      groupId: formalCourseGroup?.groupId ?? courseGroupId(target.courseCode),
      invalidated: formalCourseGroup?.invalidated ?? null,
      variants,
    });
  }

  if (infeasibleConflicts.length > 0) {
    return { kind: "infeasible", conflicts: infeasibleConflicts };
  }

  const plans: CandidatePlan[] = [];
  const invalidConflicts: ConflictReport[] = [];

  enumeratePlanSelections(searchTargets, (selection) => {
    if (plans.length >= maxPlans) {
      return false;
    }

    const plan = buildCandidatePlan(input, selection, plans.length + 1);
    const validation = finalValidate(input, plan);
    if (validation.kind === "invalid") {
      invalidConflicts.push(...validation.conflicts);
      return true;
    }

    plans.push(plan);
    return plans.length < maxPlans;
  });

  if (plans.length === 0) {
    return {
      kind: "infeasible",
      conflicts:
        invalidConflicts.length > 0
          ? invalidConflicts
          : [
              conflict(
                ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
                [],
                input.pool.targets.map((target) => target.courseCode),
                "没有生成可通过终校验的候选方案",
              ),
            ],
    };
  }

  return { kind: "plans", plans };
}

interface SearchTarget {
  courseCode: CourseCode;
  groupId: string;
  invalidated: VolunteerGroup["invalidated"];
  variants: SectionId[][];
}

interface PlanSelection {
  courseCode: CourseCode;
  groupId: string;
  invalidated: VolunteerGroup["invalidated"];
  sectionIds: SectionId[];
}

function orderTargetCandidates(
  input: SolverInput,
  target: SolverInput["pool"]["targets"][number],
  groupOrderings: readonly GroupOrdering[],
): SectionId[] {
  const groupId = courseGroupId(target.courseCode);
  const candidateSet = new Set(target.candidateSectionIds);
  const ordering = groupOrderings.find((item) => item.groupId === groupId);
  const orderedFromLlm =
    ordering?.orderedSectionIds.filter((sectionId) => candidateSet.has(sectionId)) ?? [];
  const orderedSet = new Set(orderedFromLlm);
  const orderedSectionIds = uniqueSectionIds([
    ...orderedFromLlm,
    ...target.candidateSectionIds.filter((sectionId) => !orderedSet.has(sectionId)),
  ]).filter((sectionId) => input.sections.has(sectionId));

  return prioritizeLockedCandidates(input, target, orderedSectionIds);
}

function prioritizeLockedCandidates(
  input: SolverInput,
  target: SolverInput["pool"]["targets"][number],
  orderedSectionIds: readonly SectionId[],
): SectionId[] {
  const orderedSet = new Set(orderedSectionIds);
  const targetCandidateSet = new Set(target.candidateSectionIds);
  const rankedLockByRank = new Map<number, SectionId>();
  const rankedLockIds = new Set<SectionId>();

  for (const baselineVolunteer of input.baseline.volunteers) {
    if (
      !targetCandidateSet.has(baselineVolunteer.sectionId) ||
      !orderedSet.has(baselineVolunteer.sectionId)
    ) {
      continue;
    }

    if (!rankedLockByRank.has(baselineVolunteer.rank)) {
      rankedLockByRank.set(baselineVolunteer.rank, baselineVolunteer.sectionId);
    }
    rankedLockIds.add(baselineVolunteer.sectionId);
  }

  const manualLockedSectionIds = orderedSectionIds.filter(
    (sectionId) => input.lockedSectionIds.has(sectionId) && !rankedLockIds.has(sectionId),
  );
  const lockedSectionIds = new Set([...rankedLockIds, ...manualLockedSectionIds]);
  const unlockedSectionIds = orderedSectionIds.filter(
    (sectionId) => !lockedSectionIds.has(sectionId),
  );
  const prefix: SectionId[] = [];

  for (const rank of [1, 2, 3]) {
    const rankedLock = rankedLockByRank.get(rank);
    if (rankedLock) {
      prefix.push(rankedLock);
      continue;
    }

    const manualLock = manualLockedSectionIds.shift();
    if (manualLock) {
      prefix.push(manualLock);
      continue;
    }

    const unlockedSectionId = unlockedSectionIds.shift();
    if (unlockedSectionId) {
      prefix.push(unlockedSectionId);
    }
  }

  return uniqueSectionIds([...prefix, ...manualLockedSectionIds, ...unlockedSectionIds]);
}

function buildVolunteerVariants(orderedSectionIds: readonly SectionId[]): SectionId[][] {
  const rankCount = Math.min(3, orderedSectionIds.length);
  if (rankCount === 0) {
    return [];
  }
  if (orderedSectionIds.length <= 3) {
    return [orderedSectionIds.slice()];
  }

  const variants: SectionId[][] = [];
  const current: SectionId[] = [];

  function visit(startIndex: number): void {
    if (current.length === rankCount) {
      variants.push(current.slice());
      return;
    }

    const remainingSlots = rankCount - current.length;
    for (let index = startIndex; index <= orderedSectionIds.length - remainingSlots; index += 1) {
      current.push(orderedSectionIds[index] as SectionId);
      visit(index + 1);
      current.pop();
    }
  }

  visit(0);
  return variants;
}

function enumeratePlanSelections(
  targets: readonly SearchTarget[],
  onSelection: (selection: readonly PlanSelection[]) => boolean,
): void {
  const current: PlanSelection[] = [];

  function visit(targetIndex: number): boolean {
    if (targetIndex === targets.length) {
      return onSelection(current);
    }

    const target = targets[targetIndex] as SearchTarget;
    for (const sectionIds of target.variants) {
      current.push({
        courseCode: target.courseCode,
        groupId: target.groupId,
        invalidated: target.invalidated,
        sectionIds,
      });
      const shouldContinue = visit(targetIndex + 1);
      current.pop();
      if (!shouldContinue) {
        return false;
      }
    }

    return true;
  }

  visit(0);
}

function buildCandidatePlan(
  input: SolverInput,
  selection: readonly PlanSelection[],
  planNumber: number,
): CandidatePlan {
  const groups: VolunteerGroup[] = [];
  const volunteers: CandidatePlan["volunteers"] = [];

  for (const selectedGroup of selection) {
    groups.push({
      groupId: selectedGroup.groupId,
      kind: "course",
      ref: selectedGroup.courseCode,
      orderedSectionIds: asNonEmptyTopThree(selectedGroup.sectionIds),
      invalidated: selectedGroup.invalidated,
    });

    selectedGroup.sectionIds.forEach((sectionId, index) => {
      volunteers.push({
        sectionId,
        courseCode: selectedGroup.courseCode,
        rank: toVolunteerRank(index),
        groupId: selectedGroup.groupId,
        locked: input.lockedSectionIds.has(sectionId),
      });
    });
  }

  return {
    planId: `plan-${planNumber}`,
    volunteers,
    groups,
    totalCredits: calculateTotalCredits(input, volunteers),
  };
}

function validateGroupOrderings(
  input: SolverInput,
  groupOrderings: readonly GroupOrdering[],
): ConflictReport[] {
  const groupCandidates = buildGroupCandidateSets(input);
  const conflicts: ConflictReport[] = [];

  for (const ordering of groupOrderings) {
    const candidateSet = groupCandidates.get(ordering.groupId);
    if (!candidateSet) {
      conflicts.push(
        conflict(
          ErrorCodes.LLM_ID_OUT_OF_INPUT,
          ordering.orderedSectionIds,
          [],
          "LLM 返回了未知志愿组",
        ),
      );
      continue;
    }

    const outOfGroupIds = ordering.orderedSectionIds.filter(
      (sectionId) => !candidateSet.has(sectionId),
    );
    if (outOfGroupIds.length > 0) {
      conflicts.push(
        conflict(
          ErrorCodes.LLM_ID_OUT_OF_INPUT,
          outOfGroupIds,
          courseCodesFor(input, outOfGroupIds),
          "LLM 组内排序引用了不属于该志愿组的教学班",
        ),
      );
    }
  }

  return conflicts;
}

function buildGroupCandidateSets(input: SolverInput): Map<string, Set<SectionId>> {
  const groupCandidates = new Map<string, Set<SectionId>>();
  const occupiedByCourseGroups = new Set<SectionId>();

  for (const target of input.pool.targets) {
    const candidateSectionIds = [...new Set(target.candidateSectionIds)];
    if (candidateSectionIds.length >= 2) {
      groupCandidates.set(courseGroupId(target.courseCode), new Set(candidateSectionIds));
      for (const sectionId of candidateSectionIds) {
        occupiedByCourseGroups.add(sectionId);
      }
    }
  }

  for (const target of input.pool.targets) {
    for (const sectionId of target.candidateSectionIds) {
      if (occupiedByCourseGroups.has(sectionId)) {
        continue;
      }
      const section = input.sections.get(sectionId);
      if (!section) {
        continue;
      }
      for (const slot of section.slots) {
        const key = `timeslot:${timeslotKey(slot)}`;
        const candidateSet = groupCandidates.get(key) ?? new Set<SectionId>();
        candidateSet.add(sectionId);
        groupCandidates.set(key, candidateSet);
      }
    }
  }

  for (const [groupId, candidateSet] of groupCandidates) {
    if (candidateSet.size < 2) {
      groupCandidates.delete(groupId);
    }
  }

  return groupCandidates;
}

function calculateTotalCredits(
  input: SolverInput,
  volunteers: readonly CandidatePlan["volunteers"][number][],
): number {
  const creditsByCourse = new Map<CourseCode, number>();

  for (const volunteer of volunteers) {
    if (creditsByCourse.has(volunteer.courseCode)) {
      continue;
    }

    const section = input.sections.get(volunteer.sectionId);
    if (section?.credits !== null && section?.credits !== undefined) {
      creditsByCourse.set(volunteer.courseCode, section.credits);
    }
  }

  return [...creditsByCourse.values()].reduce((sum, credits) => sum + credits, 0);
}

function courseCodesFor(input: SolverInput, sectionIds: readonly SectionId[]): CourseCode[] {
  return sectionIds.flatMap((sectionId) => {
    const section: Section | undefined = input.sections.get(sectionId);
    return section ? [section.courseCode] : [];
  });
}

function uniqueSectionIds(sectionIds: readonly SectionId[]): SectionId[] {
  return [...new Set(sectionIds)];
}

function asNonEmptyTopThree(sectionIds: readonly SectionId[]): [SectionId, ...SectionId[]] {
  const topThree = sectionIds.slice(0, 3);
  if (topThree.length === 0) {
    throw new Error("Candidate plan group must contain at least one section");
  }
  return topThree as [SectionId, ...SectionId[]];
}

function toVolunteerRank(index: number): 1 | 2 | 3 {
  if (index === 0) {
    return 1;
  }
  if (index === 1) {
    return 2;
  }
  return 3;
}

function courseGroupId(courseCode: CourseCode): string {
  return `course:${courseCode}`;
}

function conflict(
  errorCode: string,
  involvedSectionIds: SectionId[],
  involvedCourseCodes: CourseCode[],
  description: string,
): ConflictReport {
  return {
    errorCode,
    involvedSectionIds: [...new Set(involvedSectionIds)],
    involvedCourseCodes: [...new Set(involvedCourseCodes)],
    description,
  };
}
