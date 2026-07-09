import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogSchema, chalaoshiSeedSchema } from "../../src/shared/contracts/index.js";

/**
 * Task 0 门禁（docs/08 §10）：契约测试证明 fixture 可被解析，
 * 且没有真实评论、学号、姓名、Cookie、key。
 */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("合成 fixture 契约", () => {
  it("demo-catalog.synthetic.json 通过 catalog.v1 Schema", () => {
    const parsed = catalogSchema.parse(JSON.parse(readFixture("demo-catalog.synthetic.json")));
    expect(parsed.synthetic).toBe(true);
    expect(parsed.courses.length).toBeGreaterThan(0);
  });

  it("catalog fixture 覆盖硬字段缺失边界（考试时间缺失 + 学分缺失）", () => {
    const parsed = catalogSchema.parse(JSON.parse(readFixture("demo-catalog.synthetic.json")));
    const sections = parsed.courses.flatMap((c) => c.sections);
    expect(sections.some((s) => s.examTime === null)).toBe(true); // D37
    expect(sections.some((s) => s.credits === null)).toBe(true); // D38
  });

  it("demo-chalaoshi.synthetic.json 通过 chalaoshi-seed.v1 Schema 且 synthetic:true", () => {
    const parsed = chalaoshiSeedSchema.parse(
      JSON.parse(readFixture("demo-chalaoshi.synthetic.json")),
    );
    expect(parsed.synthetic).toBe(true);
    // 覆盖边界：无评分/无评论教师（docs/05 §2）
    expect(parsed.teachers.some((t) => t.comments.length === 0)).toBe(true);
  });

  it("fixture 不包含隐私与凭据特征（D41、docs/03 §4）", () => {
    const all =
      readFixture("demo-catalog.synthetic.json") + readFixture("demo-chalaoshi.synthetic.json");
    const forbidden: Array<[RegExp, string]> = [
      [/sk-[A-Za-z0-9]{8,}/, "疑似 API key"],
      [/JSESSIONID|iPlanetDirectoryPro/i, "疑似 Cookie/会话令牌"],
      [/\b3\d{7}\b/, "疑似学号"],
      [/学号|身份证/, "隐私字段字样"],
    ];
    for (const [pattern, label] of forbidden) {
      expect(all, `fixture 不得包含${label}（${pattern}）`).not.toMatch(pattern);
    }
  });
});
