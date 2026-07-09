import * as z from "zod";
import { chalaoshiTeacherIdSchema } from "./ids.js";

/**
 * chalaoshi 数据契约（docs/03 §3；D28、D32、D41）。
 *
 * 所有对外展示的 chalaoshi 数据必须携带 sourceMeta：
 * 来源链接、抓取时间、缓存状态（live/cached/stale/seed）。
 * seed = 合成演示数据，UI 必须显式标记"演示数据"（D41）。
 */
export const sourceMetaSchema = z.object({
  sourceUrl: z.string().min(1),
  fetchedAt: z.iso.datetime({ offset: true }),
  cacheState: z.enum(["live", "cached", "stale", "seed"]),
});
export type SourceMeta = z.infer<typeof sourceMetaSchema>;

/** search.json 条目（docs/03 §3.1 实测结构） */
export const teacherIndexEntrySchema = z.object({
  id: chalaoshiTeacherIdSchema,
  name: z.string().min(1),
  /** 学院名（教师匹配要求姓名+学院同时一致，D13） */
  college: z.string().nullable(),
  rate: z.number().nullable(),
  hot: z.number().nullable(),
});
export type TeacherIndexEntry = z.infer<typeof teacherIndexEntrySchema>;

/** 教师详情：按课均绩分行（如 "微甲Ⅰ 3.97/500+"），含点名比例 */
export const teacherDetailSchema = z.object({
  teacherId: chalaoshiTeacherIdSchema,
  name: z.string().min(1),
  college: z.string().nullable(),
  rating: z.number().nullable(),
  ratingCount: z.number().int().nullable(),
  /** 均绩严格按课程展示，不跨课程替代（D14） */
  gpaByCourse: z.array(
    z.object({
      courseName: z.string().min(1),
      gpa: z.number().nullable(),
      sampleLabel: z.string().nullable(),
    }),
  ),
  /** "XX% 认为会点名" */
  callRollPercent: z.number().min(0).max(100).nullable(),
  sourceMeta: sourceMetaSchema,
});
export type TeacherDetail = z.infer<typeof teacherDetailSchema>;

export const commentSchema = z.object({
  /** 评论文本是不可信输入（D24）；只用于展示与 LLM 摘要，绝无状态修改通道 */
  text: z.string(),
  likes: z.number().int(),
  dislikes: z.number().int(),
  postedAt: z.iso.date(),
});
export type Comment = z.infer<typeof commentSchema>;

export const commentBatchSchema = z.object({
  teacherId: chalaoshiTeacherIdSchema,
  comments: z.array(commentSchema),
  sourceMeta: sourceMetaSchema,
});
export type CommentBatch = z.infer<typeof commentBatchSchema>;

/** 仓库内合成 seed cache 文件格式（docs/fixtures/demo-chalaoshi.synthetic.json） */
export const chalaoshiSeedSchema = z.object({
  schemaVersion: z.literal("chalaoshi-seed.v1"),
  synthetic: z.literal(true),
  generatedAt: z.iso.datetime({ offset: true }),
  teachers: z.array(
    teacherDetailSchema.omit({ sourceMeta: true }).extend({
      comments: z.array(commentSchema),
    }),
  ),
});
export type ChalaoshiSeed = z.infer<typeof chalaoshiSeedSchema>;
