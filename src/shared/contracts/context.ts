import { z } from "zod";
import { Snapshot } from "./catalog.js";
import { Id, IdList } from "./common.js";
import { Plan } from "./planning.js";

// Structural joins are checked independently of domain legality: an invalid
// fourth preference is retainable; a section belonging to another course is not.
export const PlanSnapshot = z
  .strictObject({ plan: Plan, snapshot: Snapshot })
  .superRefine(({ plan, snapshot }, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      plan.snapshotId !== snapshot.meta.id ||
      plan.termId !== snapshot.meta.termId
    )
      fail("Plan anchor does not match snapshot");
    const courses = new Set(snapshot.courses.map((course) => course.id));
    const sections = new Map(
      snapshot.sections.map((section) => [section.id, section]),
    );
    const parts = new Set(snapshot.term.parts.map((part) => part.id));
    for (const entry of plan.content.shortlist) {
      if (
        !courses.has(entry.courseId) &&
        !plan.unresolvedCourseIds.includes(entry.courseId)
      )
        fail("Unknown shortlist course");
      for (const item of entry.items)
        if (sections.get(item.sectionId)?.courseId !== entry.courseId)
          fail(
            "Section does not belong to its shortlist course in this snapshot",
          );
    }
    for (const id of plan.unresolvedCourseIds)
      if (
        courses.has(id) ||
        !plan.content.shortlist.some((entry) => entry.courseId === id)
      )
        fail("Invalid missing-course marker");
    for (const override of plan.content.preferences.courseOverrides)
      if (!plan.content.shortlist.some((c) => c.courseId === override.courseId))
        fail("Preference override has no shortlist course");
    for (const rule of [
      ...plan.content.preferences.hardConstraints,
      ...plan.content.preferences.courseOverrides.flatMap(
        (o) => o.hardConstraints,
      ),
    ])
      if (rule.kind === "blocked_time" && !parts.has(rule.slot.partId))
        fail("Constraint uses another term part");
    for (const preference of plan.content.preferences.timePreferences)
      if (!parts.has(preference.slot.partId))
        fail("Preference uses another term's part");
  });
export const PlanningContextSchema = PlanSnapshot.safeExtend({
  latestLiveSnapshotId: Id.nullable(),
});
export const Acknowledgement = z
  .strictObject({ expectedIds: IdList, acknowledgedIds: IdList })
  .refine(
    ({ expectedIds, acknowledgedIds }) =>
      expectedIds.length === acknowledgedIds.length &&
      expectedIds.every((id) => acknowledgedIds.includes(id)),
    "Every current item must be acknowledged exactly once",
  );
