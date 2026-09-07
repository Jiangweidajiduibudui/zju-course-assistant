import { expect, test } from "@playwright/test";
import { originalSnapshot } from "../../fixtures/ui/catalog.js";
import { CONTRACT_VERSION } from "../../src/shared/contracts/common.js";
import { Review, TeacherMatch } from "../../src/shared/contracts/reviews.js";

test("review UI requires identity confirmation and a manual summary trigger, then reuses cached output", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("zju-course-assistant:welcome:v2", "acknowledged"),
  );
  const meta = {
    contractVersion: CONTRACT_VERSION,
    requestId: "synthetic-ui",
    servedAt: "2026-09-07T00:00:00Z",
  };
  const source = {
    provider: "chalaoshi",
    url: "https://example.com/teacher/1/",
    observedAt: "2026-09-07T00:00:00Z",
  };
  const official = originalSnapshot.sections
    .flatMap((s) => (s.teachers.state === "known" ? s.teachers.value : []))
    .find((t) => t.id === "teacher-math-a");
  if (!official) throw new Error("Missing synthetic teacher");
  const candidate = { ...official, id: "1", source };
  let matched = false,
    generated = 0,
    fetched = 0;
  const match = () =>
    TeacherMatch.parse({
      id: "ui-match",
      revision: matched ? 2 : 1,
      officialTeacher: official,
      snapshotId: originalSnapshot.meta.id,
      sourceId: "primary",
      sourceBaseUrl: "https://example.com/",
      state: matched
        ? { status: "matched", teacher: candidate, method: "user_confirmed" }
        : { status: "needs_confirmation", candidates: [candidate] },
    });
  const review = Review.parse({
    id: "ui-review",
    revision: 1,
    courseId: "math",
    matchId: "ui-match",
    matchRevision: 2,
    sourceId: "primary",
    source,
    fetchedAt: source.observedAt,
    synthetic: true,
    cacheState: "fresh",
    lastFetchError: null,
    teacherRating: {
      state: "unknown",
      reason: "not_verified",
      displayText: "4.6",
    },
    courseGrades: [],
    courseGradeMatch: { status: "unmatched", reason: "Synthetic no grade" },
    availableCommentCount: { state: "known", value: 2 },
  });
  let endpointId = "",
    endpointRevision = 1;
  const summary = () => ({
    id: "ui-summary",
    reviewId: review.id,
    reviewRevision: 1,
    endpointId,
    endpointRevision,
    generatedAt: source.observedAt,
    contentHash: "a".repeat(64),
    output: {
      pros: ["讲解细致（合成评价）"],
      cons: ["练习量较大（合成评价）"],
      attendance: {
        status: "reported",
        text: "有评论提到偶尔点名（合成评价）。",
      },
      sampleSize: 2,
      lowSample: true,
    },
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { meta, data } });
    if (path === "/api/review-matches") return ok(match());
    if (path === "/api/review-matches/ui-match") {
      matched = true;
      return ok(match());
    }
    if (path === "/api/reviews/fetch") {
      fetched++;
      return ok({ status: "available", review });
    }
    if (path === "/api/reviews/ui-review/summary") {
      if (generated) return ok(summary());
      return route.fulfill({
        status: 404,
        json: {
          meta,
          error: {
            code: "NOT_FOUND",
            message: "No synthetic summary",
            retryable: false,
            fields: [],
          },
        },
      });
    }
    if (path === "/api/llm/summarize") {
      generated++;
      return ok(summary());
    }
    return route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page
    .getByLabel("API key", { exact: true })
    .fill("synthetic-ui-test-key");
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "已保存并启用",
  );
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  const settings = await page.evaluate(
    async () => (await (await fetch("/api/bootstrap")).json()).data.settings,
  );
  endpointId = settings.content.endpoints[0].id;
  endpointRevision = settings.content.endpoints[0].revision;
  await page.getByRole("button", { name: "01 探索课程" }).click();
  await page
    .getByRole("button", { name: "AI 评价摘要", exact: true })
    .first()
    .click();
  const enable = page.getByRole("button", {
    name: "启用外部评价",
    exact: true,
  });
  await expect(enable).toBeVisible();
  await enable.click();
  await expect(
    page.getByRole("heading", { name: "确认对应教师" }),
  ).toBeVisible();
  expect(fetched).toBe(0);
  expect(generated).toBe(0);
  await page.getByRole("button", { name: "选择这位教师", exact: true }).click();
  const generate = page.getByRole("button", {
    name: "生成 AI 摘要",
    exact: true,
  });
  await expect(generate).toBeEnabled();
  expect(generated).toBe(0);
  await generate.click();
  await expect(page.getByLabel("AI 评价摘要结果")).toContainText(
    "讲解细致（合成评价）",
  );
  expect(generated).toBe(1);
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page
    .getByRole("button", { name: "AI 评价摘要", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("AI 评价摘要结果")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "已生成摘要", exact: true }),
  ).toBeDisabled();
  expect(generated).toBe(1);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const { data } = await (await fetch("/api/bootstrap")).json();
    const settings = data.settings;
    await fetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": data.localRequestToken,
      },
      body: JSON.stringify({
        expectedRevision: settings.revision,
        content: {
          ...settings.content,
          reviewsEnabled: false,
          llmEnabled: false,
          endpoints: [],
        },
      }),
    });
  });
});
