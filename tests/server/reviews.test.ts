import { afterEach, describe, expect, it, vi } from "vitest";
import { originalSnapshot } from "../../fixtures/ui/catalog.js";
import { createApp } from "../../src/server/app.js";
import { ServiceError } from "../../src/server/errors.js";
import type { Transport } from "../../src/server/llm/service.js";
import {
  anonymousReviewText,
  prepareSummary,
} from "../../src/server/reviews/comments.js";
import {
  LiveReviews,
  parseComments,
  parseTeacherDetail,
  parseTeacherIndex,
  type ReviewDriver,
} from "../../src/server/reviews/source.js";
import { reviewUrl } from "../../src/server/reviews/transport.js";
import { Service } from "../../src/server/service.js";
import { Store } from "../../src/server/storage/store.js";
import { api, type OperationId } from "../../src/shared/contracts/api.js";
import {
  ExternalTeacher,
  Review,
  TeacherMatch,
} from "../../src/shared/contracts/reviews.js";

// Authored synthetic DOM based on observed element structure, never real reviews.
const index = JSON.stringify({
  teachers: [
    {
      id: 101,
      name: "示例教师甲",
      xy: 1,
      py: "synthetic",
      sx: "s",
      hot: 8,
      rate: "4.6",
    },
  ],
  colleges: [{ id: 1, name: "示例学院" }],
});
const detail = `<div class="teacher"><div class="left"><h3>示例教师甲</h3><p id="college">示例学院</p></div><div class="right"><h2>4.6</h2><p>9人</p></div></div><div class="course-list font-hei"><div class="row"><div class="left"><p class="course_name">微积分基础</p></div><div class="right"><p>3.7/6+</p></div></div></div>`;
const comment = (text: string) =>
  `<div id="comment-page" class="hidden"><div class="row"><div class="left"><p>${text}</p></div><div class="right"><a class="up" onclick="untrusted()">vote</a><p class="private-id-count">123</p></div></div><p class="comment-footer">private author <a href="https://example.com/user">profile</a></p><hr></div>`;
const comments =
  comment("讲解细致，练习量较大。") +
  comment("偶尔点名，课后答疑认真。") +
  comment("讲解细致，练习量较大。");
const source = {
  provider: "chalaoshi" as const,
  url: "https://chalaoshi.de/teacher/101/",
  observedAt: "2026-09-07T00:00:00Z",
};
const teacher = ExternalTeacher.parse({
  id: "101",
  name: "示例教师甲",
  college: { state: "known", value: "示例学院" },
  source,
});
const input = {
  snapshotId: originalSnapshot.meta.id,
  teacherId: "teacher-math-a",
  sourceId: "primary" as const,
};
const callbacks: Array<() => void> = [];
afterEach(() => {
  for (const close of callbacks.splice(0).reverse()) close();
  vi.restoreAllMocks();
});
function driver(): ReviewDriver {
  return {
    synthetic: true,
    index: vi.fn(async () => parseTeacherIndex(index, "https://chalaoshi.de/")),
    review: vi.fn<ReviewDriver["review"]>(async () => ({
      ...parseTeacherDetail(detail, teacher, source),
      comments: parseComments(comments),
      availableCommentCount: { state: "known", value: 2 },
    })),
  };
}
function setup(reviewDriver = driver(), transport?: Transport) {
  const store = new Store(":memory:");
  store.insertSnapshot(originalSnapshot);
  const service = new Service(
    store,
    "test-token",
    undefined,
    transport,
    undefined,
    reviewDriver,
  );
  callbacks.push(() => {
    service.reviews.clear();
    service.models.clear();
    service.planning.close();
    store.close();
  });
  const settings = service.models.update({
    expectedRevision: 1,
    content: {
      ...service.models.settings().content,
      reviewsEnabled: true,
      llmEnabled: true,
      endpoints: [
        {
          id: null,
          label: "Synthetic test",
          baseUrl: "https://example.com",
          model: "test",
        },
      ],
    },
  });
  const endpoint = settings.content.endpoints[0];
  if (!endpoint) throw new Error("Missing endpoint");
  service.models.credential(endpoint.id, "synthetic-only-key");
  const load = async () => {
    const match = await service.reviews.lookup(input);
    const fetchInput = {
      snapshotId: input.snapshotId,
      sourceId: input.sourceId,
      courseId: "math",
      matchId: match.id,
      matchRevision: match.revision,
      refresh: false,
    };
    const result = await service.reviews.fetch(fetchInput);
    if (result.status !== "available")
      throw new Error("Missing synthetic review");
    return { match, fetchInput, review: result.review };
  };
  return { store, service, reviewDriver, endpoint, load };
}
function response(output: unknown) {
  return {
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(output) } },
    ],
  };
}
const summaryOutput = {
  pros: ["讲解细致"],
  cons: ["练习量较大"],
  attendance: { status: "reported", text: "有评论提到偶尔点名。" },
  sampleSize: 2,
  lowSample: true,
};

