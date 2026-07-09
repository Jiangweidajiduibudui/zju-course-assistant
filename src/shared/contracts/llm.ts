import * as z from "zod";
import { sectionIdSchema } from "./ids.js";
import { ruleBarSchema } from "./rules.js";

/**
 * LLM 任务 I/O 契约（D25；docs/04 §4.3）。
 *
 * 铁律：
 * - 全部任务固定 JSON Schema 输出；校验失败即任务失败，不从自然语言猜测结果；
 * - LLM 输出只有通过 selection-model 终校验后才能触达状态；
 * - 评论摘要（reviewSummary）是纯展示数据，无任何状态修改通道（D24）；
 * - 需要发给端点的 JSON Schema 用 z.toJSONSchema() 从本文件生成，不得手写第二份。
 */

/** ① 偏好结构化：自然语言 → 规则栏建议（用户确认后生效，AC-5.3） */
export const preferenceStructuringOutputSchema = z.object({
  suggestedRules: z.array(ruleBarSchema),
  explanation: z.string(),
});
export type PreferenceStructuringOutput = z.infer<typeof preferenceStructuringOutputSchema>;

/** ② 评论摘要：只读展示（D12 样本量规则；D24 无状态通道） */
export const reviewSummaryOutputSchema = z.object({
  attendance: z.object({
    called: z.enum(["yes", "no", "unknown"]),
    form: z.string().nullable(),
  }),
  pros: z.array(z.string()).min(1),
  cons: z.array(z.string()).min(1),
  sampleSize: z.number().int().nonnegative(),
  lowSample: z.boolean(),
});
export type ReviewSummaryOutput = z.infer<typeof reviewSummaryOutputSchema>;

/** ③ 组内排序：orderedSectionIds 必须 ⊆ 输入组内 ID（越界 = LLM_ID_OUT_OF_INPUT） */
export const groupRankingOutputSchema = z.object({
  groupRankings: z.array(
    z.object({
      groupId: z.string().min(1),
      orderedSectionIds: z.array(sectionIdSchema).min(1),
      reasons: z.array(z.string()),
    }),
  ),
});
export type GroupRankingOutput = z.infer<typeof groupRankingOutputSchema>;

/** ④ 方案比较：chosenPlanId 必须属于输入 Top10 集合（D39） */
export const planComparisonOutputSchema = z.object({
  chosenPlanId: z.string().min(1),
  ranking: z.array(z.string().min(1)),
  reasons: z.array(z.string()),
});
export type PlanComparisonOutput = z.infer<typeof planComparisonOutputSchema>;

/** ⑤ 解释：纯文本回答，无状态操作 */
export const explainOutputSchema = z.object({
  answer: z.string(),
});
export type ExplainOutput = z.infer<typeof explainOutputSchema>;

/** 端点配置（用户自备；key 只随单次请求进入后端内存 —— D40） */
export const llmEndpointConfigSchema = z.object({
  baseUrl: z.url(),
  model: z.string().min(1),
  /** 能力检测结果决定可用功能分级（D10） */
  capability: z.enum(["unknown", "structured", "basic", "insufficient"]),
});
export type LlmEndpointConfig = z.infer<typeof llmEndpointConfigSchema>;
