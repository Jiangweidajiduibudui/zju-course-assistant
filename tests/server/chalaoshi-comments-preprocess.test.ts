import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preprocessComments } from "../../src/server/modules/chalaoshi/comments-preprocess.js";
import { parseCommentsHtml } from "../../src/server/modules/chalaoshi/parser.js";

const FIXTURES = join(import.meta.dirname, "../../docs/fixtures/chalaoshi");

describe("preprocessComments（近五年 / 去重 / 限长）", () => {
  const now = new Date("2026-07-09T00:00:00.000Z");

  it("过滤五年外评论、去重保留较新、限长", () => {
    const raw = parseCommentsHtml(
      readFileSync(join(FIXTURES, "comments-with-old.synthetic.html"), "utf8"),
    );
    expect(raw).toHaveLength(4);

    const processed = preprocessComments(raw, { now, maxTextLength: 2000 });
    expect(processed.map((c) => c.postedAt)).toEqual(["2025-10-12", "2024-06-30"]);
    expect(processed.some((c) => c.postedAt === "2018-03-01")).toBe(false);
    // 重复文本只保留较新（2025-10-12）
    expect(processed.filter((c) => c.text.includes("讲课清晰"))).toHaveLength(1);
  });

  it("超长评论文本被截断", () => {
    const processed = preprocessComments(
      [
        {
          text: "x".repeat(50),
          likes: 0,
          dislikes: 0,
          postedAt: "2025-01-01",
        },
      ],
      { now, maxTextLength: 10 },
    );
    expect(processed[0]?.text).toHaveLength(10);
  });
});
