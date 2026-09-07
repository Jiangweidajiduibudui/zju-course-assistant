import { expect, test } from "@playwright/test";
import { originalSnapshot } from "../../fixtures/ui/catalog.js";
import { FixtureWorkspace, STORAGE_KEY } from "../../fixtures/ui/workspace.js";
import { demandRatio } from "../../src/client/components/DemandRatio.js";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("zju-course-assistant:welcome:v2", "acknowledged");
  });
});

test("touch dragging reorders within a course", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    await context.addInitScript(() => {
      localStorage.setItem("zju-course-assistant:welcome:v2", "acknowledged");
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5173/");
    await page.getByRole("button", { name: "02 候选清单" }).click();
    const handle = page.getByRole("button", {
      name: "拖动排序：示例教师丙",
      exact: true,
    });
    await expect(handle).toBeEnabled();
    await handle.scrollIntoViewIfNeeded();
    const source = await handle.boundingBox();
    const target = await page
      .getByRole("article", { name: "示例教师甲候选项", exact: true })
      .boundingBox();
    if (!source || !target) throw new Error("Missing touch targets");
    const cdp = await context.newCDPSession(page);
    const from = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const to = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [from],
    });
    for (let step = 1; step <= 10; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 10,
            y: from.y + ((to.y - from.y) * step) / 10,
          },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      page.getByRole("article", { name: "示例教师丙候选项", exact: true }),
    ).toHaveAttribute("data-sort-rank", "0");
  } finally {
    await context.close();
  }
});

test("demand ratio uses all pending and total remaining, with explicit zero and missing states", async ({
  page,
}) => {
  const section = originalSnapshot.sections.find((row) => row.id === "math-a");
  if (!section) throw new Error("Missing scenario");
  expect(demandRatio(section)).toBe("3.00 : 1");
  expect(
    demandRatio({
      ...section,
      pending: {
        major: { state: "known", value: 999 },
        all: { state: "known", value: 0 },
      },
    }),
  ).toBe("0.00 : 1");
  expect(
    demandRatio({
      ...section,
      pending: {
        ...section.pending,
        all: { state: "unknown", reason: "not_verified" },
      },
    }),
  ).toBe("未知");
  expect(
    demandRatio({
      ...section,
      quotas: {
        ...section.quotas,
        overall: {
          ...section.quotas.overall,
          remaining: { state: "known", value: 0 },
        },
      },
    }),
  ).toBe("无余量");
  await page.goto("/");
  const card = page.getByRole("article", {
    name: "微积分基础 示例教师甲",
    exact: true,
  });
  await expect(card.locator(".demand-ratio")).toContainText("3.00 : 1");
  await expect(
    card.getByRole("button", { name: "AI 评价摘要" }),
  ).toBeDisabled();
  await expect(page.getByText("男 / 女余量", { exact: true })).toHaveCount(0);
  await expect(page.getByText("录取风险", { exact: true })).toHaveCount(0);
  await expect(
    card.getByText("全部报名人数（待定）", { exact: true }),
  ).toHaveCount(0);
  await expect(card.locator(".demand-ratio")).toHaveText("报录比3.00 : 1");
});

test("term-part projection includes later weeks and has no week selector", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "周次", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "搜索课程、代码或教师" })
    .fill("设计与生活");
  await page.locator(".course-card > summary").click();
  await page
    .getByRole("article", { name: "设计与生活 示例教师庚", exact: true })
    .getByRole("button", { name: "＋ 设为候选" })
    .click();
  await expect(
    page.locator(".calendar-event.primary").filter({ hasText: "设计与生活" }),
  ).toBeVisible();
  await page.getByLabel("学期段", { exact: true }).selectOption("winter");
  await expect(page.getByText("当前学期段没有课表项。")).toBeVisible();
});

test("drag handles support keyboard insertion while preserving intervening candidates", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("article", { name: "微积分基础 示例教师丁", exact: true })
    .getByRole("button", { name: "＋ 设为候选" })
    .click();
  await page.getByRole("button", { name: "02 候选清单" }).click();
  const handle = page.getByRole("button", {
    name: "拖动排序：示例教师丁",
    exact: true,
  });
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("article", { name: "示例教师丁候选项", exact: true }),
  ).toHaveAttribute("data-sort-rank", "0");
  await expect(
    page.getByRole("article", { name: "示例教师甲候选项", exact: true }),
  ).toHaveAttribute("data-sort-rank", "1");
  await expect(
    page.getByRole("article", { name: "示例教师丙候选项", exact: true }),
  ).toHaveAttribute("data-sort-rank", "2");
  await expect(
    page.getByRole("button", { name: /示例教师.*上移/ }),
  ).toHaveCount(0);
});

