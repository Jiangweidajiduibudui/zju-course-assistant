import * as z from "zod";
import { courseCodeSchema, sectionIdSchema } from "./ids.js";

/**
 * 待选池契约（PRD §5）。
 *
 * 待选池只表达两件事：用户希望补齐哪些课程 + 每门课接受哪些候选教学班。
 * 推荐器只在池内决策，绝不引入或提示池外班级（AC-4.2 —— 性质测试"池内性"）。
 */
export const poolTargetSchema = z.object({
  courseCode: courseCodeSchema,
  candidateSectionIds: z.array(sectionIdSchema).min(1),
});

export const poolSchema = z.object({
  schemaVersion: z.literal("pool.v1"),
  targets: z.array(poolTargetSchema),
});

export type Pool = z.infer<typeof poolSchema>;
export type PoolTarget = z.infer<typeof poolTargetSchema>;
