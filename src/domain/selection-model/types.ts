import type {
  Baseline,
  CandidatePlan,
  ConflictReport,
  Pool,
  Rules,
  Section,
  SectionId,
  TermSlot,
} from "../../shared/contracts/index.js";

/**
 * selection-model 内部类型（组员 C 主责）。
 *
 * 本模块是全部选课数学模型与硬校验的唯一实现地（D36）：
 * 前端只渲染状态，后端只编排流程，任何地方不得复制一份"简化版规则"。
 */

/** 求解输入（docs/04 §3.1）：全部为纯数据，无 IO */
export interface SolverInput {
  /** 教学班全集（按 sectionId 索引；由调用方从 catalog 装配） */
  sections: ReadonlyMap<SectionId, Section>;
  /** 基线：selected 固定、volunteers 锁定（D18） */
  baseline: Baseline;
  /** 待选池：目标课程 + 候选教学班（推荐只在池内决策） */
  pool: Pool;
  /** 规则栏 + 必填学分上限（D17、D38） */
  rules: Rules;
  /** 用户手动锁定的教学班（重新优化不得改动，AC-7.1） */
  lockedSectionIds: ReadonlySet<SectionId>;
}

/** 归一化时间槽 key：`${term}-${dayOfWeek}-${period}`（D37，不含单双周） */
export type TimeslotKey = string;

/** 可排性判定结果：不可排的教学班停留在待选池并说明原因（D37、D38） */
export interface SchedulabilityResult {
  schedulable: SectionId[];
  excluded: Array<{ sectionId: SectionId; reasonCode: string }>;
}

/** 组内排序（阶段③ LLM 产出、经校验后传入阶段④） */
export interface GroupOrdering {
  groupId: string;
  orderedSectionIds: SectionId[];
}

/** 枚举输出：Top10 完整候选方案，或无解 + 冲突来源（D17、D39） */
export type EnumerationResult =
  | { kind: "plans"; plans: CandidatePlan[] }
  | { kind: "infeasible"; conflicts: ConflictReport[] };

/** 终校验结果：任何失败都必须给出稳定错误码（Task 1 门禁） */
export type ValidationResult = { kind: "valid" } | { kind: "invalid"; conflicts: ConflictReport[] };

/** 最小扰动重排的变更集（供 UI 高亮，AC-7.2） */
export interface PlanChangeSet {
  added: SectionId[];
  removed: SectionId[];
  rankChanged: Array<{ sectionId: SectionId; from: number; to: number }>;
}

export type { TermSlot };
