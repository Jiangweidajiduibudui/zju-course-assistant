import type { TermSlot } from "../../shared/contracts/index.js";
import type { TimeslotKey } from "./types.js";

/**
 * 时间槽归一化（D37）：春/夏/秋/冬学期 + 星期 + 节次，不区分单双周。
 * 该 key 同时用于：时间槽志愿组分组、同时间段志愿上限校验、课表投影格定位。
 */
export function timeslotKey(slot: TermSlot): TimeslotKey {
  return `${slot.term}-${slot.dayOfWeek}-${slot.period}`;
}

/** 判断两个教学班的上课时间是否重叠（重叠≠无解；交给组内排序与 LLM，D37） */
export function classTimesOverlap(a: readonly TermSlot[], b: readonly TermSlot[]): boolean {
  const keys = new Set(a.map(timeslotKey));
  return b.some((slot) => keys.has(timeslotKey(slot)));
}
