import type { Comment, TeacherDetail, TeacherIndexEntry } from "../../../shared/contracts/index.js";

/**
 * chalaoshi 解析器（组员 B；docs/03 §3.1 实测结构）。
 *
 * 三个上游形态：
 * 1. search.json —— teachers[{id,name,py,sx,xy,hot,rate}] + colleges[{id,name}]（~1.05MB）；
 * 2. 教师详情页 HTML —— 服务端直出；均绩按课程分行（"微甲Ⅰ 3.97/500+"）、"XX% 认为会点名"；
 * 3. 评论接口 —— 直接返回评论 HTML 片段（赞踩数 + 发布日期），无需会话（F-03）。
 *
 * 铁律：上游结构改变时必须显式失败（抛 ChalaoshiParseError），
 * 不得用部分错位数据更新缓存（docs/05 §5.2）。
 * HTML 解析用 cheerio：`import * as cheerio from "cheerio"` 后 load()（docs/07 §4.6）。
 *
 * Task 3 交付；测试锚点：tests/server/chalaoshi-parser.test.ts（fixture 驱动）。
 */
export class ChalaoshiParseError extends Error {
  constructor(
    readonly source: "search-json" | "teacher-detail" | "comments",
    message: string,
  ) {
    super(`chalaoshi 解析失败(${source}): ${message}`);
    this.name = "ChalaoshiParseError";
  }
}

export function parseSearchJson(_raw: unknown): TeacherIndexEntry[] {
  throw new ChalaoshiParseError("search-json", "解析器未实现（Task 3）");
}

export function parseTeacherDetailHtml(_html: string, _sourceUrl: string): TeacherDetail {
  throw new ChalaoshiParseError("teacher-detail", "解析器未实现（Task 3）");
}

export function parseCommentsHtml(_html: string): Comment[] {
  throw new ChalaoshiParseError("comments", "解析器未实现（Task 3）");
}
