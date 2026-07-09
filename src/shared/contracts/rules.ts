import * as z from "zod";
import { courseCodeSchema } from "./ids.js";

/**
 * 规则栏契约（FR-5、D17）。
 *
 * 每条规则栏 = 作用范围 + 偏好顺序 + 硬约束。
 * 优先级固定：手动锁定 > 局部硬约束 > 全局硬约束 > 局部软偏好 > 全局软偏好（D17）。
 * 无解时不自动放松、不允许 LLM 决定牺牲哪条硬约束。
 *
 * ⚠️ Task 0 草案：偏好维度枚举与硬约束表达式是首个契约评审重点，
 * 改动需负责人批准（组员 C 与组员 D 是主要消费方）。
 */
export const preferenceKeySchema = z.enum([
  "gpa", // 按课均绩
  "rating", // chalaoshi 评分
  "timeComfort", // 时间舒适度（如无早八）
  "teacherReputation", // 评论口碑
  "examSchedule", // 考试时间分布
]);

export const hardConstraintSchema = z.object({
  kind: z.enum(["forbid", "require"]),
  /** 约束表达式；Task 0 先支持时间槽类约束，如 { type: "timeslot", dayOfWeek, period } */
  expr: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("timeslot"),
      dayOfWeek: z.number().int().min(1).max(7),
      period: z.number().int().min(1).max(15),
    }),
    z.object({
      type: z.literal("teacher"),
      teacherName: z.string().min(1),
    }),
  ]),
});

export const ruleScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("course"), courseCode: courseCodeSchema }),
  z.object({ type: z.literal("category"), category: z.string().min(1) }),
]);

export const ruleBarSchema = z.object({
  id: z.string().min(1),
  scope: ruleScopeSchema,
  /** 偏好顺序（靠前优先）；只影响软排序，绝不进入硬过滤（D17） */
  ordering: z.array(preferenceKeySchema),
  hardConstraints: z.array(hardConstraintSchema),
});

export const rulesSchema = z.object({
  schemaVersion: z.literal("rules.v1"),
  /** 用户必填学分上限（D38）；null = 未填写 → 不能生成推荐 */
  creditLimit: z.number().positive().nullable(),
  bars: z.array(ruleBarSchema),
});

export type PreferenceKey = z.infer<typeof preferenceKeySchema>;
export type HardConstraint = z.infer<typeof hardConstraintSchema>;
export type RuleScope = z.infer<typeof ruleScopeSchema>;
export type RuleBar = z.infer<typeof ruleBarSchema>;
export type Rules = z.infer<typeof rulesSchema>;
