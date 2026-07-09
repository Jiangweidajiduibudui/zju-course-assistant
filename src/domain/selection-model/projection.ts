import { type CandidatePlan, type TimetableProjection } from "../../shared/contracts/index.js";
import type { ProjectionCell } from "../../shared/contracts/index.js";
import { ErrorCodes } from "../../shared/contracts/errors.js";
import type { SolverInput } from "./types.js";

/**
 * 课表投影（docs/08 §8.2）：志愿提交方案 → 预期课表。
 *
 * - 课表只投影当前首选方案；
 * - 同一格可标记备选堆叠，但不得表现成用户会同时上多门互斥课程；
 * - 考试/学分缺失的教学班不进课表，进 excluded 并带原因码（D37、D38）。
 *
 * Task 1 交付；测试锚点：tests/domain/projection.test.ts。
 */
export function projectTimetable(input: SolverInput, plan: CandidatePlan): TimetableProjection {
  const { sections, pool } = input;
  const excluded: Array<{ sectionId: string; reasonCode: string }> = [];
  const excludedIds = new Set<string>();

  // —— 第一步：标记缺失硬字段的教学班（不进课表）——
  for (const vol of plan.volunteers) {
    const section = sections.get(vol.sectionId);
    if (!section) continue;

    if (section.examTime === null) {
      excluded.push({
        sectionId: vol.sectionId,
        reasonCode: ErrorCodes.MODEL_MISSING_EXAM_TIME,
      });
      excludedIds.add(vol.sectionId);
    }
    if (section.credits === null) {
      excluded.push({
        sectionId: vol.sectionId,
        reasonCode: ErrorCodes.MODEL_MISSING_CREDIT,
      });
      excludedIds.add(vol.sectionId);
    }
  }

  // 构建池内 sectionId 集合用于 stacked 查找
  const poolSectionIds = new Set<string>();
  for (const target of pool.targets) {
    for (const sid of target.candidateSectionIds) {
      poolSectionIds.add(sid);
    }
  }

  // —— 第二步：按 slot 聚合 ——
  // slotKey → { primary, stacked, flags }
  interface CellBuilder {
    primarySectionId: string | null;
    stackedSectionIds: string[];
    flags: Set<"classTimeOverlap" | "unknown">;
  }
  const cellMap = new Map<string, CellBuilder>();

  // 将 plan 中的 volunteers 按 rank 排序（rank 1 优先成为 primary）
  const sorted = [...plan.volunteers].sort((a, b) => a.rank - b.rank);

  for (const vol of sorted) {
    // 缺失硬字段的跳过（不进课表单元格）
    if (excludedIds.has(vol.sectionId)) continue;

    const section = sections.get(vol.sectionId);
    if (!section) continue;

    for (const slot of section.slots) {
      const slotKey = `${slot.term}-${slot.dayOfWeek}-${slot.period}`;

      let cell = cellMap.get(slotKey);
      if (!cell) {
        cell = {
          primarySectionId: null,
          stackedSectionIds: [],
          flags: new Set(),
        };
        cellMap.set(slotKey, cell);
      }

      if (cell.primarySectionId === null) {
        // 第一个占此格的 plan volunteer → primary
        cell.primarySectionId = vol.sectionId;
      } else {
        // 已有 primary → 加入 stacked
        cell.flags.add("classTimeOverlap");
        if (!cell.stackedSectionIds.includes(vol.sectionId)) {
          cell.stackedSectionIds.push(vol.sectionId);
        }
        // 如果之前的 primary 还没在 stacked 中，也加进去
        if (
          cell.primarySectionId &&
          !cell.stackedSectionIds.includes(cell.primarySectionId)
        ) {
          cell.stackedSectionIds.push(cell.primarySectionId);
        }
      }
    }
  }

  // —— 第三步：查找池内其他 candidate 作为额外的 stacked——
  for (const target of pool.targets) {
    for (const sid of target.candidateSectionIds) {
      if (excludedIds.has(sid)) continue;
      const section = sections.get(sid);
      if (!section) continue;

      for (const slot of section.slots) {
        const slotKey = `${slot.term}-${slot.dayOfWeek}-${slot.period}`;
        const cell = cellMap.get(slotKey);
        if (cell && sid !== cell.primarySectionId && !cell.stackedSectionIds.includes(sid)) {
          cell.stackedSectionIds.push(sid);
        }
      }
    }
  }

  // —— 第四步：转换为 ProjectionCell[] ——
  const cells: ProjectionCell[] = [];
  for (const [slotKey, cell] of cellMap.entries()) {
    const [term, dayStr, periodStr] = slotKey.split("-");
    cells.push({
      slot: {
        term: term as "spring" | "summer" | "autumn" | "winter",
        dayOfWeek: Number(dayStr),
        period: Number(periodStr),
      },
      primarySectionId: cell.primarySectionId,
      stackedSectionIds: cell.stackedSectionIds,
      flags: [...cell.flags],
    });
  }

  return {
    schemaVersion: "projection.v1",
    planId: plan.planId,
    cells,
    excluded,
  };
}
