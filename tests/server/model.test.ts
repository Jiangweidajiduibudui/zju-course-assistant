import { afterEach, describe, expect, it, vi } from "vitest";
import { initialPlans, originalSnapshot } from "../../fixtures/ui/catalog.js";
import { ModelService, type Transport } from "../../src/server/llm/service.js";
import { endpointUrl, publicAddress } from "../../src/server/llm/transport.js";
import { PlanningService } from "../../src/server/planning.js";
import { Store } from "../../src/server/storage/store.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => {
      f();
    });
});
const valid = {
  selections: [
    { courseId: "math", sectionId: "math-c", reason: "Synthetic selection" },
    { courseId: "code", sectionId: "code-a", reason: "Synthetic selection" },
  ],
  explanation: "Synthetic provider output",
};
const envelope = (value: unknown) => ({
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(value) } },
  ],
});
function setup(transport: Transport) {
  const store = new Store(":memory:");
  store.insertSnapshot(originalSnapshot);
  initialPlans.forEach((p) => {
    store.insertPlan(p);
  });
  const models = new ModelService(store, transport),
    planning = new PlanningService(store, undefined, models);
  cleanup.push(() => {
    planning.close();
    models.clear();
    store.close();
  });
  const settings = models.update({
    expectedRevision: 1,
    content: {
      ...models.settings().content,
      llmEnabled: true,
      endpoints: [
        {
          id: null,
          label: "Test",
          baseUrl: "https://api.kittyrouter.com/v1/chat/completions",
          model: "gemini-3.8-flash",
        },
      ],
    },
  });
  const endpoint = settings.content.endpoints[0];
  if (!endpoint) throw new Error("No endpoint");
  models.credential(endpoint.id, "synthetic-test-key");
  const input = {
    plan: { planId: "plan-main", expectedRevision: 1 },
    endpointId: endpoint.id,
  };
  const wait = async (id: string) => {
    await vi.waitFor(() =>
      expect(["queued", "running"]).not.toContain(planning.get(id).status),
    );
    return planning.get(id);
  };
  return { store, models, planning, input, endpoint, wait };
}
describe("public endpoint boundary", () => {
  it("rejects local, metadata, reserved, transition and documentation addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "198.18.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001::1",
      "2001:db8::1",
      "2002:7f00:1::",
      "3fff::1",
    ])
      expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("accepts the exact full endpoint and rejects credentials, alternate ports and IP literals", () => {
    const url = "https://api.kittyrouter.com/v1/chat/completions";
    expect(endpointUrl(url).href).toBe(url);
    for (const value of [
      "http://example.com/v1",
      "https://example.com:444/v1",
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://a:b@example.com/v1",
      "https://example.com/v1?key=secret",
      "https://service.internal/v1",
    ])
      expect(() => endpointUrl(value)).toThrow();
  });
});
it("keeps keys out of SQLite/settings and requires re-entry after endpoint changes", () => {
  const w = setup(async () => envelope(valid));
  const binding = w.models.binding(w.endpoint.id);
  expect(JSON.stringify(w.models.settings())).not.toContain(
    "synthetic-test-key",
  );
  expect(
    JSON.stringify(w.store.db.prepare("SELECT data FROM resources").all()),
  ).not.toContain("synthetic-test-key");
  const previous = w.models.settings();
  w.models.update({
    expectedRevision: previous.revision,
    content: {
      ...previous.content,
      endpoints: [
        {
          id: w.endpoint.id,
          label: "Test",
          baseUrl: w.endpoint.baseUrl,
          model: "changed-model",
        },
      ],
    },
  });
  expect(w.models.credential(w.endpoint.id).configured).toBe(false);
  expect(w.models.current(binding)).toBe(false);
  expect(() => w.models.binding(w.endpoint.id)).toThrow(/key/);
});
it("uses the exact endpoint, bounded JSON response mode and candidate context without a key in messages", async () => {
  const transport = vi.fn<Transport>(async () => envelope(valid));
  const w = setup(transport);
  const job = await w.wait(w.planning.start(w.input).id);
  expect(job.status).toBe("succeeded");
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, key, body] = transport.mock.calls[0] ?? [];
  expect(url?.href).toBe(w.endpoint.baseUrl);
  expect(key).toBe("synthetic-test-key");
  expect(body).toMatchObject({
    model: "gemini-3.8-flash",
    stream: false,
    response_format: { type: "json_object" },
    max_tokens: 8192,
  });
  expect(JSON.stringify(body)).not.toContain("synthetic-test-key");
  expect(w.store.plan("plan-main").revision).toBe(1);
});
it("corrects an invented section once and validates the repaired proposal", async () => {
  const transport = vi
    .fn<Transport>()
    .mockResolvedValueOnce(
      envelope({
        ...valid,
        selections: [
          { courseId: "math", sectionId: "invented", reason: "bad" },
        ],
      }),
    )
    .mockResolvedValueOnce(envelope(valid));
  const w = setup(transport),
    job = await w.wait(w.planning.start(w.input).id);
  expect(job.status).toBe("succeeded");
  expect(transport).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(transport.mock.calls[1]?.[2])).toContain(
    "OUTPUT_SCHEMA_OR_CANDIDATE_REFERENCE_INVALID",
  );
  expect(w.store.plans()).toHaveLength(initialPlans.length);
});
it("stops at two invalid outputs and never interprets that failure as no solution", async () => {
  const transport = vi.fn<Transport>(async () =>
    envelope({ noSolution: true }),
  );
  const w = setup(transport),
    job = await w.wait(w.planning.start(w.input).id);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(job.status).toBe("failed");
  expect(job.error?.message).toContain("不证明");
  expect(job.proposals).toEqual([]);
});
it("rejects prose without attempting to salvage embedded JSON", async () => {
  const transport = vi.fn<Transport>(async () => ({
    choices: [
      { message: { content: `Here you go: ${JSON.stringify(valid)}` } },
    ],
  }));
  const w = setup(transport);
  expect((await w.wait(w.planning.start(w.input).id)).status).toBe("failed");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("invalidates completed proposals when the key is replaced", async () => {
  const w = setup(async () => envelope(valid)),
    job = await w.wait(w.planning.start(w.input).id);
  const proposal = job.proposals[0];
  expect(proposal).toBeDefined();
  w.models.credential(w.endpoint.id, "replacement-test-key");
  expect(w.planning.get(job.id).status).toBe("stale");
  expect(() =>
    w.planning.adopt(proposal?.id ?? "", {
      plan: w.input.plan,
      name: "Should fail",
    }),
  ).toThrow();
});
it("cancelled late model responses cannot publish or trigger a correction", async () => {
  let finish: (value: unknown) => void = () => {};
  const transport = vi.fn<Transport>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const w = setup(transport),
    job = w.planning.start(w.input);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  w.planning.cancel(job.id);
  finish(envelope(valid));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(w.planning.get(job.id).status).toBe("cancelled");
  expect(w.planning.get(job.id).proposals).toEqual([]);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("uses the official DeepSeek Base URL and its documented bounded reasoning controls", async () => {
  const transport = vi.fn(async () => envelope(valid));
  const w = setup(transport);
  const before = w.models.settings();
  w.models.update({
    expectedRevision: before.revision,
    content: {
      ...before.content,
      endpoints: [
        {
          id: w.endpoint.id,
          label: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
        },
      ],
    },
  });
  w.models.credential(w.endpoint.id, "synthetic-deepseek-key");
  const job = w.planning.start(w.input);
  await w.wait(job.id);
  expect(transport).toHaveBeenCalled();
  const [url, , body] = transport.mock.calls[0] as unknown as [
    URL,
    string,
    Record<string, unknown>,
  ];
  expect(url.href).toBe("https://api.deepseek.com/v1/chat/completions");
  expect(body.reasoning_effort).toBe("low");
  expect(body.response_format).toEqual({ type: "json_object" });
});
