import * as z from "zod";

/**
 * 标识符契约（Task 0 草案，负责人批准后才能改 —— PROJECT.md 硬规则 H2）。
 *
 * 命名映射（语义见 docs/03 §2.2）：
 * - courseCode  ← zdbk `kcdm`（课程代码）
 * - sectionId   ← zdbk `xkkh`（选课课号，教学班唯一标识）
 * - teacherId   ← chalaoshi 教师 id
 */
export const courseCodeSchema = z.string().min(1).describe("课程代码（kcdm）");
export const sectionIdSchema = z.string().min(1).describe("教学班唯一标识（xkkh）");
export const chalaoshiTeacherIdSchema = z.number().int().nonnegative().describe("chalaoshi 教师 id");

export type CourseCode = z.infer<typeof courseCodeSchema>;
export type SectionId = z.infer<typeof sectionIdSchema>;
export type ChalaoshiTeacherId = z.infer<typeof chalaoshiTeacherIdSchema>;

/** 志愿顺位：1/2/3（D30） */
export const volunteerRankSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type VolunteerRank = z.infer<typeof volunteerRankSchema>;
