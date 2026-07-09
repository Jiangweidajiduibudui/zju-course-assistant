import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/server/config.js";
import {
  fetchUpstreamText,
  resetUpstreamRateLimitForTests,
} from "../../src/server/modules/chalaoshi/fetcher.js";
import { assertChalaoshiUrlAllowed } from "../../src/server/modules/chalaoshi/url-guard.js";

const ALLOWED = ["chalaoshi.de", "api.chalaoshi.de"] as const;

describe("assertChalaoshiUrlAllowed", () => {
  it("放行 allowlist HTTPS", () => {
    expect(() =>
      assertChalaoshiUrlAllowed("https://chalaoshi.de/teacher/1/", ALLOWED),
    ).not.toThrow();
    expect(() =>
      assertChalaoshiUrlAllowed("https://api.chalaoshi.de/comments/1", ALLOWED),
    ).not.toThrow();
  });

  it("拒绝非 HTTPS / 非常规端口", () => {
    expect(() => assertChalaoshiUrlAllowed("http://chalaoshi.de/", ALLOWED)).toThrow(/HTTPS/);
    expect(() => assertChalaoshiUrlAllowed("https://chalaoshi.de:8443/", ALLOWED)).toThrow(/443/);
  });

  it("拒绝 localhost / 私网 / link-local", () => {
    expect(() => assertChalaoshiUrlAllowed("https://localhost/", ALLOWED)).toThrow(/禁止/);
    expect(() => assertChalaoshiUrlAllowed("https://127.0.0.1/", ALLOWED)).toThrow(/禁止/);
    expect(() => assertChalaoshiUrlAllowed("https://10.0.0.1/", ALLOWED)).toThrow(/禁止/);
    expect(() => assertChalaoshiUrlAllowed("https://192.168.1.1/", ALLOWED)).toThrow(/禁止/);
    expect(() => assertChalaoshiUrlAllowed("https://169.254.1.1/", ALLOWED)).toThrow(/禁止/);
    expect(() => assertChalaoshiUrlAllowed("https://[::1]/", ALLOWED)).toThrow(/禁止/);
  });

  it("拒绝 zdbk 与非 allowlist host", () => {
    expect(() => assertChalaoshiUrlAllowed("https://zdbk.example.com/", ALLOWED)).toThrow(
      /禁止|allowlist/,
    );
    expect(() => assertChalaoshiUrlAllowed("https://evil.example.com/", ALLOWED)).toThrow(
      /allowlist/,
    );
  });

  it("loadConfig 拒绝非法 base URL", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        CHALAOSHI_BASE_URL: "https://127.0.0.1",
        CHALAOSHI_API_BASE_URL: "https://api.chalaoshi.de",
      }),
    ).toThrow();
  });
});

describe("fetchUpstreamText redirect 逐跳复查", () => {
  it("拒绝跳转到私网/非 allowlist", async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/secret" },
      });
    });
    await expect(
      fetchUpstreamText("https://chalaoshi.de/teacher/1/", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        allowedHosts: ALLOWED,
        minIntervalMs: 0,
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/禁止|allowlist|出站/);
  });

  it("允许同 allowlist 内重定向后返回正文", async () => {
    resetUpstreamRateLimitForTests();
    let hop = 0;
    const fetchImpl = vi.fn(async () => {
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 301,
          headers: { Location: "https://api.chalaoshi.de/comments/1" },
        });
      }
      return new Response("<div>ok</div>", { status: 200 });
    });
    const text = await fetchUpstreamText("https://chalaoshi.de/teacher/1/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      allowedHosts: ALLOWED,
      minIntervalMs: 0,
      timeoutMs: 100,
    });
    expect(text).toContain("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
