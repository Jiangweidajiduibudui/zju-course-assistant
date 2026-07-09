import * as z from "zod";

/**
 * AI 友好日志契约 log.v1（D42；docs/08 §12）。
 *
 * 禁止记录（verify 与 code review 双重把关）：
 * 课程详情全文、用户偏好全文、评论原文、LLM prompt/response、
 * API key、Cookie、zdbk token、姓名、学号、身份证、手机号。
 */
export const logModuleSchema = z.enum([
  "import",
  "chalaoshi",
  "llm-gateway",
  "planner",
  "diagnostics",
  "selection-model",
  "server",
]);

export const logEventSchema = z.object({
  ts: z.iso.datetime({ offset: true }),
  level: z.enum(["debug", "info", "warn", "error"]),
  requestId: z.string().nullable(),
  generationId: z.string().nullable(),
  module: logModuleSchema,
  action: z.string().min(1),
  status: z.enum(["ok", "failed", "cancelled", "skipped"]),
  durationMs: z.number().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  /** chalaoshi 降级观测：seed/stale 成功响应时记录，便于与 live/cached 区分 */
  cacheState: z.enum(["live", "cached", "stale", "seed"]).nullable().optional(),
  schemaVersion: z.literal("log.v1"),
});

export type LogEvent = z.infer<typeof logEventSchema>;
export type LogModule = z.infer<typeof logModuleSchema>;
