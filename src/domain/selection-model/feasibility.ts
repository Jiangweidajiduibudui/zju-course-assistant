import { NotImplementedError } from "./errors.js";
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
export function assessSchedulability(_input: SolverInput): SchedulabilityResult {
  throw new NotImplementedError("assessSchedulability", "Task 1");
}
