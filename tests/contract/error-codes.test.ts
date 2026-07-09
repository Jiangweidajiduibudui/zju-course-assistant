import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

/** 错误码是契约：唯一、命名稳定（Task 0）。 */
describe("错误码契约", () => {
  it("值唯一且与键一致", () => {
    const values = Object.values(ErrorCodes);
    expect(new Set(values).size).toBe(values.length);
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(key).toBe(value);
    }
  });

  it("命名遵循 <模块前缀>_<SCREAMING_SNAKE> 约定", () => {
    const pattern = /^(COMMON|IMPORT|CHALAOSHI|MODEL|LLM|PLAN)_[A-Z0-9_]+$/;
    for (const value of Object.values(ErrorCodes)) {
      expect(value).toMatch(pattern);
    }
  });
});
