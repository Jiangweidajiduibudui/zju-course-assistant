import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/server/config.js";
import { createSingleFlight } from "../../src/server/modules/chalaoshi/cache.js";
import { resetUpstreamRateLimitForTests } from "../../src/server/modules/chalaoshi/fetcher.js";
import { createChalaoshiService } from "../../src/server/modules/chalaoshi/service.js";

/** 缓存命中 / single-flight / 抓取失败 seed 降级（组员 B；docs/05 §5.2） */
const FIXTURES = join(import.meta.dirname, "../../docs/fixtures/chalaoshi");

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), "utf8");
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

describe("createSingleFlight", () => {
  it("相同 key 并发只执行一次 factory", async () => {
    const singleFlight = createSingleFlight();
    let runs = 0;
    const factory = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 30));
      return "ok";
    };
    const [a, b, c] = await Promise.all([
      singleFlight("k", factory),
      singleFlight("k", factory),
      singleFlight("k", factory),
    ]);
    expect([a, b, c]).toEqual(["ok", "ok", "ok"]);
    expect(runs).toBe(1);
  });
});

describe("chalaoshi service 缓存与降级", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    CHALAOSHI_BASE_URL: "https://chalaoshi.test",
    CHALAOSHI_API_BASE_URL: "https://api.chalaoshi.test",
    CHALAOSHI_ALLOWED_HOSTS: "chalaoshi.test,api.chalaoshi.test",
  });

  it("上游成功后首次 live，二次请求命中 L1 为 cached（不再打上游）", async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => jsonResponse(readFixture("search.synthetic.json")));
    const service = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
    });

    const first = await service.searchTeachers("演示教师甲");
    const second = await service.searchTeachers("演示教师甲");
    expect(first.teachers[0]?.id).toBe(900001);
    expect(first.sourceMeta.cacheState).toBe("live");
    expect(second.sourceMeta.cacheState).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("上游失败 → seed 降级且 cacheState=seed", async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const service = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
    });

    const detail = await service.getTeacherDetail(900001);
    expect(detail.sourceMeta.cacheState).toBe("seed");
    expect(detail.name).toBe("演示教师甲");
    expect(detail.gpaByCourse[0]?.courseName).toBe("合成微积分演示");

    const comments = await service.getTeacherComments(900001);
    expect(comments.sourceMeta.cacheState).toBe("seed");
    expect(comments.comments.length).toBeGreaterThan(0);
    expect(comments.comments[0]?.text).toContain("合成评论");
  });

  it("详情上游成功返回 live，再请求为 cached", async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/teacher/900001")) {
        return htmlResponse(readFixture("teacher-detail.synthetic.html"));
      }
      return new Response("not found", { status: 404 });
    });
    const service = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
    });

    const live = await service.getTeacherDetail(900001);
    expect(live.sourceMeta.cacheState).toBe("live");
    expect(live.callRollPercent).toBe(12);

    const cached = await service.getTeacherDetail(900001);
    expect(cached.sourceMeta.cacheState).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("disableSeedFallback 时上游失败直接抛错", async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const service = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
      disableSeedFallback: true,
    });
    await expect(service.getTeacherDetail(900001)).rejects.toThrow(/HTTP 503|上游/);
  });

  it("seed 中不存在的 teacherId 抛 CHALAOSHI_TEACHER_NOT_FOUND（非 fake success）", async () => {
    resetUpstreamRateLimitForTests();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const service = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
    });
    await expect(service.getTeacherDetail(424242)).rejects.toMatchObject({
      errorCode: "CHALAOSHI_TEACHER_NOT_FOUND",
    });
    await expect(service.getTeacherComments(424242)).rejects.toMatchObject({
      errorCode: "CHALAOSHI_TEACHER_NOT_FOUND",
    });
  });
});
