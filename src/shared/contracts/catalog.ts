import * as z from "zod";
import { courseCodeSchema, sectionIdSchema } from "./ids.js";

/**
 * 课程目录契约 catalog.v1（Task 0 草案）。
 *
 * 数据来源：用户手动输入/导入 JSON，或仓库合成 fixture（D31、D41）。
 * 字段语义对照 docs/03 §2.2；zdbk 复合字段（rs/yxrs/学分）在选课期核验前
 * 一律放入 unverifiedRaw，不得凭名称臆断语义（F-10 → PROJECT.md 硬规则 H11）。
 */

/** 时间槽：学期 + 星期 + 节次；不区分单双周（D37） */
export const termSlotSchema = z.object({
  term: z.enum(["spring", "summer", "autumn", "winter"]),
  /** 星期一=1 … 星期日=7 */
  dayOfWeek: z.number().int().min(1).max(7),
  /** 第几节（zdbk 节次编号） */
  period: z.number().int().min(1).max(15),
});
export type TermSlot = z.infer<typeof termSlotSchema>;

/**
 * 考试时间：以可比较的规范化字符串为准（同一 examKey = 同一考试时段）。
 * null = 考试时间缺失 → 教学班停留在待选池，不参与排课（D37）。
 */
export const examTimeSchema = z
  .object({
    /** 规范化考试时段 key（相同 key 视为时间重叠） */
    examKey: z.string().min(1),
    /** 原始展示文本（如 "2026-08-30 08:00-10:00"） */
    raw: z.string().min(1),
  })
  .nullable();
export type ExamTime = z.infer<typeof examTimeSchema>;

/** 教学班（section；zdbk 术语=教学班，唯一标识 xkkh） */
export const sectionSchema = z.object({
  sectionId: sectionIdSchema,
  courseCode: courseCodeSchema,
  courseName: z.string().min(1),
  /** 教师姓名列表（zdbk jsxm 以 <br> 分隔多师，导入时拆开） */
  teachers: z.array(z.string().min(1)).min(1),
  /** 上课时间槽；重叠不判无解，交组内排序与 LLM（D37） */
  slots: z.array(termSlotSchema),
  /** 上课地点（展示用） */
  place: z.string().nullable(),
  examTime: examTimeSchema,
  /** 学分；null = 缺失 → 停留在待选池（D38） */
  credits: z.number().nonnegative().nullable(),
  /** 未核验的 zdbk 复合字段原文（rs/yxrs 等；F-10），仅原样展示，不参与计算 */
  unverifiedRaw: z.record(z.string(), z.string()).optional(),
});
export type Section = z.infer<typeof sectionSchema>;

export const courseSchema = z.object({
  courseCode: courseCodeSchema,
  courseName: z.string().min(1),
  /** 开课学院（kkxy） */
  college: z.string().nullable(),
  /** 分类必须来自导入数据，不得硬编码（F-05、AC-2.1） */
  category: z.string().nullable(),
  sections: z.array(sectionSchema).min(1),
});
export type Course = z.infer<typeof courseSchema>;

export const catalogSchema = z.object({
  schemaVersion: z.literal("catalog.v1"),
  /** 合成数据必须显式标记（D41）；E2E 与 UI 依赖该标记显示"演示数据" */
  synthetic: z.boolean(),
  generatedAt: z.iso.datetime({ offset: true }),
  courses: z.array(courseSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
