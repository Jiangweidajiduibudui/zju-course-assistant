import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ChalaoshiParseError,
  parseCommentsHtml,
  parseSearchJson,
  parseTeacherDetailHtml,
} from "../../src/server/modules/chalaoshi/parser.js";

/** chalaoshi 解析器（组员 B；docs/05 §1）：fixture 驱动，不访问真实上游。 */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures/chalaoshi");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

describe("parseSearchJson", () => {
  it("合成 search.json 解析成功并映射学院名", () => {
    const entries = parseSearchJson(JSON.parse(readFixture("search.synthetic.json")));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      id: 900001,
      name: "演示教师甲",
      college: "演示学院",
      rate: 4.6,
      hot: 1280,
    });
    expect(entries[2]?.rate).toBeNull();
    expect(entries[2]?.college).toBe("合成学院");
  });

  it("缺少 teachers → ChalaoshiParseError", () => {
    expect(() =>
      parseSearchJson(JSON.parse(readFixture("search-malformed.synthetic.json"))),
    ).toThrow(ChalaoshiParseError);
  });

  it("根节点非对象 → 显式失败", () => {
    expect(() => parseSearchJson([])).toThrow(/根节点必须是对象/);
  });
});

describe("parseTeacherDetailHtml", () => {
  it("合成详情页解析均绩分行与点名比例", () => {
    const detail = parseTeacherDetailHtml(
      readFixture("teacher-detail.synthetic.html"),
      "https://chalaoshi.de/teacher/900001/",
    );
    expect(detail.teacherId).toBe(900001);
    expect(detail.name).toBe("演示教师甲");
    expect(detail.college).toBe("演示学院");
    expect(detail.rating).toBe(4.6);
    expect(detail.ratingCount).toBe(128);
    expect(detail.callRollPercent).toBe(12);
    expect(detail.gpaByCourse).toEqual([
      { courseName: "合成微积分演示", gpa: 3.97, sampleLabel: "500+" },
      { courseName: "合成线性代数演示", gpa: 3.8, sampleLabel: "200+" },
    ]);
    expect(detail.sourceMeta.sourceUrl).toContain("/teacher/900001/");
    expect(detail.sourceMeta.cacheState).toBe("live");
  });

  it("无均绩/无点名比例仍可解析", () => {
    const detail = parseTeacherDetailHtml(
      readFixture("teacher-detail-empty.synthetic.html"),
      "https://chalaoshi.de/teacher/900003/",
    );
    expect(detail.teacherId).toBe(900003);
    expect(detail.gpaByCourse).toEqual([]);
    expect(detail.callRollPercent).toBeNull();
    expect(detail.rating).toBeNull();
  });

  it("缺少 main[data-teacher-id] → 显式失败", () => {
    expect(() =>
      parseTeacherDetailHtml("<html><body><h1>无结构</h1></body></html>", "https://example.test"),
    ).toThrow(ChalaoshiParseError);
  });
});

describe("parseCommentsHtml", () => {
  it("合成评论片段解析赞踩与日期", () => {
    const comments = parseCommentsHtml(readFixture("comments.synthetic.html"));
    expect(comments).toHaveLength(3);
    expect(comments[0]).toEqual({
      text: "（合成评论）讲课清晰，作业量适中。",
      likes: 8,
      dislikes: 0,
      postedAt: "2025-10-12",
    });
  });

  it("空评论列表合法", () => {
    expect(parseCommentsHtml(readFixture("comments-empty.synthetic.html"))).toEqual([]);
  });

  it("未知结构 → 显式失败", () => {
    expect(() => parseCommentsHtml("<div>random cloudflare page</div>")).toThrow(
      ChalaoshiParseError,
    );
  });
});
