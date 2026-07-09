import type { SectionId, VolunteerGroup } from "../../shared/contracts/index.js";
import { timeslotKey } from "./timeslot.js";
import type { GroupOrdering, SolverInput } from "./types.js";

/**
 * 志愿组构造（D30、D37；规则细目见 docs/08 §6.2）：
 *
 * 1. 同一课程 ≥2 个候选教学班 → 课程志愿组（最多 3 班，顺位 1/2/3）；
 * 2. 被课程志愿组占用的教学班不得再进入时间槽志愿组；
 * 3. 时间槽组与课程组冲突时，课程组优先，时间槽组失效（invalidated 必须带原因）；
 * 4. 课程组缩小到 1 个教学班时自动消解，该班可参与时间槽组；
 * 5. 时间槽志愿组最多 3 班，顺位 1/2/3。
 *
 * Task 1 交付；测试锚点：tests/domain/volunteer-groups.test.ts。
 */
export function buildVolunteerGroups(
  input: SolverInput,
  groupOrderings: readonly GroupOrdering[] = [],
): VolunteerGroup[] {
  const orderingByGroupId = new Map(groupOrderings.map((ordering) => [ordering.groupId, ordering]));
  const groups: VolunteerGroup[] = [];
  const occupiedByCourseGroups = new Map<SectionId, string>();

  for (const target of input.pool.targets) {
    const candidateSectionIds = uniqueSectionIds(target.candidateSectionIds);
    if (candidateSectionIds.length < 2) {
      continue;
    }

    const groupId = courseGroupId(target.courseCode);
    groups.push({
      groupId,
      kind: "course",
      ref: target.courseCode,
      orderedSectionIds: pickTopThree(candidateSectionIds, orderingByGroupId.get(groupId)),
      invalidated: null,
    });

    for (const sectionId of candidateSectionIds) {
      occupiedByCourseGroups.set(sectionId, groupId);
    }
  }

  const timeslotCandidates = new Map<string, SectionId[]>();
  const rawTimeslotCandidates = new Map<
    string,
    { sectionIds: SectionId[]; courseCodes: string[]; byCourseGroupIds: string[] }
  >();
  for (const target of input.pool.targets) {
    for (const sectionId of target.candidateSectionIds) {
      const section = input.sections.get(sectionId);
      if (!section) {
        continue;
      }

      for (const slot of section.slots) {
        const key = timeslotKey(slot);
        const raw = rawTimeslotCandidates.get(key) ?? {
          sectionIds: [],
          courseCodes: [],
          byCourseGroupIds: [],
        };
        if (!raw.sectionIds.includes(sectionId)) {
          raw.sectionIds.push(sectionId);
        }
        if (!raw.courseCodes.includes(section.courseCode)) {
          raw.courseCodes.push(section.courseCode);
        }

        const courseGroupId = occupiedByCourseGroups.get(sectionId);
        if (courseGroupId) {
          if (!raw.byCourseGroupIds.includes(courseGroupId)) {
            raw.byCourseGroupIds.push(courseGroupId);
          }
          rawTimeslotCandidates.set(key, raw);
          continue;
        }

        const active = timeslotCandidates.get(key) ?? [];
        if (!active.includes(sectionId)) {
          active.push(sectionId);
          timeslotCandidates.set(key, active);
        }
        rawTimeslotCandidates.set(key, raw);
      }
    }
  }

  for (const [key, raw] of rawTimeslotCandidates) {
    const activeCandidateCount = timeslotCandidates.get(key)?.length ?? 0;
    if (
      raw.sectionIds.length < 2 ||
      raw.courseCodes.length < 2 ||
      raw.byCourseGroupIds.length === 0 ||
      activeCandidateCount >= 2
    ) {
      continue;
    }

    const groupId = timeslotGroupId(key);
    groups.push({
      groupId,
      kind: "timeslot",
      ref: key,
      orderedSectionIds: pickTopThree(raw.sectionIds, orderingByGroupId.get(groupId)),
      invalidated: {
        reason: "时间槽组包含已进入课程志愿组的教学班，按课程组优先规则失效",
        byGroupId: raw.byCourseGroupIds[0] ?? null,
      },
    });
  }

  for (const [key, candidateSectionIds] of timeslotCandidates) {
    if (candidateSectionIds.length < 2) {
      continue;
    }

    const groupId = timeslotGroupId(key);
    groups.push({
      groupId,
      kind: "timeslot",
      ref: key,
      orderedSectionIds: pickTopThree(candidateSectionIds, orderingByGroupId.get(groupId)),
      invalidated: null,
    });
  }

  return groups;
}

function pickTopThree(
  candidateSectionIds: readonly SectionId[],
  ordering: GroupOrdering | undefined,
): [SectionId, ...SectionId[]] {
  const candidateSet = new Set(candidateSectionIds);
  const ordered =
    ordering?.orderedSectionIds.filter((sectionId) => candidateSet.has(sectionId)) ?? [];
  const orderedSet = new Set(ordered);
  const fallback = candidateSectionIds.filter((sectionId) => !orderedSet.has(sectionId));
  const topThree = [...ordered, ...fallback].slice(0, 3);
  if (topThree.length === 0) {
    throw new Error("Volunteer group must contain at least one section");
  }
  return topThree as [SectionId, ...SectionId[]];
}

function uniqueSectionIds(sectionIds: readonly SectionId[]): SectionId[] {
  return [...new Set(sectionIds)];
}

function courseGroupId(courseCode: string): string {
  return `course:${courseCode}`;
}

function timeslotGroupId(key: string): string {
  return `timeslot:${key}`;
}
