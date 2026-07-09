/**
 * selection-model 公共 API（D36；组员 C 主责，docs/08 §9.1）。
 *
 * 边界（docs/08 §5.1）：
 * - 纯 TypeScript 纯函数：禁止调用 LLM、读写数据库、访问浏览器/网络/文件系统；
 * - 只依赖 src/shared/contracts；禁止 import React、Fastify、Dexie、pg；
 * - 所有硬约束逻辑集中于此，其他模块只能调用，不得复制。
 */

export { enumerateTopPlans } from "./enumerate.js";
export { NotImplementedError } from "./errors.js";
export { assessSchedulability } from "./feasibility.js";
export { reoptimizeWithMinimalChange } from "./perturbation.js";
export { projectTimetable } from "./projection.js";
export { estimateRisk } from "./risk.js";
export { classTimesOverlap, timeslotKey } from "./timeslot.js";
export type {
  EnumerationResult,
  GroupOrdering,
  PlanChangeSet,
  SchedulabilityResult,
  SolverInput,
  TimeslotKey,
  ValidationResult,
} from "./types.js";
export { finalValidate } from "./validate.js";
export { buildVolunteerGroups } from "./volunteer-groups.js";
