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

  it("L1 stale 可反复返回：TTL 过期后上游失败，连续两次均为 stale", async () => {
    resetUpstreamRateLimitForTests();
    let failUpstream = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (failUpstream) {
        throw new Error("upstream down");
      }
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
      l1TtlMs: 40,
    });

    const live = await service.getTeacherDetail(900001);
    expect(live.sourceMeta.cacheState).toBe("live");

    await new Promise((r) => setTimeout(r, 60));
    failUpstream = true;

    const stale1 = await service.getTeacherDetail(900001);
    const stale2 = await service.getTeacherDetail(900001);
    expect(stale1.sourceMeta.cacheState).toBe("stale");
    expect(stale2.sourceMeta.cacheState).toBe("stale");
    expect(stale1.name).toBe("演示教师甲");
    expect(stale2.name).toBe("演示教师甲");
  });
});

describe("chalaoshi L2 公共缓存", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    CHALAOSHI_BASE_URL: "https://chalaoshi.test",
    CHALAOSHI_API_BASE_URL: "https://api.chalaoshi.test",
    CHALAOSHI_ALLOWED_HOSTS: "chalaoshi.test,api.chalaoshi.test",
  });

  it("有 L2 时 live 写回；新 service 实例可从 L2 读到 cached", async () => {
    resetUpstreamRateLimitForTests();
    const { createMemoryL2Store } = await import("../../src/server/modules/chalaoshi/l2.js");
    const l2 = createMemoryL2Store();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/teacher/900001")) {
        return htmlResponse(readFixture("teacher-detail.synthetic.html"));
      }
      return new Response("not found", { status: 404 });
    });

    const writer = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
      l2,
      instanceId: "writer",
    });
    const live = await writer.getTeacherDetail(900001);
    expect(live.sourceMeta.cacheState).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const reader = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
      l2,
      instanceId: "reader",
    });
    const cached = await reader.getTeacherDetail(900001);
    expect(cached.sourceMeta.cacheState).toBe("cached");
    expect(cached.name).toBe("演示教师甲");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("L2 过期后上游失败仍返回 stale（跨实例）", async () => {
    resetUpstreamRateLimitForTests();
    let clock = Date.parse("2026-07-01T00:00:00.000Z");
    const now = () => new Date(clock);
    const { createMemoryL2Store } = await import("../../src/server/modules/chalaoshi/l2.js");
    const l2 = createMemoryL2Store({ now });

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (clock > Date.parse("2026-07-01T00:00:00.000Z")) {
        throw new Error("upstream down");
      }
      const url = String(input);
      if (url.includes("/teacher/900001")) {
        return htmlResponse(readFixture("teacher-detail.synthetic.html"));
      }
      return new Response("not found", { status: 404 });
    });

    const writer = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
      l1TtlMs: 1_000,
      l2,
      now,
      instanceId: "writer",
    });
    expect((await writer.getTeacherDetail(900001)).sourceMeta.cacheState).toBe("live");

    // 推进时钟使 L2 过期；新实例无 L1
    clock += 2_000;
    const reader = createChalaoshiService({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 0,
      timeoutMs: 50,
      l1TtlMs: 1_000,
      l2,
      now,
      instanceId: "reader",
    });
    const stale1 = await reader.getTeacherDetail(900001);
    const stale2 = await reader.getTeacherDetail(900001);
    expect(stale1.sourceMeta.cacheState).toBe("stale");
    expect(stale2.sourceMeta.cacheState).toBe("stale");
    expect(stale1.name).toBe("演示教师甲");
  });
});