test("candidate order redraws primary projection, preserves baseline and survives reload", async ({
  page,
}) => {
  const outbound: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      outbound.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "秋冬 · 主计划", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".credit-summary strong")).toHaveText("8 / 18");
  await expect(
    page.getByRole("button", { name: /1 处首选时间重叠/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "02 候选清单" }).click();
  const handle = page.getByRole("button", {
    name: "拖动排序：示例教师丙",
    exact: true,
  });
  const target = page.getByRole("article", {
    name: "示例教师甲候选项",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Drag targets missing");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("article", { name: "示例教师丙候选项", exact: true }),
  ).toHaveAttribute("data-sort-rank", "0");
  await expect(page.getByRole("button", { name: /首选时间重叠/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".calendar-event.primary")).toHaveCount(2);
  await page.getByLabel("显示备选").check();
  await expect(page.locator(".calendar-event.alternative")).toHaveCount(1);
  await expect(page.locator(".credit-summary strong")).toHaveText("8 / 18");
  await page.reload();
  await expect(page.getByTestId("plan-stamp")).toHaveAttribute(
    "data-revision",
    "2",
  );
  await expect(page.locator(".calendar-event.baseline")).toContainText(
    "体育基础",
  );
  expect(outbound).toEqual([]);
});

test("retains a fourth preference and unknown fields without enabling executable export", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("article", { name: "微积分基础 示例教师乙", exact: true })
    .getByRole("button", { name: "＋ 设为候选" })
    .click();
  await page
    .getByRole("article", { name: "微积分基础 示例教师丁", exact: true })
    .getByRole("button", { name: "＋ 设为候选" })
    .click();
  await page.getByRole("button", { name: "03 志愿草稿" }).click();
  await expect(page.locator(".draft tbody tr")).toHaveCount(5);
  await expect(page.getByText(/同课程候选超过 3 个/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "导出填写清单" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /AI 比较组合/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "01 探索课程" }).click();
  await page
    .getByRole("textbox", { name: "搜索课程、代码或教师" })
    .fill("学术写作");
  const course = page.locator(".course-card");
  await course.locator(":scope > summary").click();
  await expect(course.locator(".section-grid")).toContainText("—");
  await page.getByLabel("仅显示学校标示可选").check();
  await expect(course.locator(".section-grid")).toContainText("—");
});

test("reconciliation needs exact acknowledgement and preserves removed notes and the copied plan", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "复制计划", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("备用方案");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "备用方案", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "我的计划" })
    .getByRole("button", { name: "秋冬 · 主计划", exact: true })
    .click();
  await page.getByRole("button", { name: "↻ 模拟同步更新" }).click();
  await page.getByRole("button", { name: "查看对账" }).click();
  await expect(
    page.getByRole("button", { name: "确认 0/3 项并更新计划" }),
  ).toBeDisabled();
  await page.getByRole("dialog").getByRole("checkbox").nth(0).check();
  await expect(
    page.getByRole("button", { name: "确认 1/3 项并更新计划" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.getByTestId("plan-stamp")).toHaveAttribute(
    "data-snapshot",
    "snapshot-demo-1",
  );
  await page.getByRole("button", { name: "查看对账" }).click();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(3);
  for (const checkbox of await page
    .getByRole("dialog")
    .getByRole("checkbox")
    .all())
    await checkbox.check();
  await page.getByRole("button", { name: "确认 3/3 项并更新计划" }).click();
  await expect(page.getByTestId("plan-stamp")).toHaveAttribute(
    "data-snapshot",
    "snapshot-demo-2",
  );
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByText("对账历史 · 1 项").click();
  await expect(
    page.getByText("教学班取消 · 保留原笔记：作为时间备选"),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "示例教师丙候选项" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "我的计划" })
    .getByRole("button", { name: /备用方案/ })
    .click();
  await expect(page.getByTestId("plan-stamp")).toHaveAttribute(
    "data-snapshot",
    "snapshot-demo-1",
  );
  await expect(
    page.getByRole("article", { name: "示例教师丙候选项" }),
  ).toBeVisible();
});

