import * as z from "zod";
import { termSlotSchema } from "./catalog.js";
import { courseCodeSchema, sectionIdSchema, volunteerRankSchema } from "./ids.js";

/**
 * 志愿组 / 候选方案 / 课表投影契约（D30、D37、D39、D42）。
 *
 * 两层输出（docs/08 §8）：
 * 1. 志愿提交方案（volunteer submission plan）—— 可手动录入 zdbk；
 * 2. 预期课表投影（timetable projection）—— 首选方案的课表视图。
 */

/** 志愿组：课程组优先；冲突时时间槽组失效（D37） */
export const volunteerGroupSchema = z.object({
  groupId: z.string().min(1),
  kind: z.enum(["course", "timeslot"]),
  /** kind=course 时为 courseCode；kind=timeslot 时为规范化时间槽 key */
  ref: z.string().min(1),
  /** 组内教学班顺位（最多 3 个，顺位 1/2/3；D30） */
  orderedSectionIds: z.array(sectionIdSchema).min(1).max(3),
  /** 组是否失效（如时间槽组被课程组占用）；失效必须给出原因（docs/08 §8.1） */
  invalidated: z
    .object({ reason: z.string().min(1), byGroupId: z.string().nullable() })
    .nullable(),
});
export type VolunteerGroup = z.infer<typeof volunteerGroupSchema>;

export const planVolunteerSchema = z.object({
  sectionId: sectionIdSchema,
  courseCode: courseCodeSchema,
  rank: volunteerRankSchema,
  groupId: z.string().min(1),
  /** 是否被用户手动锁定（重新优化不得改动 —— AC-7.1） */
  locked: z.boolean(),
});
export type PlanVolunteer = z.infer<typeof planVolunteerSchema>;

/** 一份完整候选方案（selection-model 产出，供 LLM 比较；D39 Top10） */
export const candidatePlanSchema = z.object({
  planId: z.string().min(1),
  volunteers: z.array(planVolunteerSchema),
  groups: z.array(volunteerGroupSchema),
  /** 总学分（不含学分缺失项 —— 缺失项根本不进方案，D38） */
  totalCredits: z.number().nonnegative(),
});
export type CandidatePlan = z.infer<typeof candidatePlanSchema>;

/** 课表投影单元格：同格可堆叠备选，但不得表现成同时上多门互斥课（docs/08 §8.2） */
export const projectionCellSchema = z.object({
  slot: termSlotSchema,
  /** 首选（当前方案中该格的主显示项） */
  primarySectionId: sectionIdSchema.nullable(),
  /** 备选堆叠（互斥候选，仅标记） */
  stackedSectionIds: z.array(sectionIdSchema),
  /** 冲突/未知标记 */
  flags: z.array(z.enum(["classTimeOverlap", "unknown"])),
});
export type ProjectionCell = z.infer<typeof projectionCellSchema>;

export const timetableProjectionSchema = z.object({
  schemaVersion: z.literal("projection.v1"),
  planId: z.string().min(1),
  cells: z.array(projectionCellSchema),
  /** 留在待选池的教学班及原因（考试/学分缺失等；D37、D38） */
  excluded: z.array(
    z.object({
      sectionId: sectionIdSchema,
      reasonCode: z.string().min(1),
    }),
  ),
});
export type TimetableProjection = z.infer<typeof timetableProjectionSchema>;

/** 求解器"无解"输出：冲突来源，交用户修改；不自动放松规则（D17） */
export const conflictReportSchema = z.object({
  errorCode: z.string().min(1),
  /** 涉及的教学班/课程/约束，供 UI 定位展示 */
  involvedSectionIds: z.array(sectionIdSchema),
  involvedCourseCodes: z.array(courseCodeSchema),
  description: z.string().min(1),
});
export type ConflictReport = z.infer<typeof conflictReportSchema>;
