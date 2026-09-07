import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import {
  Comment,
  ExternalTeacher,
  type Review,
} from "../../shared/contracts/reviews.js";
import { fail } from "../errors.js";
import { anonymousReviewText, plainReviewText } from "./comments.js";
import { getReviewText, reviewUrl } from "./transport.js";

type Teacher = z.infer<typeof ExternalTeacher>;
export type ReviewContent = Pick<
  z.infer<typeof Review>,
  "source" | "teacherRating" | "courseGrades" | "availableCommentCount"
> & { comments: z.infer<typeof Comment>[] };
export interface ReviewDriver {
  synthetic: boolean;
  index(base: string, signal: AbortSignal): Promise<Teacher[]>;
  review(
    base: string,
    teacher: Teacher,
    signal: AbortSignal,
  ): Promise<ReviewContent>;
}
const normalized = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ");
const unknown = { state: "unknown" as const, reason: "not_provided" as const };
const stamp = () => new Date().toISOString();
function pageUrl(base: string, path: string) {
  return reviewUrl(new URL(path, `${base.replace(/\/+$/, "")}/`).href);
}
const Index = z.object({
  teachers: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(2000),
        xy: z.number().int(),
      }),
    )
    .max(50000),
  colleges: z
    .array(
      z.object({ id: z.number().int(), name: z.string().min(1).max(2000) }),
    )
    .max(1000),
});
export function parseTeacherIndex(
  raw: string,
  base: string,
  observedAt = stamp(),
): Teacher[] {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail("UPSTREAM_SCHEMA_CHANGED", "教师索引格式已变化，请稍后重试。");
  }
  const parsed = Index.safeParse(input);
  if (
    !parsed.success ||
    new Set(parsed.data.teachers.map((t) => t.id)).size !==
      parsed.data.teachers.length
  )
    return fail(
      "UPSTREAM_SCHEMA_CHANGED",
      "教师索引结构已变化，未尝试猜测匹配。",
    );
  const colleges = new Map(parsed.data.colleges.map((c) => [c.id, c.name]));
  return parsed.data.teachers.map((t) =>
    ExternalTeacher.parse({
      id: String(t.id),
      name: t.name,
      college: colleges.has(t.xy)
        ? { state: "known", value: colleges.get(t.xy) }
        : unknown,
      source: {
        provider: "chalaoshi",
        url: pageUrl(base, `teacher/${t.id}/`).href,
        observedAt,
      },
    }),
  );
}
export function parseTeacherDetail(
  html: string,
  teacher: Teacher,
  source: ReviewContent["source"],
): Omit<ReviewContent, "comments" | "availableCommentCount"> {
  const $ = load(html);
  const name = normalized($(".teacher .left h3").first().text());
  const college = normalized($(".teacher .left p#college").first().text());
  if (
    !name ||
    name !== normalized(teacher.name) ||
    (college &&
      teacher.college.state === "known" &&
      normalized(teacher.college.value) !== college)
  )
    return fail(
      "UPSTREAM_SCHEMA_CHANGED",
      "评价页面的教师身份与匹配结果不一致，请重新核对。",
    );
  const rating = plainReviewText($(".teacher .right h2").first().text()).slice(
    0,
    100,
  );
  const sample = plainReviewText($(".teacher .right p").first().text()).slice(
    0,
    100,
  );
  const teacherRating: ReviewContent["teacherRating"] = rating
    ? {
        state: "unknown",
        reason: "not_verified",
        displayText: `${rating}${sample ? ` · ${sample}` : ""}`,
      }
    : unknown;
  const courseGrades: ReviewContent["courseGrades"] = [];
  $(".course-list .row").each((_index, element) => {
    const row = $(element),
      label = plainReviewText(
        row.find(".left .course_name").first().text(),
      ).slice(0, 2000);
    if (!label) return;
    const raw = plainReviewText(row.find(".right p").first().text()).slice(
      0,
      2000,
    );
    const id = `course-${createHash("sha256").update(label).digest("hex").slice(0, 24)}`;
    // The source declares no scale; retain its text without inventing Metric bounds.
    courseGrades.push({
      id,
      label,
      average: raw
        ? { state: "unknown", reason: "not_verified", displayText: raw }
        : unknown,
    });
  });
  if (
    courseGrades.length > 1000 ||
    new Set(courseGrades.map((c) => c.id)).size !== courseGrades.length
  )
    return fail(
      "UPSTREAM_SCHEMA_CHANGED",
      "课程评价条目有歧义，请直接查看原页。",
    );
  return { source, teacherRating, courseGrades };
}
export function parseComments(html: string): z.infer<typeof Comment>[] {
  if (!html.trim()) return [];
  const $ = load(html, {}, false);
  // The endpoint may send alternate orderings after a separator. Parse one set.
  $("hr#sep").first().nextAll().remove();
  const containers = $("div#comment-page");
  if (!containers.length) {
    const text = $.root().text().trim();
    if (/^(?:暂无评论|暂无评价|没有评论|还没有评论)[。！!\s]*$/.test(text))
      return [];
    return fail(
      "UPSTREAM_SCHEMA_CHANGED",
      "评论页面结构已变化，未把页面正文当作评价。",
    );
  }
  const comments: z.infer<typeof Comment>[] = [];
  const seen = new Set<string>();
  containers.each((_index, container) => {
    const body = $(container).find(".row > .left > p").first();
    if (!body.length) return;
    const text = anonymousReviewText(body.html() ?? "").slice(0, 10000);
    if (!text) return;
    const hash = createHash("sha256").update(text).digest("hex");
    if (seen.has(hash)) return;
    seen.add(hash);
    comments.push(
      Comment.parse({
        id: `comment-${hash.slice(0, 24)}`,
        text,
        postedAt: unknown,
      }),
    );
  });
  if (comments.length > 10000)
    return fail("PAYLOAD_TOO_LARGE", "评论数量超出本次读取上限。");
  if (!comments.length)
    return fail("UPSTREAM_SCHEMA_CHANGED", "未找到可识别的评论正文。");
  return comments;
}

export class LiveReviews implements ReviewDriver {
  readonly synthetic = false;
  constructor(private read = getReviewText) {}
  async index(base: string, signal: AbortSignal) {
    const url = pageUrl(base, "static/json/search.json");
    return parseTeacherIndex(await this.read(url, signal), base);
  }
  async review(
    base: string,
    teacher: Teacher,
    signal: AbortSignal,
  ): Promise<ReviewContent> {
    if (!/^\d+$/.test(teacher.id))
      return fail("VALIDATION_FAILED", "教师编号格式无效。");
    const detailUrl = pageUrl(base, `teacher/${teacher.id}/`);
    const html = await this.read(detailUrl, signal);
    const detail = parseTeacherDetail(html, teacher, {
      provider: "chalaoshi",
      url: detailUrl.href,
      observedAt: stamp(),
    });
    // Current source JS derives APIDOMAIN from its own hostname. Never follow a
    // URL supplied by an external comment, DOM link or browser request payload.
    const commentsUrl = reviewUrl(
      `https://api.${new URL(base).hostname}/comments/${teacher.id}`,
    );
    const comments = parseComments(await this.read(commentsUrl, signal));
    return {
      ...detail,
      comments,
      availableCommentCount: { state: "known", value: comments.length },
    };
  }
}
