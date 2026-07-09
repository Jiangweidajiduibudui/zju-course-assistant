import type { CandidatePlan } from "../../shared/contracts/index.js";
import { NotImplementedError } from "./errors.js";
import type { SolverInput, ValidationResult } from "./types.js";

/**
 * 确定性终校验（阶段⑥；D25、D30；docs/04 §4.3 校验链）——
 * 本函数是"LLM 输出触达状态"前的最后一道闸，也是性质测试的核心不变量：
 * **终校验永不接受非法方案**（Task 1 门禁）。
 *
 * 校验链（顺序固定）：
 * 1. Schema 合法（调用方已由 Zod 保证，此处防御性复查关键字段）；
 * 2. 教学班 ID 全部存在且属于待选池（MODEL_SECTION_NOT_IN_POOL）；
 * 3. 课程覆盖满足（待选池目标课程都有志愿）；
 * 4. 课程/时间段志愿组均 ≤3 且顺位唯一（MODEL_VOLUNTEER_LIMIT_*）；
 * 5. 锁定状态保持：已选固定、已填志愿锁定、手动锁定不变（MODEL_LOCK_VIOLATION）;
 * 6. 硬约束通过：考试冲突、学分上限、规则栏硬约束（MODEL_EXAM_CONFLICT 等）。
 *
 * 任何失败 → 不改动当前方案（D27 原子性）。
 *
 * Task 1 交付（Task 4 前必须可被 planner 调用）；
 * 测试锚点：tests/domain/validate.test.ts + properties.test.ts。
 */
export function finalValidate(_input: SolverInput, _plan: CandidatePlan): ValidationResult {
  throw new NotImplementedError("finalValidate", "Task 1");
}