describe("observed review schemas, anonymous extraction and bounds", () => {
  it("joins known college IDs and rejects duplicate IDs or malformed index shapes", () => {
    expect(parseTeacherIndex(index, "https://chalaoshi.de/")[0]).toMatchObject({
      name: teacher.name,
      college: teacher.college,
    });
    expect(() => parseTeacherIndex("[]", "https://chalaoshi.de/")).toThrow();
    const data = JSON.parse(index);
    data.teachers.push(data.teachers[0]);
    expect(() =>
      parseTeacherIndex(JSON.stringify(data), "https://chalaoshi.de/"),
    ).toThrow();
  });
  it("preserves observed rating text without fabricating a scale or exact lower-bound count", () => {
    const parsed = parseTeacherDetail(detail, teacher, source);
    expect(parsed.teacherRating).toEqual({
      state: "unknown",
      reason: "not_verified",
      displayText: "4.6 · 9人",
    });
    expect(parsed.courseGrades[0]?.average).toEqual({
      state: "unknown",
      reason: "not_verified",
      displayText: "3.7/6+",
    });
    expect(() =>
      parseTeacherDetail(
        detail.replace("示例教师甲", "其他教师"),
        teacher,
        source,
      ),
    ).toThrow();
  });
  it("extracts only anonymous bodies, deduplicates and ignores alternate orderings and vote/author markup", () => {
    const parsed = parseComments(
      `${comments}<hr id="sep">${comment("另一个排序集合不再读取")}`,
    );
    expect(parsed).toHaveLength(2);
    expect(JSON.stringify(parsed)).not.toMatch(
      /private|onclick|vote|profile|另一个排序集合/,
    );
    expect(parsed.every((c) => c.postedAt.state === "unknown")).toBe(true);
    expect(parseComments("")).toEqual([]);
    expect(() => parseComments("<h1>Gateway error</h1>")).toThrow();
  });
  it("strips active markup and obvious contact details; budgets deduplicated comments before model input", () => {
    expect(
      anonymousReviewText(
        "<script>attack()</script>评价 a@example.com 13800138000 https://example.com/user",
      ),
    ).toBe("评价 [邮箱] [号码] [链接]");
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `test-${i}`,
      text: `${i} ${"长评价".repeat(1500)}`,
      postedAt: { state: "unknown" as const, reason: "not_provided" as const },
    }));
    const prepared = prepareSummary("test", rows);
    expect(
      prepared?.untrustedComments.reduce((n, c) => n + c.text.length, 0),
    ).toBeLessThanOrEqual(50000);
    expect(prepared?.untrustedComments.length).toBeLessThanOrEqual(100);
    expect(prepareSummary("empty", [])).toBeNull();
  });
  it("constructs anonymous paths from the selected source and offered numeric teacher ID only", async () => {
    const urls: string[] = [];
    const live = new LiveReviews(async (url) => {
      urls.push(url.href);
      return url.hostname === "api.chalaoshi.de" ? comments : detail;
    });
    await live.review(
      "https://chalaoshi.de/",
      teacher,
      AbortSignal.timeout(1000),
    );
    expect(urls).toEqual([
      "https://chalaoshi.de/teacher/101/",
      "https://api.chalaoshi.de/comments/101",
    ]);
    for (const url of [
      "https://127.0.0.1/",
      "https://user:password@example.com/",
      "http://example.com/",
      "https://example.com:444/",
      "https://example.com/?token=secret",
    ])
      expect(() => reviewUrl(url)).toThrow();
  });
});