test("empty plans, notes, favorites and deletion are isolated", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("空白试验");
  await page.getByRole("button", { name: "创建计划", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "空白试验", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".credit-summary strong")).toHaveText("1 / 18");
  const section = page.getByRole("article", {
    name: "微积分基础 示例教师甲",
    exact: true,
  });
  await section.getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByLabel("教学班笔记").fill("只做参考，不作为志愿");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await section
    .getByRole("button", { name: "示例教师甲收藏", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "示例教师甲取消收藏", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await expect(page.getByText("只做参考，不作为志愿")).toBeVisible();
  await expect(page.getByText("仅供参考", { exact: true })).toBeVisible();
  await expect(page.locator(".credit-summary strong")).toHaveText("1 / 18");
  await page.getByRole("button", { name: "删除当前计划" }).click();
  await page.getByRole("button", { name: "确认删除计划" }).click();
  await expect(
    page.getByRole("heading", { name: "秋冬 · 主计划", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("只做参考，不作为志愿")).toHaveCount(0);
});

test("load failures recover without deleting plans; credit limit changes keep the draft reviewable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("演示工具", { exact: true }).click();
  await page.getByRole("button", { name: "模拟加载失败" }).click();
  await expect(page.getByRole("alert")).toContainText("演示加载失败");
  await page.getByRole("button", { name: "重试加载", exact: true }).click();
  await page.getByRole("button", { name: "学分上限", exact: true }).click();
  await page.getByRole("spinbutton").fill("6");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".credit-summary strong")).toHaveText("8 / 6");
  await page.getByRole("button", { name: "03 志愿草稿" }).click();
  await expect(page.getByText(/超过上限 6/)).toBeVisible();
});

