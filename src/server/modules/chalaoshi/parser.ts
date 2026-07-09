import * as cheerio from "cheerio";
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

interface SearchCollege {
  id: number;
  name: string;
}

interface SearchTeacherRaw {
  id: number;
  name: string;
  xy?: number | null;
  hot?: number | null;
  rate?: number | null;
}

/** 解析 search.json；缺 teachers/colleges 或条目不可映射时显式失败 */
export function parseSearchJson(raw: unknown): TeacherIndexEntry[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ChalaoshiParseError("search-json", "根节点必须是对象");
  }
  const root = raw as { teachers?: unknown; colleges?: unknown };
  if (!Array.isArray(root.teachers)) {
    throw new ChalaoshiParseError("search-json", "缺少 teachers 数组");
  }
  if (!Array.isArray(root.colleges)) {
    throw new ChalaoshiParseError("search-json", "缺少 colleges 数组");
  }

  const collegeById = new Map<number, string>();
  for (const item of root.colleges) {
    if (item === null || typeof item !== "object") {
      throw new ChalaoshiParseError("search-json", "college 条目必须是对象");
    }
    const college = item as SearchCollege;
    if (
      typeof college.id !== "number" ||
      typeof college.name !== "string" ||
      !college.name.trim()
    ) {
      throw new ChalaoshiParseError("search-json", "college 缺少有效 id/name");
    }
    collegeById.set(college.id, college.name.trim());
  }

  const entries: TeacherIndexEntry[] = [];
  for (const item of root.teachers) {
    if (item === null || typeof item !== "object") {
      throw new ChalaoshiParseError("search-json", "teacher 条目必须是对象");
    }
    const teacher = item as SearchTeacherRaw;
    if (typeof teacher.id !== "number" || !Number.isInteger(teacher.id) || teacher.id < 0) {
      throw new ChalaoshiParseError("search-json", "teacher.id 无效");
    }
    if (typeof teacher.name !== "string" || !teacher.name.trim()) {
      throw new ChalaoshiParseError("search-json", `teacher[${teacher.id}] 缺少 name`);
    }
    const collegeId = teacher.xy;
    const college = typeof collegeId === "number" ? (collegeById.get(collegeId) ?? null) : null;
    entries.push({
      id: teacher.id,
      name: teacher.name.trim(),
      college,
      rate: typeof teacher.rate === "number" ? teacher.rate : null,
      hot: typeof teacher.hot === "number" ? teacher.hot : null,
    });
  }
  return entries;
}

/** 均绩行：`课程名 3.97/500+` */
const GPA_LINE_RE = /^(.+?)\s+(\d+(?:\.\d+)?)\/(.+)$/;
/** `12% 认为会点名` */
const CALL_ROLL_RE = /(\d+(?:\.\d+)?)\s*%\s*认为会点名/;

/**
 * 解析教师详情 HTML。
 * 合成 fixture 使用稳定 class；真实页若结构漂移则抛错，禁止半解析写缓存。
 */
