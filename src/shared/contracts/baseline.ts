import * as z from "zod";
import { sectionIdSchema, volunteerRankSchema } from "./ids.js";

/**
 * 基线快照契约（D18、D19）。
 *
 * baseline = { 已正式选上的教学班（固定）, 已填但待筛选的志愿及顺序（锁定） }。
 * 求解器视 selected 为不可动、volunteers 为锁定；重新导入后的同步走差异确认流程（AC-1.3）。
 */
export const baselineVolunteerSchema = z.object({
  sectionId: sectionIdSchema,
  rank: volunteerRankSchema,
});

export const baselineSchema = z.object({
  schemaVersion: z.literal("baseline.v1"),
  /** 已正式选上的教学班（固定，方案中不可改动 —— AC-6.1） */
  selected: z.array(sectionIdSchema),
  /** 已填但待筛选的志愿及顺序（锁定 —— AC-6.2） */
  volunteers: z.array(baselineVolunteerSchema),
  /** 用户导入时间：zdbk 数据无法自动刷新，生成前必须向用户确认时效性（D20） */
  importedAt: z.iso.datetime({ offset: true }),
});

export type Baseline = z.infer<typeof baselineSchema>;
export type BaselineVolunteer = z.infer<typeof baselineVolunteerSchema>;
