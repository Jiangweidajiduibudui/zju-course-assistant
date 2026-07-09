import { NotImplementedError } from "./errors.js";
import type { EnumerationResult, GroupOrdering, SolverInput } from "./types.js";

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
  _input: SolverInput,
  _groupOrderings: readonly GroupOrdering[],
  _maxPlans = 10,
): EnumerationResult {
  throw new NotImplementedError("enumerateTopPlans", "Task 1");
}
