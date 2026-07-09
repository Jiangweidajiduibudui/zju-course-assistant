import { type LogEvent, logEventSchema } from "../../../shared/contracts/log.js";

/**
 * AI 友好 JSON Lines 日志（D42；docs/08 §12）。
 *
 * - 每行一条稳定 Schema（log.v1）事件，输出到 stdout；
 * - 默认不外发任何遥测；诊断导出由用户主动触发（diagnostics 路由）；
 * - 禁止记录：课程详情全文、用户偏好全文、评论原文、LLM prompt/response、
 *   API key、Cookie、zdbk token、姓名、学号、身份证、手机号。
 *   新增日志字段前先对照该清单（code review 必查项）。
 */
export function logEvent(
  event: Omit<LogEvent, "ts" | "schemaVersion"> & Partial<Pick<LogEvent, "ts">>,
): void {
  const full: LogEvent = {
    ts: event.ts ?? new Date().toISOString(),
    schemaVersion: "log.v1",
    level: event.level,
    requestId: event.requestId,
    generationId: event.generationId,
    module: event.module,
    action: event.action,
    status: event.status,
    durationMs: event.durationMs,
    errorCode: event.errorCode,
    cacheState: event.cacheState ?? null,
  };
  // 开发/测试期校验 Schema，防止日志字段漂移；生产直接输出。
  if (process.env.NODE_ENV !== "production") {
    logEventSchema.parse(full);
  }
  process.stdout.write(`${JSON.stringify(full)}\n`);
}