describe("teacher binding, source separation, cache and summary lifecycle", () => {
  it("loads and caches one-source reviews without calling a model", async () => {
    const transport = vi.fn<Transport>();
    const w = setup(driver(), transport),
      { review, fetchInput } = await w.load();
    expect(review.courseGradeMatch.status).toBe("matched");
    expect(review.synthetic).toBe(true);
    await w.service.reviews.fetch(fetchInput);
    expect(w.reviewDriver.review).toHaveBeenCalledTimes(1);
    expect(transport).not.toHaveBeenCalled();
    expect(
      w.service.reviews.comments(review.id, review.revision).items,
    ).toHaveLength(2);
    expect(() =>
      w.service.reviews.comments(review.id, review.revision + 1),
    ).toThrow();
  });
  it("requires explicit confirmation when college evidence is missing, and rejects unoffered candidates", async () => {
    const d = driver();
    d.index = vi.fn<ReviewDriver["index"]>(async () => [
      { ...teacher, college: { state: "unknown", reason: "not_provided" } },
    ]);
    const w = setup(d);
    const match = await w.service.reviews.lookup(input);
    expect(match.state.status).toBe("needs_confirmation");
    expect(() =>
      w.service.reviews.confirm(match.id, {
        expectedRevision: match.revision,
        externalTeacherId: "999",
      }),
    ).toThrow();
    const confirmed = w.service.reviews.confirm(match.id, {
      expectedRevision: match.revision,
      externalTeacherId: teacher.id,
    });
    expect(confirmed.state).toMatchObject({
      status: "matched",
      method: "user_confirmed",
    });
    expect(() =>
      w.service.reviews.confirm(match.id, {
        expectedRevision: match.revision,
        externalTeacherId: teacher.id,
      }),
    ).toThrow();
  });
  it("rejects cross-course, cross-snapshot and cross-source review references", async () => {
    const w = setup(),
      { fetchInput } = await w.load();
    for (const patch of [
      { courseId: "code" },
      { snapshotId: "different" },
      { sourceId: "fallback" },
    ])
      await expect(
        w.service.reviews.fetch({ ...fetchInput, ...patch }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("stops disabled access and invalidates matching after source changes", async () => {
    const w = setup(),
      { match } = await w.load();
    const current = w.service.models.settings();
    w.service.models.update({
      expectedRevision: current.revision,
      content: { ...current.content, reviewsEnabled: false, endpoints: [] },
    });
    await expect(w.service.reviews.lookup(input)).rejects.toMatchObject({
      code: "EXTERNAL_ACCESS_DISABLED",
    });
    const disabled = w.service.models.settings();
    w.service.models.update({
      expectedRevision: disabled.revision,
      content: {
        ...disabled.content,
        reviewsEnabled: true,
        reviewSources: {
          ...disabled.content.reviewSources,
          primary: "https://example.com/",
        },
      },
    });
    expect(() =>
      w.service.reviews.confirm(match.id, {
        expectedRevision: match.revision,
        externalTeacherId: teacher.id,
      }),
    ).toThrow();
  });
  it("returns stale cache and requires explicit failover without reading a second source", async () => {
    const w = setup(),
      { fetchInput, review } = await w.load();
    vi.mocked(w.reviewDriver.review).mockRejectedValue(
      new ServiceError("UPSTREAM_UNAVAILABLE", "Synthetic failure", true),
    );
    const failure = await w.service.reviews.fetch({
      ...fetchInput,
      refresh: true,
    });
    expect(failure).toMatchObject({
      status: "source_switch_required",
      failedSourceId: "primary",
      suggestedSourceId: "fallback",
      cachedReview: { id: review.id, cacheState: "stale" },
    });
    expect(w.reviewDriver.index).toHaveBeenCalledTimes(1);
    expect(
      w.service.reviews.comments(review.id, review.revision).items,
    ).toHaveLength(2);
  });
  it("coalesces concurrent acquisitions and leaves no partial review after source failure", async () => {
    const w = setup();
    const match = await w.service.reviews.lookup(input);
    const request = {
      snapshotId: input.snapshotId,
      sourceId: input.sourceId,
      courseId: "math",
      matchId: match.id,
      matchRevision: match.revision,
      refresh: false,
    };
    await Promise.all([
      w.service.reviews.fetch(request),
      w.service.reviews.fetch(request),
    ]);
    expect(w.reviewDriver.review).toHaveBeenCalledTimes(1);
    expect(w.store.resources("review", Review)).toHaveLength(1);
  });
  it("summarizes sanitized stored comments, reuses the content cache and rejects stale revisions", async () => {
    const transport = vi.fn<Transport>(async (_url, _key, body) => {
      const payload = body as { messages: Array<{ content: string }> };
      expect(payload.messages[0]?.content).toContain("in concise Chinese");
      const sent = JSON.parse(payload.messages[1]?.content ?? "{}");
      expect(Object.keys(sent.input).sort()).toEqual([
        "lowSampleThreshold",
        "subjectRef",
        "untrustedComments",
      ]);
      expect(sent.input.untrustedComments).toHaveLength(2);
      expect(JSON.stringify(sent)).not.toMatch(/private|source|Cookie|学号/);
      return response(summaryOutput);
    });
    const w = setup(driver(), transport),
      { review, fetchInput } = await w.load();
    const body = {
      reviewId: review.id,
      expectedReviewRevision: review.revision,
      endpointId: w.endpoint.id,
    };
    const first = await w.service.execute("summarizeComments", {}, {}, body);
    expect(await w.service.execute("summarizeComments", {}, {}, body)).toEqual(
      first,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    await w.service.reviews.fetch({ ...fetchInput, refresh: true });
    await expect(
      w.service.execute("summarizeComments", {}, {}, body),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("rejects fabricated sample metadata and does not cache invalid output", async () => {
    const transport = vi.fn<Transport>(async () =>
      response({ ...summaryOutput, sampleSize: 90 }),
    );
    const w = setup(driver(), transport),
      { review } = await w.load();
    await expect(
      w.service.execute(
        "summarizeComments",
        {},
        {},
        {
          reviewId: review.id,
          expectedReviewRevision: review.revision,
          endpointId: w.endpoint.id,
        },
      ),
    ).rejects.toMatchObject({ code: "LLM_OUTPUT_INVALID" });
    expect(
      w.store.db
        .prepare("SELECT count(*) AS n FROM resources WHERE kind='summary'")
        .get(),
    ).toEqual({ n: 0 });
  });
  it("does not send empty reviews to a model", async () => {
    const d = driver(),
      original = d.review;
    d.review = async (...args) => ({
      ...(await original(...args)),
      comments: [],
      availableCommentCount: { state: "known", value: 0 },
    });
    const transport = vi.fn<Transport>(),
      w = setup(d, transport),
      { review } = await w.load();
    await expect(
      w.service.execute(
        "summarizeComments",
        {},
        {},
        {
          reviewId: review.id,
          expectedReviewRevision: review.revision,
          endpointId: w.endpoint.id,
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("drops in-flight review results after clearing the local workspace", async () => {
    const d = driver();
    const original = d.review;
    let resume: (() => void) | undefined;
    d.review = async (...args) => {
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
      return original(...args);
    };
    const w = setup(d),
      match = await w.service.reviews.lookup(input);
    const pending = w.service.reviews.fetch({
      snapshotId: input.snapshotId,
      sourceId: input.sourceId,
      courseId: "math",
      matchId: match.id,
      matchRevision: match.revision,
      refresh: true,
    });
    w.service.reviews.clear();
    resume?.();
    await expect(pending).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(w.store.resources("review", Review)).toHaveLength(0);
  });
});

it("serves review routes and coalesces identical HTTP summary requests", async () => {
  const store = new Store(":memory:");
  store.insertSnapshot(originalSnapshot);
  const transport = vi.fn<Transport>(async () => response(summaryOutput));
  const origin = "http://127.0.0.1:4317",
    runtime = createApp({ store, origin, transport, reviewDriver: driver() });
  callbacks.push(() => {
    void runtime.close();
    store.close();
  });
  const config = runtime.service.models.update({
    expectedRevision: 1,
    content: {
      ...runtime.service.models.settings().content,
      reviewsEnabled: true,
      llmEnabled: true,
      endpoints: [
        {
          id: null,
          label: "Test",
          baseUrl: "https://example.com",
          model: "test",
        },
      ],
    },
  });
  const endpoint = config.content.endpoints[0];
  if (!endpoint) throw new Error("Missing endpoint");
  runtime.service.models.credential(endpoint.id, "synthetic-key");
  const call = async (
    name: OperationId,
    body: unknown,
    key = "test-request",
  ) => {
    const route = api[name];
    const response = await runtime.app.request(origin + route.path, {
      method: route.method,
      headers: {
        Host: "127.0.0.1:4317",
        Origin: origin,
        "X-Local-Token": runtime.service.token,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const found = await call("lookupReviewMatch", input);
  expect(found.status).toBe(200);
  const match = TeacherMatch.parse(found.data);
  const fetched = await call("fetchReview", {
    snapshotId: input.snapshotId,
    sourceId: input.sourceId,
    courseId: "math",
    matchId: match.id,
    matchRevision: match.revision,
    refresh: false,
  });
  const review = Review.parse(fetched.data.review);
  const body = {
    reviewId: review.id,
    expectedReviewRevision: review.revision,
    endpointId: endpoint.id,
  };
  const replies = await Promise.all([
    call("summarizeComments", body),
    call("summarizeComments", body),
  ]);
  expect(replies.every((r) => r.status === 200)).toBe(true);
  expect(replies[0]?.data).toEqual(replies[1]?.data);
  expect(transport).toHaveBeenCalledTimes(1);
});
