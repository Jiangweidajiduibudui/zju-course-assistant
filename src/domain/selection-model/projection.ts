import type { CandidatePlan, TimetableProjection } from "../../shared/contracts/index.js";
import { NotImplementedError } from "./errors.js";
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
export function projectTimetable(
  _input: SolverInput,
  _plan: CandidatePlan,
): TimetableProjection {
  throw new NotImplementedError("projectTimetable", "Task 1");
}
