import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ dns: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocked.dns }));
vi.mock("node:https", () => ({ request: mocked.request }));

import { getReviewText } from "../../src/server/reviews/transport.js";

afterEach(() => vi.resetAllMocks());
it("rejects private DNS answers before opening a connection", async () => {
  mocked.dns.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  await expect(
    getReviewText(new URL("https://example.com/"), AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ code: "ENDPOINT_REJECTED" });
  expect(mocked.request).not.toHaveBeenCalled();
});
function response(status: number, text: string) {
  mocked.dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocked.request.mockImplementation((_url, options, callback) => {
    expect(options.method).toBe("GET");
    expect(Object.keys(options.headers).sort()).toEqual([
      "Accept",
      "Accept-Encoding",
    ]);
    const pinned = vi.fn();
    options.lookup("example.com", {}, pinned);
    expect(pinned).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const res = Object.assign(new EventEmitter(), {
        statusCode: status,
        resume: vi.fn(),
        destroy(error: Error) {
          res.emit("error", error);
        },
      });
      callback(res);
      if (status === 200) {
        res.emit("data", Buffer.from(text));
        res.emit("end");
      }
    };
    return req;
  });
}
it("uses pinned anonymous GET and refuses redirects", async () => {
  response(302, "");
  await expect(
    getReviewText(new URL("https://example.com/"), AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(mocked.request).toHaveBeenCalledTimes(1);
});
it("enforces the response byte budget", async () => {
  response(200, "oversized body");
  await expect(
    getReviewText(
      new URL("https://example.com/"),
      AbortSignal.timeout(1000),
      4,
    ),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
});
