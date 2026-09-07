import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { request } from "node:https";
import { afterEach, expect, it, vi } from "vitest";
import { endpointUrl, postJson } from "../../src/server/llm/transport.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("pins one public address with Node family auto-selection disabled and keeps TLS hostname", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  const response = Object.assign(new EventEmitter(), { statusCode: 200 });
  const req = Object.assign(new EventEmitter(), {
    end: vi.fn(() => {
      queueMicrotask(() => {
        response.emit("data", Buffer.from('{"ok":true}'));
        response.emit("end");
      });
    }),
  });
  vi.mocked(request).mockImplementation(((
    url: URL,
    options: Record<string, unknown>,
    callback: (r: unknown) => void,
  ) => {
    expect(url.hostname).toBe("api.kittyrouter.com");
    expect(options).toMatchObject({
      family: 4,
      autoSelectFamily: false,
      agent: false,
    });
    const resolver = options.lookup as (
      host: string,
      options: unknown,
      callback: (error: unknown, address: string, family: number) => void,
    ) => void;
    resolver(url.hostname, { all: false }, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBe("8.8.8.8");
      expect(family).toBe(4);
    });
    callback(response);
    return req;
  }) as never);
  await expect(
    postJson(
      endpointUrl("https://api.kittyrouter.com/v1/chat/completions"),
      "test-only",
      {},
      AbortSignal.timeout(1000),
    ),
  ).resolves.toEqual({ ok: true });
});
it("refuses a mixed public/private DNS answer before constructing a connection", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ] as never);
  await expect(
    postJson(
      endpointUrl("https://example.com/v1"),
      "test-only",
      {},
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ code: "ENDPOINT_REJECTED" });
  expect(request).not.toHaveBeenCalled();
});
it("does not follow a provider redirect or expose its response body", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  const response = {
    statusCode: 302,
    resume: vi.fn(),
    headers: { location: "http://127.0.0.1/private" },
  };
  const req = Object.assign(new EventEmitter(), { end: vi.fn() });
  vi.mocked(request).mockImplementation(((
    _url: unknown,
    _options: unknown,
    callback: (r: unknown) => void,
  ) => {
    callback(response);
    return req;
  }) as never);
  await expect(
    postJson(
      endpointUrl("https://example.com/v1"),
      "test-only",
      {},
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(response.resume).toHaveBeenCalledTimes(1);
});

it("adapts Base URLs and full Chat Completions URLs without double suffixes", () => {
  for (const [input, expected] of [
    [
      "https://api.deepseek.com",
      "https://api.deepseek.com/v1/chat/completions",
    ],
    [
      "https://api.deepseek.com/v1/",
      "https://api.deepseek.com/v1/chat/completions",
    ],
    [
      "https://api.kittyrouter.com/v1/chat/completions",
      "https://api.kittyrouter.com/v1/chat/completions",
    ],
    [
      "https://example.com/openai/v1",
      "https://example.com/openai/v1/chat/completions",
    ],
  ])
    expect(endpointUrl(input ?? "").href).toBe(expected);
});
