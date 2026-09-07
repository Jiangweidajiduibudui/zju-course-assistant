import type { SnapshotData } from "../shared/contracts/catalog.js";

// Product policy confirmed by the user on 2026-09-06. Captured upstream
// rules/priority/group fields remain observations, not the authority for this policy.
export const VOLUNTEER_RULES = {
  id: "user-confirmed-overlap-v1",
  courseLimit: 3,
  timeLimit: 3,
} as const;

export function volunteerGroups(snapshot: SnapshotData, sectionIds: string[]) {
  const wanted = new Set(sectionIds);
  const sections = snapshot.sections.filter((s) => wanted.has(s.id));
  const slots = sections.flatMap((s) =>
    s.meetings.state === "known" ? s.meetings.value.map((m) => m.slot) : [],
  );
  const parts = new Map(
    snapshot.term.parts.map((p, index) => [p.id, { ...p, index }]),
  );
  const datesKnown = slots.every(
    (slot) => parts.get(slot.partId)?.weekOneMonday.state === "known",
  );
  const weeksKnown = slots.every((slot) => {
    const mapping = parts.get(slot.partId)?.semesterWeeks;
    return (
      mapping?.state === "known" &&
      slot.weeks.every((week) => mapping.value.some((m) => m.partWeek === week))
    );
  });
  const mode = datesKnown ? "date" : weeksKnown ? "semester" : "part";
  const atoms = new Map<string, Set<string>>();
  const unknown = new Set(
    sections.filter((s) => s.meetings.state !== "known").map((s) => s.id),
  );
  // A mixed calendar cannot establish a shared cross-part counting axis.
  // Keep within-part counts, but do not certify cross-part memberships.
  if (mode === "part") {
    for (const left of sections)
      for (const right of sections) {
        if (
          left.id >= right.id ||
          left.meetings.state !== "known" ||
          right.meetings.state !== "known"
        )
          continue;
        if (
          left.meetings.value.some(
            ({ slot: a }) =>
              right.meetings.state === "known" &&
              right.meetings.value.some(
                ({ slot: b }) =>
                  a.partId !== b.partId &&
                  a.weekday === b.weekday &&
                  a.startPeriod <= b.endPeriod &&
                  b.startPeriod <= a.endPeriod,
              ),
          )
        ) {
          unknown.add(left.id);
          unknown.add(right.id);
        }
      }
  }
  for (const section of sections) {
    if (section.meetings.state !== "known") continue;
    for (const { slot } of section.meetings.value) {
      const part = parts.get(slot.partId);
      for (const week of slot.weeks) {
        let day = `part:${part?.index}:week:${week}:day:${slot.weekday}`;
        if (mode === "date" && part?.weekOneMonday.state === "known")
          day = `date:${Date.parse(part.weekOneMonday.value) / 86400000 + 7 * (week - 1) + slot.weekday - 1}`;
        if (mode === "semester" && part?.semesterWeeks?.state === "known")
          day = `week:${part.semesterWeeks.value.find((m) => m.partWeek === week)?.semesterWeek}:day:${slot.weekday}`;
        for (
          let period = slot.startPeriod;
          period <= slot.endPeriod;
          period++
        ) {
          const key = `${day}:period:${period}`;
          const members = atoms.get(key) ?? new Set<string>();
          members.add(section.id); // Repeated meetings never double-count a class.
          atoms.set(key, members);
        }
      }
    }
  }
  // Identical memberships at multiple weeks/periods need only one limit check.
  const unique = new Map<string, string[]>();
  for (const members of atoms.values()) {
    const ids = [...members].sort();
    unique.set(JSON.stringify(ids), ids);
  }
  const groups = [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, ids], index) => ({ id: `overlap-${index}`, sectionIds: ids }));
  const bySection = new Map(
    sections.map((s) => [
      s.id,
      groups.filter((g) => g.sectionIds.includes(s.id)).map((g) => g.id),
    ]),
  );
  return { groups, bySection, unknown };
}
