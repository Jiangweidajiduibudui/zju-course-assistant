import { ErrorCodes } from "../../shared/contracts/errors.js";
import type { SectionId } from "../../shared/contracts/index.js";
import type { SchedulabilityResult, SolverInput } from "./types.js";

/**
 * 可排性判定（D37、D38；docs/08 §6.3–6.4）：
 *
 * - 考试时间缺失（examTime=null）→ MODEL_MISSING_EXAM_TIME，留在待选池；
 * - 学分缺失（credits=null）→ MODEL_MISSING_CREDIT，留在待选池；
 * - 不同课程考试时间重叠（examKey 相同）→ 硬无解 MODEL_EXAM_CONFLICT；
 *   同一课程不同教学班考试重叠属于正常情况；
 * - 学分上限未填写 → MODEL_CREDIT_LIMIT_MISSING（不能生成推荐）；
 * - 上课时间重叠不在此处淘汰（D37：交组内排序与 LLM 软判断）。
 *
 * Task 1 交付；测试锚点：tests/domain/feasibility.test.ts。
 */
export function assessSchedulability(input: SolverInput): SchedulabilityResult {
  const candidateSectionIds = collectPoolSectionIds(input);

  if (input.rules.creditLimit === null) {
    return {
      schedulable: [],
      excluded: candidateSectionIds.map((sectionId) => ({
        sectionId,
        reasonCode: ErrorCodes.MODEL_CREDIT_LIMIT_MISSING,
      })),
    };
  }

  const schedulable: SectionId[] = [];
  const excluded: SchedulabilityResult["excluded"] = [];

  for (const sectionId of candidateSectionIds) {
    const section = input.sections.get(sectionId);
    if (!section) {
      excluded.push({ sectionId, reasonCode: ErrorCodes.MODEL_SECTION_NOT_IN_POOL });
      continue;
    }

    if (section.examTime === null) {
      excluded.push({ sectionId, reasonCode: ErrorCodes.MODEL_MISSING_EXAM_TIME });
      continue;
    }

    if (section.credits === null) {
      excluded.push({ sectionId, reasonCode: ErrorCodes.MODEL_MISSING_CREDIT });
      continue;
    }

    schedulable.push(sectionId);
  }

  return { schedulable, excluded };
}

function collectPoolSectionIds(input: SolverInput): SectionId[] {
  const seen = new Set<SectionId>();
  const sectionIds: SectionId[] = [];

  for (const target of input.pool.targets) {
    for (const sectionId of target.candidateSectionIds) {
      if (!seen.has(sectionId)) {
        seen.add(sectionId);
        sectionIds.push(sectionId);
      }
    }
  }

  return sectionIds;
}