test("mobile layout, keyboard dialog and empty winter projection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "课表投影" })).toBeVisible();
  await page.getByLabel("学期段", { exact: true }).selectOption("winter");
  await expect(page.getByText("当前学期段没有课表项。")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

test("adapter rejects stale revisions and incomplete/cross-plan reconciliation", async () => {
  const db = new FixtureWorkspace(storage(), 0);
  const view = await db.getPlan("plan-main");
  await db.publish();
  const preview = await db.previewReconciliation(view.plan.id, {
    expectedRevision: 1,
    targetSnapshotId: db.nextSnapshotId,
  });
  await expect(
    db.applyReconciliation(view.plan.id, preview.id, {
      expectedRevision: 1,
      acknowledgedChangeIds: [preview.changes[0]?.id ?? "missing"],
    }),
  ).rejects.toThrow();
  expect((await db.getPlan(view.plan.id)).plan.snapshotId).toBe(
    db.initialSnapshotId,
  );
  const copy = await db.createPlan({
    mode: "copy",
    source: { planId: view.plan.id, expectedRevision: 1 },
    name: "Independent copy",
  });
  await expect(
    db.applyReconciliation(copy.plan.id, preview.id, {
      expectedRevision: 1,
      acknowledgedChangeIds: preview.changes.map((change) => change.id),
    }),
  ).rejects.toThrow();
  await db.updatePlan(view.plan.id, {
    expectedRevision: 1,
    content: { ...view.plan.content, name: "Newer revision" },
  });
  await expect(
    db.updatePlan(view.plan.id, {
      expectedRevision: 1,
      content: view.plan.content,
    }),
  ).rejects.toThrow(/版本已变化/);
  await expect(
    db.applyReconciliation(view.plan.id, preview.id, {
      expectedRevision: 1,
      acknowledgedChangeIds: preview.changes.map((change) => change.id),
    }),
  ).rejects.toThrow(/版本已变化/);
});

test("adapter preserves corrupt storage and never silently saves a baseline candidate", async () => {
  const disk = storage();
  disk.setItem(STORAGE_KEY, "corrupt synthetic data");
  const db = new FixtureWorkspace(disk, 0);
  await expect(db.listPlans()).rejects.toThrow(/未被覆盖/);
  expect(disk.getItem(STORAGE_KEY)).toBe("corrupt synthetic data");
  db.reset();
  const view = await db.getPlan("plan-main");
  view.plan.content.shortlist.push({
    courseId: "sport",
    favorite: false,
    note: "",
    items: [
      {
        sectionId: "sport-a",
        disposition: "candidate",
        favorite: false,
        note: "",
      },
    ],
  });
  await expect(
    db.updatePlan("plan-main", {
      expectedRevision: 1,
      content: view.plan.content,
    }),
  ).rejects.toThrow(/基线/);
  expect((await db.getPlan("plan-main")).plan.revision).toBe(1);
});

test("preference order and natural text require confirmation, then preview and copy a synthetic timetable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByRole("button", { name: "我的偏好", exact: true }).click();
  await page
    .getByRole("button", { name: "＋ 候选顺序优先", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 尽量保留上午", exact: true })
    .click();
  await page
    .getByRole("button", { name: "拖动排序：尽量保留上午", exact: true })
    .focus();
  await page.keyboard.press("Home");
  await page
    .getByLabel("自然语言偏好", { exact: true })
    .fill("尽量保留上午，不要上课重叠");
  await page.getByRole("button", { name: "解析偏好", exact: true }).click();
  await expect(page.getByText(/固定的合成解析示例/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认并保存偏好" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "添加建议：不允许教学时间重叠", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /我已确认上方硬约束/ }).check();
  await page.getByRole("button", { name: "确认并保存偏好" }).click();
  await page.getByRole("button", { name: "AI 帮我排", exact: true }).click();
  await expect(
    page.getByText("正在生成课表建议…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "合成方案预览" }),
  ).toBeVisible();
  await page.getByText("展开建议课表与完整草稿校验", { exact: true }).click();
  await expect(
    page.locator(".proposal-preview .calendar-event.primary"),
  ).toHaveCount(2);
  await expect(page.getByText(/完整志愿草稿：仍有/)).toBeVisible();
  await page
    .getByRole("button", { name: "另存为 AI 备选计划", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "秋冬 · 主计划 · AI 备选", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "示例教师丙候选项", exact: true }),
  ).toHaveAttribute("data-sort-rank", "0");
  await page
    .getByRole("navigation", { name: "我的计划" })
    .getByRole("button", { name: "秋冬 · 主计划", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "示例教师甲候选项", exact: true }),
  ).toHaveAttribute("data-sort-rank", "0");
  await page.reload();
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByRole("button", { name: "我的偏好", exact: true }).click();
  await expect(page.getByLabel("自然语言偏好", { exact: true })).toHaveValue(
    "尽量保留上午，不要上课重叠",
  );
  await expect(
    page.locator(".preference-order [data-sort-rank='0']"),
  ).toContainText("尽量保留上午");
});

test("cancel and retry leave the plan untouched; later edits invalidate displayed proposals", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByRole("button", { name: "AI 帮我排", exact: true }).click();
  await page.getByRole("button", { name: "取消排课", exact: true }).click();
  await expect(page.getByText("排课已取消，原计划未改变。")).toBeVisible();
  await expect(page.getByTestId("plan-stamp")).toHaveAttribute(
    "data-revision",
    "1",
  );
  await page.getByRole("button", { name: "重试排课" }).click();
  await expect(
    page.getByRole("button", { name: "另存为 AI 备选计划" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "学分上限", exact: true }).click();
  await page.getByRole("spinbutton").fill("1");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(/旧方案已失效/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "另存为 AI 备选计划" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "重试排课" }).click();
  await expect(
    page.getByRole("button", { name: "另存为 AI 备选计划" }),
  ).toBeDisabled();
  await expect(page.locator(".proposal-preview")).toContainText(
    "首选课表校验：未通过",
  );
});

test("unconfirmed hard-rule edits are not activated merely by requesting text interpretation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByRole("button", { name: "我的偏好", exact: true }).click();
  await page
    .getByRole("button", { name: "添加：不允许上课重叠", exact: true })
    .click();
  await page.getByLabel("自然语言偏好", { exact: true }).fill("一点软偏好");
  await page.getByRole("button", { name: "解析偏好", exact: true }).click();
  await expect(page.getByText(/固定的合成解析示例/)).toBeVisible();
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
    STORAGE_KEY,
  );
  expect(stored.plans[0].content.preferences.hardConstraints).toEqual([]);
  expect(stored.plans[0].content.preferences.textConfirmed).toBe(false);
});
