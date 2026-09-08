import type { Analysis } from "../data/port.js";

type Entry = Analysis["projection"]["entries"][number];
export function weekLabel(weeks: number[]) {
  const sorted = [...weeks].sort((a, b) => a - b);
  const step =
    sorted.length > 1 &&
    sorted.every((w, i) => i === 0 || w - (sorted[i - 1] ?? w) === 2)
      ? 2
      : 1;
  const consecutive = sorted.every(
    (w, i) => i === 0 || w - (sorted[i - 1] ?? w) === step,
  );
  const range =
    consecutive && sorted.length > 1
      ? `${sorted[0]}–${sorted.at(-1)}`
      : sorted.join("、");
  return `${range} 周${step === 2 ? ((sorted[0] ?? 0) % 2 ? "（单周）" : "（双周）") : ""}`;
}
// Visual collisions include disjoint weeks and alternatives; these are not academic conflicts.
export function layoutEntries(entries: Entry[]) {
  const result = new Map<Entry, { lane: number; lanes: number }>();
  for (let day = 1; day <= 7; day++) {
    const rows = entries
      .filter((e) => e.slot.weekday === day)
      .sort((a, b) => a.slot.startPeriod - b.slot.startPeriod);
    let group: Entry[] = [],
      end = 0;
    const flush = () => {
      const ends: number[] = [];
      for (const entry of group) {
        let lane = ends.findIndex((last) => last < entry.slot.startPeriod);
        if (lane < 0) lane = ends.length;
        ends[lane] = entry.slot.endPeriod;
        result.set(entry, { lane, lanes: 0 });
      }
      for (const entry of group) {
        const position = result.get(entry);
        if (position) position.lanes = ends.length;
      }
    };
    for (const entry of rows) {
      if (entry.slot.startPeriod > end) {
        flush();
        group = [];
      }
      group.push(entry);
      end = Math.max(group.length === 1 ? 0 : end, entry.slot.endPeriod);
    }
    flush();
  }
  return result;
}
