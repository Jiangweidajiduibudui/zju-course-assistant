// biome-ignore-all lint/style/noNonNullAssertion: Adversarial tests deliberately mutate required authored fixture rows.
import { describe, expect, it } from "vitest";
import { initialPlans, originalSnapshot } from "../../fixtures/ui/catalog.js";
import {
  FixtureWorkspace,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
} from "../../fixtures/ui/workspace.js";
import {
  migrateArchive,
  migratePlanV1,
} from "../../src/shared/contracts/migration.js";
import { LocalArchive } from "../../src/shared/contracts/operations.js";
import { Plan } from "../../src/shared/contracts/planning.js";

const legacy = () => {
  const plan = structuredClone(initialPlans[0])!;
  const {
    orderedCriteria: _a,
    hardConstraints: _b,
    courseOverrides: _c,
    unresolvedClauses: _d,
    textConfirmed: _e,
    ...preferences
  } = plan.content.preferences;
  return {
    ...plan,
    schemaVersion: 1,
    content: {
      ...plan.content,
      preferences: { ...preferences, note: "Original unstructured preference" },
    },
  };
};
describe("explicit v1 migration", () => {
  it("preserves identity, order, notes and exclusions without treating text as confirmed", () => {
    const old = legacy();
    old.content.shortlist[0]!.items[0]!.disposition = "excluded";
    const plan = migratePlanV1(old);
    expect(plan.id).toBe(old.id);
    expect(plan.content.shortlist).toEqual(old.content.shortlist);
    expect(plan.content.preferences.orderedCriteria).toEqual([]);
    expect(plan.content.preferences.textConfirmed).toBe(false);
    expect(plan.content.preferences.note).toBe(old.content.preferences.note);
    expect(Plan.safeParse(old).success).toBe(false);
  });
  it("keeps snapshots at version 1 and rejects partial or unsupported archives", () => {
    const archive = {
      format: "zju-course-assistant",
      schemaVersion: 1,
      exportedAt: "2026-09-06T00:00:00Z",
      plans: [legacy()],
      snapshots: [originalSnapshot],
    };
    const migrated = migrateArchive(archive);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.snapshots[0]!.meta.schemaVersion).toBe(1);
    expect(LocalArchive.parse(migrated)).toEqual(migrated);
    expect(() => migrateArchive({ ...archive, snapshots: [] })).toThrow();
    expect(() => migrateArchive({ ...archive, schemaVersion: 99 })).toThrow();
  });
  it("backs up v1 before writing v2 and preserves it on a storage failure", async () => {
    const old = JSON.stringify({
      version: 1,
      published: false,
      plans: [legacy()],
    });
    const data = new Map([[LEGACY_STORAGE_KEY, old]]);
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === STORAGE_KEY) throw new Error("disk full");
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };
    const db = new FixtureWorkspace(store, 0);
    await expect(db.listPlans()).rejects.toThrow();
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(old);
    expect(data.get(`${LEGACY_STORAGE_KEY}:backup`)).toBe(old);
    expect(data.has(STORAGE_KEY)).toBe(false);
    const working = new FixtureWorkspace(
      {
        ...store,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      0,
    );
    expect((await working.getPlan("plan-main")).plan.schemaVersion).toBe(2);
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(old);
  });
});
