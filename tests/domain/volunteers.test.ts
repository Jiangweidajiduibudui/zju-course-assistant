import { expect, it } from "vitest";
import { originalSnapshot } from "../../fixtures/ui/catalog.js";
import { volunteerGroups } from "../../src/domain/volunteers.js";
import type { SnapshotData } from "../../src/shared/contracts/catalog.js";

function build(intervals: Array<[number, number, number?]>) {
  const snapshot = structuredClone(originalSnapshot);
  const original = snapshot.sections[0];
  if (!original) throw new Error("fixture");
  snapshot.sections = intervals.map(
    ([startPeriod, endPeriod, week = 1], index) => ({
      ...structuredClone(original),
      id: `section-${index}`,
      meetings: {
        state: "known",
        value: [
          {
            slot: {
              partId: "autumn",
              weeks: [week],
              weekday: 1,
              startPeriod,
              endPeriod,
            },
            location: { state: "unknown", reason: "not_provided" },
          },
        ],
      },
    }),
  );
  return snapshot;
}
const groups = (s: SnapshotData) =>
  volunteerGroups(
    s,
    s.sections.map((v) => v.id),
  );
it("counts exact concurrent periods rather than transitive overlap chains", () => {
  const chain = groups(
    build([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]),
  );
  expect(Math.max(...chain.groups.map((g) => g.sectionIds.length))).toBe(2);
  const three = groups(
    build([
      [1, 3],
      [2, 4],
      [2, 3],
    ]),
  );
  expect(Math.max(...three.groups.map((g) => g.sectionIds.length))).toBe(3);
  const four = groups(
    build([
      [1, 3],
      [2, 4],
      [2, 3],
      [3, 5],
    ]),
  );
  expect(four.groups.some((g) => g.sectionIds.length === 4)).toBe(true);
});
it("separates teaching weeks and never double-counts duplicate meetings", () => {
  const s = build([
    [1, 2, 1],
    [1, 2, 1],
    [1, 2, 2],
    [1, 2, 2],
  ]);
  const first = s.sections[0];
  if (first?.meetings.state !== "known") throw new Error("fixture");
  first.meetings.value.push(...structuredClone(first.meetings.value));
  expect(Math.max(...groups(s).groups.map((g) => g.sectionIds.length))).toBe(2);
  expect(
    volunteerGroups(s, ["section-0"]).groups.every(
      (g) => g.sectionIds.length === 1,
    ),
  ).toBe(true);
});
it("uses observed common weeks across parts and discloses missing calendar evidence", () => {
  const s = build([
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
  ]);
  const last = s.sections[3];
  if (last?.meetings.state !== "known") throw new Error("fixture");
  const meeting = last.meetings.value[0];
  if (!meeting) throw new Error("fixture");
  meeting.slot.partId = "winter";
  expect(groups(s).unknown.size).toBe(4);
  s.term.parts = s.term.parts.map((p) => ({
    ...p,
    semesterWeeks: {
      state: "known",
      value: [{ partWeek: 1, semesterWeek: 1 }],
    },
  }));
  expect(groups(s).unknown.size).toBe(0);
  expect(groups(s).groups.some((g) => g.sectionIds.length === 4)).toBe(true);
  const winter = s.term.parts.find((p) => p.id === "winter");
  if (!winter) throw new Error("fixture");
  winter.semesterWeeks = {
    state: "known",
    value: [{ partWeek: 1, semesterWeek: 9 }],
  };
  expect(Math.max(...groups(s).groups.map((g) => g.sectionIds.length))).toBe(3);
});
