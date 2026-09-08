import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "playwright";
import { afterEach, expect, it, vi } from "vitest";
import { SchoolSession } from "../../src/server/zdbk/session.js";

const cleanup: (() => void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) close();
  vi.restoreAllMocks();
});
function setup(statuses: (number | Error)[]) {
  const directory = mkdtempSync(join(tmpdir(), "zju-session-test-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const session = new SchoolSession(directory);
  writeFileSync(session.sessionFile, "{}");
  const dispose = vi.fn(async () => {});
  const fetch = vi.fn(async () => {
    const status = statuses.shift() ?? 200;
    if (status instanceof Error) throw status;
    return {
      status: () => status,
      ok: () => status === 200,
      body: async () => Buffer.from("[]"),
      dispose,
    };
  });
  vi.spyOn(request, "newContext").mockResolvedValue({
    fetch,
    storageState: async () => ({ cookies: [], origins: [] }),
    dispose: async () => {},
  } as unknown as Awaited<ReturnType<typeof request.newContext>>);
  return { session, fetch, dispose };
}
it("retries transient read errors and releases failed responses", async () => {
  const { session, fetch, dispose } = setup([
    503,
    new Error("synthetic connection reset"),
    200,
  ]);
  expect(await session.read("weeks", {}, new AbortController().signal)).toBe(
    "[]",
  );
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(dispose).toHaveBeenCalledTimes(2);
});
it("does not retry expired sessions and disposes their response", async () => {
  const { session, fetch, dispose } = setup([302]);
  await expect(
    session.read("weeks", {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
});
it("stops retries when cancelled during backoff", async () => {
  const { session, fetch } = setup([503]);
  const controller = new AbortController();
  const result = session.read("weeks", {}, controller.signal);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  controller.abort();
  await expect(result).rejects.toMatchObject({ code: "SYNC_INCOMPLETE" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("stops after the bounded retry budget without publishing a response", async () => {
  const { session, fetch, dispose } = setup([503, 503, 503, 200]);
  await expect(
    session.read("weeks", {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(dispose).toHaveBeenCalledTimes(3);
});