export function parseTeacherDetailHtml(html: string, sourceUrl: string): TeacherDetail {
  if (typeof html !== "string" || html.trim().length === 0) {
    throw new ChalaoshiParseError("teacher-detail", "HTML 为空");
  }

  const $ = cheerio.load(html);
  const main = $("main[data-teacher-id]").first();
  if (main.length === 0) {
    throw new ChalaoshiParseError("teacher-detail", "缺少 main[data-teacher-id]");
  }

  const idAttr = main.attr("data-teacher-id");
  const teacherId = Number(idAttr);
  if (!Number.isInteger(teacherId) || teacherId < 0) {
    throw new ChalaoshiParseError("teacher-detail", `无效 teacherId: ${idAttr ?? ""}`);
  }

  const name = main.find(".teacher-name").first().text().trim();
  if (!name) {
    throw new ChalaoshiParseError("teacher-detail", "缺少教师姓名");
  }

  const collegeText = main.find(".college").first().text().trim();
  const college = collegeText.length > 0 ? collegeText : null;

  const ratingRaw = main.find(".rating-value").first().text().trim();
  const ratingCountRaw = main.find(".rating-count").first().text().trim();
  const rating = ratingRaw === "" ? null : Number(ratingRaw);
  const ratingCount = ratingCountRaw === "" ? null : Number(ratingCountRaw);
  if (rating !== null && Number.isNaN(rating)) {
    throw new ChalaoshiParseError("teacher-detail", `评分无法解析: ${ratingRaw}`);
  }
  if (ratingCount !== null && (!Number.isInteger(ratingCount) || ratingCount < 0)) {
    throw new ChalaoshiParseError("teacher-detail", `评分人数无法解析: ${ratingCountRaw}`);
  }

  const gpaByCourse: TeacherDetail["gpaByCourse"] = [];
  main.find(".gpa-list li").each((_, el) => {
    const line = $(el).text().replace(/\s+/g, " ").trim();
    if (!line) {
      return;
    }
    const match = GPA_LINE_RE.exec(line);
    if (!match) {
      throw new ChalaoshiParseError("teacher-detail", `均绩行无法解析: ${line}`);
    }
    const courseName = match[1]?.trim() ?? "";
    const gpa = Number(match[2]);
    const sampleLabel = match[3]?.trim() || null;
    if (!courseName || Number.isNaN(gpa)) {
      throw new ChalaoshiParseError("teacher-detail", `均绩行字段无效: ${line}`);
    }
    gpaByCourse.push({ courseName, gpa, sampleLabel });
  });

  const callRollText = main.find(".call-roll").first().text();
  let callRollPercent: number | null = null;
  if (callRollText.trim()) {
    const match = CALL_ROLL_RE.exec(callRollText);
    if (!match) {
      throw new ChalaoshiParseError("teacher-detail", `点名比例无法解析: ${callRollText}`);
    }
    callRollPercent = Number(match[1]);
    if (Number.isNaN(callRollPercent) || callRollPercent < 0 || callRollPercent > 100) {
      throw new ChalaoshiParseError("teacher-detail", `点名比例越界: ${callRollText}`);
    }
  }

  const fetchedAt = new Date().toISOString();
  return {
    teacherId,
    name,
    college,
    rating,
    ratingCount,
    gpaByCourse,
    callRollPercent,
    sourceMeta: {
      sourceUrl,
      fetchedAt,
      cacheState: "live",
    },
  };
}

/** 解析评论 HTML 片段；无 `.comment` 视为空列表（合法） */
export function parseCommentsHtml(html: string): Comment[] {
  if (typeof html !== "string") {
    throw new ChalaoshiParseError("comments", "HTML 必须是字符串");
  }

  const $ = cheerio.load(html);
  const nodes = $(".comment");
  // 有 comment-list 但无条目 → 空；既无 list 也无 comment 且正文非空 → 结构未知
  if (nodes.length === 0) {
    if ($(".comment-list").length > 0 || html.trim().length === 0) {
      return [];
    }
    throw new ChalaoshiParseError("comments", "未识别到 comment 结构");
  }

  const comments: Comment[] = [];
  nodes.each((_, el) => {
    const node = $(el);
    const text = node.find(".comment-text").first().text().trim();
    const likesRaw = node.find(".likes").first().text().trim();
    const dislikesRaw = node.find(".dislikes").first().text().trim();
    const postedAt =
      node.find("time.posted-at").attr("datetime")?.trim() ||
      node.find(".posted-at").first().text().trim();

    if (!text) {
      throw new ChalaoshiParseError("comments", "评论缺少文本");
    }
    const likes = Number(likesRaw);
    const dislikes = Number(dislikesRaw);
    if (!Number.isInteger(likes) || likes < 0 || !Number.isInteger(dislikes) || dislikes < 0) {
      throw new ChalaoshiParseError(
        "comments",
        `赞踩数无效: likes=${likesRaw} dislikes=${dislikesRaw}`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postedAt)) {
      throw new ChalaoshiParseError("comments", `发布日期无效: ${postedAt}`);
    }
    comments.push({ text, likes, dislikes, postedAt });
  });
  return comments;
}
