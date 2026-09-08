import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialPlans,
  originalSnapshot,
  updatedSnapshot,
} from "../../fixtures/ui/catalog.js";
import { createApp } from "../../src/server/app.js";
import type { PlanningDriver } from "../../src/server/planning.js";
import { Store } from "../../src/server/storage/store.js";
import { api, type OperationId } from "../../src/shared/contracts/api.js";
import { Snapshot } from "../../src/shared/contracts/catalog.js";
import { PlanningJob } from "../../src/shared/contracts/llm.js";
import { LocalArchive } from "../../src/shared/contracts/operations.js";
import { Plan } from "../../src/shared/contracts/planning.js";

const origin = "http://127.0.0.1:4317";
const resources: Array<() => void> = [];
afterEach(() => {
  for (const close of resources.splice(0).reverse()) close();
  vi.restoreAllMocks();
});
const requireValue = <T>(value: T | undefined | null): T => {
  if (value == null) throw new Error("Missing test row");
  return value;
};
async function setup(driver?: PlanningDriver) {
  const directory = mkdtempSync(join(tmpdir(), "zju-p4-"));
  const file = join(directory, "workspace.sqlite3");
  let store = new Store(file);
  let runtime = createApp({ store, origin, ...(driver ? { driver } : {}) });
  store.transaction(() => {
    store.insertSnapshot(originalSnapshot);
    for (const plan of initialPlans) store.insertPlan(plan);
  });
  resources.push(() => {
    runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let token = "";
  const raw = async (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    runtime.app.request(`${origin}${path}`, {
      method,
      headers: {
        host: "127.0.0.1:4317",
        origin,
        "X-Local-Token": token,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const bootstrap = async () => {
    const r = await raw("/api/bootstrap");
    const value = await r.json();
    token = value.data.localRequestToken;
    return value;
  };
  await bootstrap();
  const request = async (
    op: OperationId,
    body?: unknown,
    params: Record<string, string> = {},
    query: Record<string, string> = {},
    key = "test-key",
  ) => {
    let path = api[op].path;
    for (const [k, v] of Object.entries(params))
      path = path.replace(`{${k}}`, v);
    const q = new URLSearchParams(query);
    if (q.size) path += `?${q}`;
    const response = await raw(
      path,
      api[op].method,
      body,
      api[op].idempotencyKey ? { "Idempotency-Key": key } : {},
    );
    return { status: response.status, body: await response.json() };
  };
  return {
    get store() {
      return store;
    },
    get runtime() {
      return runtime;
    },
    file,
    raw,
    request,
    bootstrap,
    restart: async () => {
      runtime.close();
      store.close();
      store = new Store(file);
      runtime = createApp({ store, origin, ...(driver ? { driver } : {}) });
      await bootstrap();
    },
  };
}
const output = {
  selections: [
    { courseId: "math", sectionId: "math-c", reason: "Synthetic choice" },
    { courseId: "code", sectionId: "code-a", reason: "Synthetic choice" },
  ],
  explanation: "Synthetic proposal",
};
const generation = {
  plan: { planId: "plan-main", expectedRevision: 1 },
  endpointId: "default",
};
async function completed(
  workspace: Awaited<ReturnType<typeof setup>>,
  id: string,
) {
  let result = await workspace.request("getPlanningJob", undefined, {
    jobId: id,
  });
  await vi.waitFor(
    async () => {
      result = await workspace.request("getPlanningJob", undefined, {
        jobId: id,
      });
      expect(["queued", "running"]).not.toContain(result.body.data.status);
    },
    { timeout: 2000, interval: 10 },
  );
  return PlanningJob.parse(result.body.data);
}
describe("loopback request boundary", () => {
  it("requires same-origin bootstrap and tokens; rejects hostile Host, Origin and Fetch Metadata", async () => {
    const w = await setup();
    const cases = [
      { origin: "https://evil.test" },
      { host: "evil.test:4317" },
      { "sec-fetch-site": "cross-site" },
      { origin: "null" },
    ];
    for (const headers of cases)
      expect(
        (await w.raw("/api/bootstrap", "GET", undefined, headers)).status,
      ).toBe(403);
    expect(
      (
        await w.raw("/api/plans?termId=term-synthetic-2026", "GET", undefined, {
          "X-Local-Token": "wrong",
        })
      ).status,
    ).toBe(401);
    const anonymous = await w.runtime.app.request(`${origin}/api/bootstrap`, {
      headers: { host: "127.0.0.1:4317" },
    });
    expect(anonymous.status).toBe(403);
    const browser = await w.runtime.app.request(`${origin}/api/bootstrap`, {
      headers: { host: "127.0.0.1:4317", "sec-fetch-site": "same-origin" },
    });
    expect(browser.status).toBe(200);
    expect(browser.headers.get("access-control-allow-origin")).toBe(null);
    expect(browser.headers.get("cache-control")).toBe("no-store");
  });
  it("never exposes rejected input or database errors and rejects duplicate query fields", async () => {
    const w = await setup();
    const secret = "private-sentinel-do-not-echo";
    const bad = await w.request(
      "updatePlan",
      { expectedRevision: 1, content: { secret } },
      { planId: "plan-main" },
    );
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain(secret);
    expect((await w.raw("/api/plans?termId=a&termId=b")).status).toBe(400);
    const huge = await w.raw(
      "/api/plans",
      "POST",
      {},
      {
        "Content-Length": String(26 * 1024 * 1024),
        "Idempotency-Key": "large",
      },
    );
    expect(huge.status).toBe(413);
    const stub = vi.spyOn(w.store, "insertPlan").mockImplementation(() => {
      throw new Error(secret);
    });
    const error = await w.request("createPlan", {
      mode: "empty",
      snapshotId: originalSnapshot.meta.id,
      name: "New",
    });
    expect(error.status).toBe(500);
    expect(JSON.stringify(error.body)).not.toContain(secret);
    stub.mockRestore();
  });
  it("has no retired routes and does not call a model while disabled", async () => {
    const w = await setup();
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(
      (await w.raw("/api/arrangements/enumerate", "POST", {})).status,
    ).toBe(404);
    expect((await w.request("generateTimetable", generation)).status).toBe(403);
    expect((await w.request("startLogin", {})).status).toBe(501);
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("SQLite plans and optimistic concurrency", () => {
  it("survives restart, preserves permissions and isolates copies and terms", async () => {
    const w = await setup();
    const original = requireValue(initialPlans[0]);
    const result = await w.request(
      "updatePlan",
      {
        expectedRevision: 1,
        content: {
          ...original.content,
          name: "Persisted",
          preferences: {
            ...original.content.preferences,
            orderedCriteria: ["free_mornings"],
            note: "soft text",
            textConfirmed: true,
          },
        },
      },
      { planId: original.id },
    );
    expect(result.status).toBe(200);
    const copy = await w.request("createPlan", {
      mode: "copy",
      source: { planId: original.id, expectedRevision: 2 },
      name: "Independent",
    });
    expect(copy.status).toBe(201);
    await w.restart();
    const stored = await w.request("getPlan", undefined, {
      planId: original.id,
    });
    expect(stored.body.data.plan.content.name).toBe("Persisted");
    expect(stored.body.data.plan.content.preferences.orderedCriteria).toEqual([
      "free_mornings",
    ]);
    expect(
      (await w.request("listPlans", undefined, {}, { termId: "other-term" }))
        .body.data.items,
    ).toEqual([]);
    expect(statSync(w.file).mode & 0o777).toBe(0o600);
    expect(statSync(join(w.file, "..")).mode & 0o777).toBe(0o700);
    await w.request(
      "deletePlan",
      { expectedRevision: 2 },
      { planId: original.id },
    );
    expect(
      (
        await w.request("getPlan", undefined, {
          planId: copy.body.data.plan.id,
        })
      ).status,
    ).toBe(200);
  });
  it("rejects stale updates and idempotency conflicts without overwriting a newer revision", async () => {
    const w = await setup();
    const original = requireValue(initialPlans[0]);
    const request = {
      mode: "empty",
      snapshotId: originalSnapshot.meta.id,
      name: "Once",
    };
    const first = await w.request("createPlan", request, {}, {}, "once");
    const repeat = await w.request("createPlan", request, {}, {}, "once");
    expect(repeat.body.data.plan.id).toBe(first.body.data.plan.id);
    expect(w.store.plans()).toHaveLength(2);
    expect(
      (
        await w.request(
          "createPlan",
          { ...request, name: "Different" },
          {},
          {},
          "once",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await w.request(
          "updatePlan",
          {
            expectedRevision: 1,
            content: { ...original.content, name: "First" },
          },
          { planId: original.id },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await w.request(
          "updatePlan",
          { expectedRevision: 1, content: original.content },
          { planId: original.id },
        )
      ).body.error.code,
    ).toBe("REVISION_CONFLICT");
    expect(w.store.plan(original.id).content.name).toBe("First");
  });
  it("rolls back mutations when their response fails its contract", async () => {
    const w = await setup();
    const before = w.store.revision();
    const original = w.store.insertPlan.bind(w.store);
    vi.spyOn(w.store, "insertPlan").mockImplementation((plan) => {
      original(plan);
      throw new Error("injected failure after INSERT");
    });
    expect(
      (
        await w.request("createPlan", {
          mode: "empty",
          snapshotId: originalSnapshot.meta.id,
          name: "Must roll back",
        })
      ).status,
    ).toBe(500);
    expect(w.store.plans()).toHaveLength(1);
    expect(w.store.revision()).toBe(before);
  });
});
describe("proposal lifecycle", () => {
  it("stores direct output and atomically adopts an independent plan with replay across restart", async () => {
    const w = await setup({ synthetic: true, generate: async () => output });
    const start = await w.request("generateTimetable", generation);
    expect(start.status).toBe(202);
    const job = await completed(w, start.body.data.id);
    expect(job.status).toBe("succeeded");
    const proposal = requireValue(job.proposals[0]);
    expect(proposal.validation.status).toBe("valid");
    expect(proposal.analysis?.draft.validation.status).toBe("valid");
    const input = { plan: generation.plan, name: "AI copy" };
    const a = await w.request(
      "adoptPlanningProposal",
      input,
      { proposalId: proposal.id },
      {},
      "adopt",
    );
    expect(a.status).toBe(201);
    expect(
      a.body.data.plan.content.shortlist[0].items.map(
        (i: { sectionId: string }) => i.sectionId,
      ),
    ).toEqual(["math-c", "math-a"]);
    expect(w.store.plan("plan-main").revision).toBe(1);
    await w.restart();
    const replay = await w.request(
      "adoptPlanningProposal",
      input,
      { proposalId: proposal.id },
      {},
      "adopt",
    );
    expect(replay.body.data.plan.id).toBe(a.body.data.plan.id);
    expect(w.store.plans()).toHaveLength(2);
  });
  it("rolls back partial adoption and retries the same key safely", async () => {
    const w = await setup({ synthetic: true, generate: async () => output });
    const job = await completed(
      w,
      (await w.request("generateTimetable", generation)).body.data.id,
    );
    const proposal = requireValue(job.proposals[0]);
    const original = w.store.insertPlan.bind(w.store);
    const stub = vi.spyOn(w.store, "insertPlan").mockImplementation((plan) => {
      original(plan);
      throw new Error("adoption disk failure");
    });
    const request = { plan: generation.plan, name: "AI copy" };
    expect(
      (
        await w.request(
          "adoptPlanningProposal",
          request,
          { proposalId: proposal.id },
          {},
          "adopt",
        )
      ).status,
    ).toBe(500);
    expect(w.store.plans()).toHaveLength(1);
    stub.mockRestore();
    expect(
      (
        await w.request(
          "adoptPlanningProposal",
          request,
          { proposalId: proposal.id },
          {},
          "adopt",
        )
      ).status,
    ).toBe(201);
    expect(w.store.plans()).toHaveLength(2);
  });
  it("rejects invalid IDs and never trusts an attached valid report", async () => {
    const w = await setup({
      synthetic: true,
      generate: async () => ({
        ...output,
        selections: [
          { courseId: "math", sectionId: "invented", reason: "fake" },
        ],
        validation: { status: "valid", issues: [] },
      }),
    });
    const job = await completed(
      w,
      (await w.request("generateTimetable", generation)).body.data.id,
    );
    expect(job.status).toBe("failed");
    expect(job.proposals).toEqual([]);
    expect(w.store.plans()).toHaveLength(1);
  });
  it("displays a structurally valid but hard-invalid proposal only as diagnostic feedback", async () => {
    const w = await setup({ synthetic: true, generate: async () => output });
    const source = w.store.plan("plan-main");
    source.content.preferences.creditLimit = 1;
    await w.request(
      "updatePlan",
      { expectedRevision: 1, content: source.content },
      { planId: source.id },
    );
    const input = {
      ...generation,
      plan: { ...generation.plan, expectedRevision: 2 },
    };
    const job = await completed(
      w,
      (await w.request("generateTimetable", input)).body.data.id,
    );
    const proposal = requireValue(job.proposals[0]);
    expect(proposal.validation.status).toBe("invalid");
    expect(
      (
        await w.request(
          "adoptPlanningProposal",
          { plan: input.plan, name: "Rejected" },
          { proposalId: proposal.id },
          {},
          "adopt-invalid",
        )
      ).status,
    ).toBe(422);
    expect(w.store.plans()).toHaveLength(1);
  });
  it("cancels in-flight work and discards late provider output", async () => {
    let finish: (value: unknown) => void = () => {};
    const w = await setup({
      synthetic: true,
      generate: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const start = await w.request("generateTimetable", generation);
    expect(
      (await w.request("cancelPlanningJob", {}, { jobId: start.body.data.id }))
        .body.data.status,
    ).toBe("cancelled");
    finish(output);
    const job = await completed(w, start.body.data.id);
    expect(job.status).toBe("cancelled");
    expect(job.proposals).toEqual([]);
    expect(w.store.plan("plan-main").revision).toBe(1);
  });
  it("invalidates results after a plan edit or a newly published live snapshot", async () => {
    const w = await setup({ synthetic: true, generate: async () => output });
    const job = await completed(
      w,
      (await w.request("generateTimetable", generation)).body.data.id,
    );
    const proposal = requireValue(job.proposals[0]);
    const plan = w.store.plan("plan-main");
    await w.request(
      "updatePlan",
      { expectedRevision: 1, content: { ...plan.content, name: "Changed" } },
      { planId: plan.id },
    );
    expect(
      (await w.request("getPlanningJob", undefined, { jobId: job.id })).body
        .data.status,
    ).toBe("stale");
    expect(
      (
        await w.request(
          "adoptPlanningProposal",
          { plan: generation.plan, name: "stale" },
          { proposalId: proposal.id },
          {},
          "adopt-invalid",
        )
      ).status,
    ).toBe(409);
    const live = structuredClone(updatedSnapshot);
    live.meta.provenance = { origin: "live", synthetic: false, sources: [] };
    w.store.insertSnapshot(Snapshot.parse(live));
    expect(
      (
        await w.request(
          "generateTimetable",
          { ...generation, plan: { ...generation.plan, expectedRevision: 2 } },
          {},
          {},
          "new-job",
        )
      ).body.error.code,
    ).toBe("RECONCILIATION_REQUIRED");
  });
  it("marks persisted unfinished jobs cancelled on restart", async () => {
    const w = await setup();
    w.store.put(
      "job",
      "interrupted",
      PlanningJob.parse({
        id: "interrupted",
        stamp: {
          planId: "plan-main",
          planRevision: 1,
          snapshotId: originalSnapshot.meta.id,
          rulesetId: originalSnapshot.rules.id,
        },
        status: "running",
        createdAt: "2026-09-06T00:00:00Z",
        finishedAt: null,
        proposals: [],
        error: null,
      }),
    );
    await w.restart();
    expect(
      (await w.request("getPlanningJob", undefined, { jobId: "interrupted" }))
        .body.data.status,
    ).toBe("cancelled");
  });
});
describe("reconciliation and additive import", () => {
  it("requires exact acknowledgements, current target and correct plan; preserves history", async () => {
    const w = await setup();
    const target = structuredClone(updatedSnapshot);
    target.meta.provenance = { origin: "live", synthetic: false, sources: [] };
    w.store.insertSnapshot(Snapshot.parse(target));
    const preview = (
      await w.request(
        "previewReconciliation",
        { expectedRevision: 1, targetSnapshotId: target.meta.id },
        { planId: "plan-main" },
      )
    ).body.data;
    expect(preview.changes).toHaveLength(3);
    const input = {
      expectedRevision: 1,
      acknowledgedChangeIds: preview.changes.map((c: { id: string }) => c.id),
    };
    expect(
      (
        await w.request(
          "applyReconciliation",
          { ...input, acknowledgedChangeIds: [] },
          { planId: "plan-main", previewId: preview.id },
        )
      ).status,
    ).toBe(422);
    expect(w.store.plan("plan-main").snapshotId).toBe(originalSnapshot.meta.id);
    const applied = await w.request("applyReconciliation", input, {
      planId: "plan-main",
      previewId: preview.id,
    });
    expect(applied.status).toBe(200);
    expect(applied.body.data.plan.history[0].previousItem.note).toBe(
      "作为时间备选",
    );
  });
  it("previews archives without writes and adds new IDs atomically, never latest-live", async () => {
    const w = await setup();
    const archive = LocalArchive.parse({
      format: "zju-course-assistant",
      schemaVersion: 2,
      exportedAt: "2026-09-06T00:00:00Z",
      snapshots: [originalSnapshot],
      plans: initialPlans,
    });
    const preview = (await w.request("previewImport", { archive })).body.data;
    expect(w.store.plans()).toHaveLength(1);
    const result = await w.request(
      "applyImport",
      { expectedDataRevision: preview.expectedDataRevision, confirm: true },
      { previewId: preview.id },
    );
    expect(result.status).toBe(200);
    expect(w.store.plans()).toHaveLength(2);
    expect(result.body.data.planIds[0]).not.toBe("plan-main");
    const imported = w.store.snapshot(result.body.data.snapshotIds[0]);
    expect(imported.meta.provenance.origin).toBe("imported");
    expect(w.store.latest(imported.meta.termId)).toBe(null);
    const exported = await w.request("exportLocalData", { scope: "all" });
    expect(LocalArchive.safeParse(exported.body.data).success).toBe(true);
  });
  it("blocks synthetic checklist output despite supplied acknowledgements", async () => {
    const w = await setup();
    const result = await w.request(
      "exportChecklist",
      { expectedRevision: 1, acknowledgedExcludedSectionIds: [] },
      { planId: "plan-main" },
    );
    expect(result.status).toBe(422);
  });
  it("exports under confirmed local rules while preserving priorities, warnings and exclusions", async () => {
    const w = await setup();
    const snapshot = structuredClone(originalSnapshot);
    snapshot.meta.id = "verified-test-only";
    snapshot.meta.provenance = {
      origin: "live",
      synthetic: false,
      sources: [],
    };
    // Upstream window/rule/group observations remain unknown. Local user-confirmed policy applies.
    requireValue(
      snapshot.sections.find((s) => s.id === "math-a"),
    ).officialState = "unavailable";
    requireValue(snapshot.sections.find((s) => s.id === "math-c")).exams = {
      state: "unknown",
      reason: "not_provided",
    };
    w.store.insertSnapshot(Snapshot.parse(snapshot));
    const plan = Plan.parse({
      ...initialPlans[0],
      id: "verified-plan",
      snapshotId: snapshot.meta.id,
    });
    w.store.insertPlan(plan);
    const result = await w.request(
      "exportChecklist",
      { expectedRevision: 1, acknowledgedExcludedSectionIds: ["math-a"] },
      { planId: plan.id },
    );
    expect(result.status).toBe(200);
    expect(
      result.body.data.checklist.entries.find(
        (e: { sectionId: string }) => e.sectionId === "math-c",
      ).priority,
    ).toBe(2);
    expect(result.body.data.checklist.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "EXAM_UNKNOWN",
        severity: "warning",
        sectionIds: ["math-c"],
      }),
    );
    expect(result.body.data.text).toContain("考试时间未提供");
  });
});

it("binds pagination cursors to the operation, filters and dataset revision", async () => {
  const w = await setup();
  const first = await w.request(
    "listCourses",
    undefined,
    {},
    { snapshotId: originalSnapshot.meta.id, limit: "1" },
  );
  expect(first.status).toBe(200);
  const cursor = first.body.data.nextCursor;
  expect(cursor).toBeTruthy();
  const next = await w.request(
    "listCourses",
    undefined,
    {},
    { snapshotId: originalSnapshot.meta.id, limit: "1", cursor },
  );
  expect(next.status).toBe(200);
  expect(next.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
  expect(
    (
      await w.request(
        "listCourses",
        undefined,
        {},
        { snapshotId: originalSnapshot.meta.id, limit: "1", cursor, q: "math" },
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await w.request(
        "listPlans",
        undefined,
        {},
        { termId: originalSnapshot.meta.termId, limit: "1", cursor },
      )
    ).status,
  ).toBe(400);
  await w.request("createPlan", {
    mode: "empty",
    snapshotId: originalSnapshot.meta.id,
    name: "Changes revision",
  });
  expect(
    (
      await w.request(
        "listCourses",
        undefined,
        {},
        { snapshotId: originalSnapshot.meta.id, limit: "1", cursor },
      )
    ).status,
  ).toBe(400);
});

it("the HTTP adapter reuses its idempotency key after a lost committed response", async () => {
  const { HttpWorkspace } = await import("../../src/client/data/http.js");
  const w = await setup();
  let dropped = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    const headers = new Headers(init?.headers);
    headers.set("host", "127.0.0.1:4317");
    headers.set("origin", origin);
    const response = await w.runtime.app.request(`${origin}${path}`, {
      ...init,
      headers,
    });
    if (path === "/api/plans" && init?.method === "POST" && !dropped) {
      dropped = true;
      throw new Error("connection lost after commit");
    }
    return response;
  });
  const client = new HttpWorkspace();
  await client.initialize();
  const input = {
    mode: "empty" as const,
    snapshotId: originalSnapshot.meta.id,
    name: "Exactly once",
  };
  await expect(client.createPlan(input)).rejects.toMatchObject({
    code: "LOCAL_CONNECTION_FAILED",
  });
  const replay = await client.createPlan(input);
  expect(replay.plan.content.name).toBe("Exactly once");
  expect(w.store.plans()).toHaveLength(2);
});

it("clearing cancels late work without permanently closing the planning service", async () => {
  let finish: (value: unknown) => void = () => {};
  let calls = 0;
  const w = await setup({
    synthetic: true,
    generate: () =>
      ++calls === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(output),
  });
  await w.request("generateTimetable", generation);
  const preview = (await w.request("previewClear", { scope: "planning" })).body
    .data;
  expect(
    (
      await w.request(
        "applyClear",
        { expectedDataRevision: preview.expectedDataRevision, confirm: true },
        { previewId: preview.id },
        {},
        "clear",
      )
    ).status,
  ).toBe(200);
  finish(output);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(w.store.resources("job", PlanningJob)).toEqual([]);
  w.store.transaction(() => {
    w.store.insertSnapshot(originalSnapshot);
    for (const plan of initialPlans) w.store.insertPlan(plan);
  });
  const result = await w.request(
    "generateTimetable",
    generation,
    {},
    {},
    "after-clear",
  );
  expect(result.status).toBe(202);
  expect((await completed(w, result.body.data.id)).status).toBe("succeeded");
});

it("finds a course by its concrete section selection code", async () => {
  const w = await setup();
  const section = requireValue(
    originalSnapshot.sections.find((s) => s.selectionCode.state === "known"),
  );
  if (section.selectionCode.state !== "known") throw new Error("fixture");
  const result = await w.request(
    "listCourses",
    undefined,
    {},
    { snapshotId: originalSnapshot.meta.id, q: section.selectionCode.value },
  );
  expect(result.status).toBe(200);
  expect(result.body.data.items.map((c: { id: string }) => c.id)).toContain(
    section.courseId,
  );
});
