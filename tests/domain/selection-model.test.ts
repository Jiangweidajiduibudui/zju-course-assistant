import { describe, expect, it } from "vitest";
import {
  classTimesOverlap,
  estimateRisk,
  timeslotKey,
} from "../../src/domain/selection-model/index.js";
import type { Section, TermSlot } from "../../src/shared/contracts/index.js";

/** 已实现部分的真实测试（组员 C 在 Task 1 持续扩充本目录）。 */
describe("timeslot 归一化（D37）", () => {
  it("同 学期+星期+节次 生成同一 key，不含单双周维度", () => {
    const a: TermSlot = { term: "autumn", dayOfWeek: 1, period: 1 };
    const b: TermSlot = { term: "autumn", dayOfWeek: 1, period: 1 };
    expect(timeslotKey(a)).toBe(timeslotKey(b));
    expect(timeslotKey(a)).toBe("autumn-1-1");
  });

  it("上课时间重叠可被检测（重叠 ≠ 无解，仅供软排序参考）", () => {
    const mon12: TermSlot[] = [
      { term: "autumn", dayOfWeek: 1, period: 1 },
      { term: "autumn", dayOfWeek: 1, period: 2 },
    ];
    const mon2: TermSlot[] = [{ term: "autumn", dayOfWeek: 1, period: 2 }];
    const tue3: TermSlot[] = [{ term: "autumn", dayOfWeek: 2, period: 3 }];
    expect(classTimesOverlap(mon12, mon2)).toBe(true);
    expect(classTimesOverlap(mon12, tue3)).toBe(false);
  });
});

describe("录取风险冻结（D01、D30 —— 硬规则 H3）", () => {
  it("estimateRisk 恒返回 unavailable，直至规则档闭环并新增解冻决策", () => {
    const section = {} as Section; // 输入无关紧要 —— 冻结期实现与输入无关
    expect(estimateRisk(section, null)).toEqual({ status: "unavailable" });
  });
});
