import * as z from "zod";
import { baselineSchema } from "./baseline.js";
import { candidatePlanSchema } from "./plan.js";
import { poolSchema } from "./pool.js";
import { rulesSchema } from "./rules.js";

/**
 * session 契约（D08）。
 *
 * - session 只由用户手动创建，以创建时的导入状态为基线，从零开始；
 * - 待选池/规则/方案/对话不自动继承；历史 session 只读可查；
 * - 持久化在客户端 Dexie/IndexedDB（用户持久状态唯一事实源），服务端不保存。
 */
export const sessionSchema = z.object({
  schemaVersion: z.literal("session.v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  baseline: baselineSchema,
  pool: poolSchema,
  rules: rulesSchema,
  /** 当前方案；null = 尚未生成 */
  plan: candidatePlanSchema.nullable(),
  /**
   * 状态历史栈（AC-7.3 回滚）：每次"应用方案/重新优化/手动调整"
   * 入栈一个完整状态快照。Task 2 由组员 A/E 细化条目结构。
   */
  history: z.array(
    z.object({
      at: z.iso.datetime({ offset: true }),
      label: z.string().min(1),
      pool: poolSchema,
      rules: rulesSchema,
      plan: candidatePlanSchema.nullable(),
    }),
  ),
});
export type Session = z.infer<typeof sessionSchema>;

/** 导入/导出往返格式：导入 → 修改 → 导出 → 再导入必须一致（Task 2 门禁） */
export const exportEnvelopeSchema = z.object({
  schemaVersion: z.literal("export.v1"),
  exportedAt: z.iso.datetime({ offset: true }),
  session: sessionSchema,
});
export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;
