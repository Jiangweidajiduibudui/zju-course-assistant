import type { Section } from "../../shared/contracts/index.js";

/**
 * 录取风险估计（D01、D30 —— 冻结中）。
 *
 * 志愿与基本顺位规则已闭环，但待选人数是三档聚合值，缺少真实顺位分布
 * 与校准数据。在 docs/02 规则档闭环并新增决策解冻前：
 * - 本函数永远返回 { status: "unavailable" }；
 * - UI 恒显示"暂不可评估"；
 * - 禁止实现任何数值概率、"稳/悬/危"档位或占位算法（PROJECT.md 硬规则 H3）。
 *
 * 这不是 stub —— 这是当前的正确实现。解冻须产品负责人在 docs/06 追加决策。
 */
export function estimateRisk(
  _section: Section,
  _context: unknown,
): { status: "unavailable" } {
  return { status: "unavailable" };
}
