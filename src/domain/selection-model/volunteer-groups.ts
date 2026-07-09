import type { VolunteerGroup } from "../../shared/contracts/index.js";
import type { SolverInput } from "./types.js";

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
export function buildVolunteerGroups(input: SolverInput): VolunteerGroup[] {
  const { sections, pool } = input;
  const groups: VolunteerGroup[] = [];
  const consumedSectionIds = new Set<string>();

  // —— 第一步：构建课程志愿组 ——
  for (const target of pool.targets) {
    // 筛选出属于该课程且在 sections map 中存在的候选班
    const candidates = target.candidateSectionIds.filter((sid) => sections.has(sid));

    // 规则 4：只有 1 个候选班时自动消解课程组，该班可进入时间槽组
    if (candidates.length < 2) {
      continue;
    }

    // 规则 1：最多取前 3 个候选班（顺位 1/2/3）
    const orderedSectionIds = candidates.slice(0, 3);

    // 标记为已被课程组占用（规则 2）
    for (const sid of orderedSectionIds) {
      consumedSectionIds.add(sid);
    }

    groups.push({
      groupId: `course:${target.courseCode}`,
      kind: "course",
      ref: target.courseCode,
      orderedSectionIds,
      invalidated: null,
    });
  }

  // —— 第二步：构建时间槽志愿组 ——
  // 收集未被课程组占用的教学班，按时间槽 key 分组
  const timeslotBuckets = new Map<string, string[]>();

  for (const target of pool.targets) {
    for (const sid of target.candidateSectionIds) {
      // 跳过已被课程组占用的、不存在于 sections 中的
      if (consumedSectionIds.has(sid)) continue;
      const section = sections.get(sid);
      if (!section) continue;

      for (const slot of section.slots) {
        const key = `timeslot:${slot.term}-${slot.dayOfWeek}-${slot.period}`;
        const bucket = timeslotBuckets.get(key);
        if (bucket) {
          // 避免同一教学班在同一 bucket 中重复
          if (!bucket.includes(sid)) {
            bucket.push(sid);
          }
        } else {
          timeslotBuckets.set(key, [sid]);
        }
      }
    }
  }

  // 收集所有课程组占用的时间槽 key，用于冲突检测
  const courseGroupSlotKeys = new Set<string>();
  for (const sid of consumedSectionIds) {
    const section = sections.get(sid);
    if (!section) continue;
    for (const slot of section.slots) {
      courseGroupSlotKeys.add(`timeslot:${slot.term}-${slot.dayOfWeek}-${slot.period}`);
    }
  }

  // 规则 5：每个时间槽组最多 3 班
  for (const [key, sectionIds] of timeslotBuckets.entries()) {
    if (sectionIds.length < 2) continue; // 至少 2 个候选才有志愿组意义

    const ordered = sectionIds.slice(0, 3);

    // 规则 3：与课程组时间槽冲突 → 失效
    const termDayPeriod = key.slice("timeslot:".length); // e.g. "autumn-1-1"
    const conflictsWithCourse = courseGroupSlotKeys.has(key);

    groups.push({
      groupId: key,
      kind: "timeslot",
      ref: termDayPeriod,
      orderedSectionIds: ordered,
      invalidated: conflictsWithCourse
        ? {
            reason: `该时间槽与课程志愿组共享教学班，课程组优先`,
            byGroupId: null,
          }
        : null,
    });
  }

  return groups;
}
