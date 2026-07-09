import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCatalogJson } from "../../src/server/modules/import/service.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

/** 导入校验器（组员 A；docs/05 §1）：正常 / 非法 JSON / Schema 违规 / 重复教学班。 */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

describe("parseCatalogJson", () => {
  it("合成 demo catalog 解析成功", () => {
    const result = parseCatalogJson(readFixture("demo-catalog.synthetic.json"));
    expect(result.ok).toBe(true);
  });

  it("非法 JSON → IMPORT_INVALID_JSON", () => {
    const result = parseCatalogJson("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe(ErrorCodes.IMPORT_INVALID_JSON);
    }
  });

  it("Schema 违规（teachers 为空）→ IMPORT_SCHEMA_MISMATCH，含路径定位", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-schema-mismatch.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_SCHEMA_MISMATCH)).toBe(true);
      expect(result.issues.some((i) => i.path.includes("teachers"))).toBe(true);
    }
  });

  it("重复 sectionId → IMPORT_DUPLICATE_SECTION", () => {
    const result = parseCatalogJson(readFixture("invalid-cases", "catalog-duplicate-section.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === ErrorCodes.IMPORT_DUPLICATE_SECTION)).toBe(true);
    }
  });
});
