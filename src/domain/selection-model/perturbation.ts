import type { CandidatePlan } from "../../shared/contracts/index.js";
import { NotImplementedError } from "./errors.js";
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
  _input: SolverInput,
  _currentPlan: CandidatePlan,
  _groupOrderings: readonly GroupOrdering[],
): { result: EnumerationResult; changeSet: PlanChangeSet | null } {
  throw new NotImplementedError("reoptimizeWithMinimalChange", "Task 1");
}
