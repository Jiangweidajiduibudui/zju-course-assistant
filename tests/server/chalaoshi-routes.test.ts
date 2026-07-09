import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";

/**
 * chalaoshi 路由 HTTP 契约（组员 B）。
 * 默认无 mock 上游 → 抓取失败降级 seed，端点仍 200 且 demo=true。
 */
describe("GET /api/chalaoshi/*", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        // 指向不可达域名，强制走 seed（CI 不访问真实上游）
        CHALAOSHI_BASE_URL: "https://chalaoshi.invalid",
        CHALAOSHI_API_BASE_URL: "https://api.chalaoshi.invalid",
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /teachers 降级 seed 仍 200，demo=true", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teachers?query=演示",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.demo).toBe(true);
    expect(body.sourceMeta.cacheState).toBe("seed");
    expect(body.teachers.some((t: { name: string }) => t.name.includes("演示教师"))).toBe(true);
  });

  it("GET /teacher/:id 返回 seed 详情与来源标记", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teacher/900001",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.demo).toBe(true);
    expect(body.teacher.sourceMeta.cacheState).toBe("seed");
    expect(body.teacher.name).toBe("演示教师甲");
  });

  it("GET /teacher/:id/comments 返回合成评论且不崩", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teacher/900001/comments",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.demo).toBe(true);
    expect(body.comments[0].text).toContain("合成评论");
  });

  it("非法 teacher id → 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teacher/not-a-number",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("COMMON_VALIDATION_FAILED");
  });
});
