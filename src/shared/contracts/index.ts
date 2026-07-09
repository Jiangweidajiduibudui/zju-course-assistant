/**
 * 共享契约唯一入口（Task 0；docs/08 §5.1）。
 *
 * 本目录是前后端与 LLM Schema 的单一事实源：
 * - 只允许 Zod Schema、DTO、错误码、日志字段枚举；
 * - 禁止引入 React、Fastify、Dexie、pg 或任何运行时实现；
 * - 公共 Schema 改动必须由负责人批准（docs/08 §9.1）。
 */
export * from "./baseline.js";
export * from "./catalog.js";
export * from "./chalaoshi.js";
export * from "./errors.js";
export * from "./ids.js";
export * from "./llm.js";
export * from "./log.js";
export * from "./plan.js";
export * from "./pool.js";
export * from "./rules.js";
export * from "./session.js";
