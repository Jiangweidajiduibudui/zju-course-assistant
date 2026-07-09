import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import type { FastifyInstance } from "fastify";

/** 服务端装配 smoke test：应用可构建、健康检查可用、stub 端点诚实返回 501。 */
describe("Fastify 应用装配", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: "test" }));
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
    const response = await app.inject({ method: "GET", url: "/api/chalaoshi/teachers" });
    expect(response.statusCode).toBe(501);
    expect(response.json().errorCode).toBe("COMMON_NOT_IMPLEMENTED");
  });
});
