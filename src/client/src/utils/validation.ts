/**
 * 客户端校验 — 镜像 selection-model 的核心硬约束
 * 当 selection-model 就绪后，替换为对 /api/validate 的调用
 */

import type { PlanEntry, ConflictInfo } from '@shared/contracts';

/** 检查学分是否超上限（默认 30 学分） */
export function validateCredits(entries: PlanEntry[], maxCredits = 30): {
  valid: boolean;
  total: number;
  message: string;
} {
  const total = entries.reduce((sum, e) => sum + e.credits, 0);
  if (total > maxCredits) {
    return {
      valid: false,
      total,
      message: `学分合计 ${total}，超出上限 ${maxCredits}`,
    };
  }
  return { valid: true, total, message: '' };
}

/** 检查方案是否为池内课程的子集 */
export function validateInPool(
  entries: PlanEntry[],
  poolCourseIds: string[]
): { valid: boolean; outOfPool: string[] } {
  const outOfPool = entries
    .filter((e) => !poolCourseIds.includes(e.courseId))
    .map((e) => e.courseName);
  return { valid: outOfPool.length === 0, outOfPool };
}

/** 检查锁定条目是否被改动 */
export function validateLockPreserved(
  oldEntries: PlanEntry[],
  newEntries: PlanEntry[]
): { valid: boolean; violations: string[] } {
  const oldMap = new Map(oldEntries.filter((e) => e.locked).map((e) => [e.courseId, e]));
  const newMap = new Map(newEntries.map((e) => [e.courseId, e]));
  const violations: string[] = [];

  for (const [cid, oe] of oldMap) {
    const ne = newMap.get(cid);
    if (!ne) {
      violations.push(`锁定课程 ${oe.courseName} 在新方案中缺失`);
    } else if (ne.sectionId !== oe.sectionId) {
      violations.push(`锁定课程 ${oe.courseName} 教学班被改动`);
    }
  }

  return { valid: violations.length === 0, violations };
}
