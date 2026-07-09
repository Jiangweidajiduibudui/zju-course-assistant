import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { resetUpstreamRateLimitForTests } from "../../src/server/modules/chalaoshi/fetcher.js";

/** 服务端装配 smoke test：应用可构建、健康检查可用、stub 端点诚实返回 501。 */
describe("Fastify 应用装配", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => {
      throw new Error("mock upstream unavailable");
    });
    app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        CHALAOSHI_BASE_URL: "https://chalaoshi.test",
        CHALAOSHI_API_BASE_URL: "https://api.chalaoshi.test",
        CHALAOSHI_ALLOWED_HOSTS: "chalaoshi.test,api.chalaoshi.test",
      }),
      {
        chalaoshiFetchImpl: fetchImpl as unknown as typeof fetch,
        chalaoshiTimeoutMs: 50,
        chalaoshiMinIntervalMs: 0,
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health 返回 ok", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("未实现端点返回 501 + COMMON_NOT_IMPLEMENTED（不伪装成功 —— docs/08 §2-7）", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/capability-check",
      payload: {},
    });
    expect(response.statusCode).toBe(501);
    expect(response.json().errorCode).toBe("COMMON_NOT_IMPLEMENTED");
  });

  it("chalaoshi 已实现：上游不可达时降级 seed 仍 200（Task 3）", async () => {
    const response = await app.inject({ method: "GET", url: "/api/chalaoshi/teachers?query=演示" });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json().demo).toBe(true);
  });
});
