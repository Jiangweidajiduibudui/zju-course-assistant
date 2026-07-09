import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { resetUpstreamRateLimitForTests } from "../../src/server/modules/chalaoshi/fetcher.js";

/**
 * chalaoshi 路由 HTTP 契约（组员 B）。
 * 通过注入 mock fetch 走 hermetic 路径：不依赖真实 DNS/网络。
 */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures/chalaoshi");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    CHALAOSHI_BASE_URL: "https://chalaoshi.test",
    CHALAOSHI_API_BASE_URL: "https://api.chalaoshi.test",
    CHALAOSHI_ALLOWED_HOSTS: "chalaoshi.test,api.chalaoshi.test",
  });
}

describe("GET /api/chalaoshi/*（seed 降级，mock 上游失败）", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => {
      throw new Error("mock upstream unavailable");
    });
    app = await buildApp(testConfig(), {
      chalaoshiFetchImpl: fetchImpl as unknown as typeof fetch,
      chalaoshiTimeoutMs: 50,
      chalaoshiMinIntervalMs: 0,
    });
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

  it("seed 中不存在的 teacher → 404 CHALAOSHI_TEACHER_NOT_FOUND", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teacher/999999",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().errorCode).toBe("CHALAOSHI_TEACHER_NOT_FOUND");
  });
});

describe("GET /api/chalaoshi/*（mock live upstream）", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/static/json/search.json")) {
        return new Response(readFixture("search.synthetic.json"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/teacher/900001")) {
        return new Response(readFixture("teacher-detail.synthetic.html"), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.includes("/comments/900001")) {
        return new Response(readFixture("comments.synthetic.html"), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    app = await buildApp(testConfig(), {
      chalaoshiFetchImpl: fetchImpl as unknown as typeof fetch,
      chalaoshiTimeoutMs: 50,
      chalaoshiMinIntervalMs: 0,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("search 首次 live，二次 L1 命中为 cached", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teachers?query=演示教师甲",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().sourceMeta.cacheState).toBe("live");
    expect(first.json().demo).toBe(false);

    const second = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teachers?query=演示教师甲",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().sourceMeta.cacheState).toBe("cached");
  });

  it("teacher detail / comments live 路径 200", async () => {
    const detail = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teacher/900001",
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().teacher.sourceMeta.cacheState).toBe("live");

    const comments = await app.inject({
      method: "GET",
      url: "/api/chalaoshi/teacher/900001/comments",
    });
    expect(comments.statusCode).toBe(200);
    expect(comments.json().sourceMeta.cacheState).toBe("live");
  });
});
