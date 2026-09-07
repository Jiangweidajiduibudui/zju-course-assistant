import { z } from "zod";
import { LocalArchive } from "./operations.js";
import { Plan, PlanContent, PreferenceProfile } from "./planning.js";

const LegacyPreferences = PreferenceProfile.pick({
  creditLimit: true,
  preferredCampuses: true,
  timePreferences: true,
  note: true,
});
export const LegacyPlan = Plan.extend({
  schemaVersion: z.literal(1),
  content: z.strictObject({
    ...PlanContent.shape,
    preferences: LegacyPreferences,
  }),
});
export function migratePlanV1(raw: unknown) {
  const old = LegacyPlan.parse(raw);
  return Plan.parse({
    ...old,
    schemaVersion: 2,
    content: {
      ...old.content,
      preferences: {
        ...old.content.preferences,
        orderedCriteria: [],
        hardConstraints: [],
        courseOverrides: [],
        unresolvedClauses: [],
        textConfirmed: false,
      },
    },
  });
}
// Migration is an explicit preview operation, never implicit HTTP coercion.
export function migrateArchive(raw: unknown) {
  const header = z.object({ schemaVersion: z.number() }).parse(raw);
  if (header.schemaVersion === 2) return LocalArchive.parse(raw);
  if (header.schemaVersion !== 1)
    throw new Error("Unsupported archive version");
  const old = z.strictObject({
    ...LocalArchive.shape,
    schemaVersion: z.literal(1),
    plans: z.array(LegacyPlan).max(1000),
  });
  // Legacy nested joins use v1 plans, so validate the migrated graph instead.
  const structural = z.strictObject(old.shape).parse(raw);
  return LocalArchive.parse({
    ...structural,
    schemaVersion: 2,
    plans: structural.plans.map(migratePlanV1),
  });
}
export const emptyPreferences = () =>
  PreferenceProfile.parse({
    creditLimit: null,
    preferredCampuses: [],
    timePreferences: [],
    note: "",
    orderedCriteria: [],
    hardConstraints: [],
    courseOverrides: [],
    unresolvedClauses: [],
    textConfirmed: false,
  });

export const ArchiveInput = z.union([
  LocalArchive,
  z.strictObject({
    ...LocalArchive.shape,
    schemaVersion: z.literal(1),
    plans: z.array(LegacyPlan).max(1000),
  }),
]);
