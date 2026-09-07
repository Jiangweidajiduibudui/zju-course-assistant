import { expect, test } from "@playwright/test";

test("first-use tour follows real controls without enabling services or changing plans", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      external.push(request.url());
  });
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "欢迎使用选课工作台" });
  await expect(welcome).toContainText("你选择的服务商");
  await expect(welcome).toContainText("不保证录取");
  await page.keyboard.press("Escape");
  await expect(welcome).toBeVisible();
  await page.getByRole("button", { name: "了解，开始规划" }).click();
  await expect(welcome).toHaveCount(0);
  const guide = page.getByRole("region", { name: "新手指引", exact: true });
  await expect(guide).toContainText("新建一份计划");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-tour-highlight]")).toHaveAttribute(
    "data-tour-highlight",
    '[data-tour="new-plan"]',
  );
  await expect(guide.getByRole("button", { name: "上一步" })).toBeDisabled();
  await guide.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("搜索课程、代码或教师")).toBeVisible();
  await expect(page.locator("[data-tour-highlight]")).toHaveAttribute(
    "data-tour-highlight",
    '[data-tour="search"]',
  );
  await guide.getByRole("button", { name: "上一步" }).click();
  const targets = [];
  for (let step = 0; step < 7; step++) {
    await expect(guide).toContainText(`第 ${step + 1} 步 / 7`);
    targets.push(
      await page
        .locator("[data-tour-highlight]")
        .getAttribute("data-tour-highlight"),
    );
    await guide
      .getByRole("button", { name: step === 6 ? "完成指引" : "下一步" })
      .click();
  }
  expect(new Set(targets).size).toBe(7);
  await expect(guide).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新手指引", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(guide).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "秋冬 · 主计划", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("合成数据", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test("tour leaves real dialogs and highlighted inputs usable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "了解，开始规划" }).click();
  const guide = page.getByRole("region", { name: "新手指引", exact: true });
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "新建计划", exact: true }),
  ).toBeVisible();
  await expect(guide).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(guide).toContainText("新建一份计划");
  await guide.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("搜索课程、代码或教师").fill("不存在的课程");
  await guide.getByRole("button", { name: "下一步" }).click();
  await expect(page.locator("[data-tour-highlight]")).toHaveAttribute(
    "data-tour-highlight",
    '[data-tour="search"]',
  );
  await page.getByLabel("搜索课程、代码或教师").fill("");
  await expect(page.locator("[data-tour-highlight]")).toHaveAttribute(
    "data-tour-highlight",
    '[data-tour="add-candidate"]:not(:disabled)',
  );
  const button = page
    .locator('[data-tour="add-candidate"]:not(:disabled)')
    .first();
  const chosen = page.getByRole("button", { name: "✓ 已在候选", exact: true });
  const before = await chosen.count();
  await button.click();
  await expect(chosen).toHaveCount(before + 1);
  await guide.getByRole("button", { name: "下一步" }).click();
  await expect(
    page.getByRole("button", { name: "02 候选清单" }),
  ).toHaveAttribute("aria-current", "step");
  await expect(guide).toContainText("调整你的候选顺序");
});

test("blocked browser storage still allows exiting and reopening the tour", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "了解，开始规划" }).click();
  await page.getByRole("button", { name: "稍后再看" }).click();
  const guide = page.getByRole("region", { name: "新手指引", exact: true });
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "新手指引", exact: true }).click();
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
});

test("each narrow-screen hint stays visible beside its highlighted control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "了解，开始规划" }).click();
  const guide = page.getByRole("region", { name: "新手指引", exact: true });
  for (let step = 0; step < 7; step++) {
    await expect(guide).toContainText(`第 ${step + 1} 步 / 7`);
    await expect
      .poll(async () => {
        const hint = await guide.boundingBox();
        const target = await page
          .locator("[data-tour-highlight]")
          .boundingBox();
        return (
          !!hint &&
          !!target &&
          hint.x >= 0 &&
          hint.y >= 0 &&
          hint.x + hint.width <= 390 &&
          hint.y + hint.height <= 844 &&
          (hint.y >= target.y + target.height ||
            hint.y + hint.height <= target.y ||
            hint.x >= target.x + target.width ||
            hint.x + hint.width <= target.x)
        );
      })
      .toBe(true);
    await expect(
      guide.getByRole("button", { name: step === 6 ? "完成指引" : "下一步" }),
    ).toBeInViewport();
    await guide
      .getByRole("button", { name: step === 6 ? "完成指引" : "下一步" })
      .click();
  }
  await page.reload();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "新手指引", exact: true }).click();
  await expect(guide).toContainText("第 1 步 / 7");
});

test("empty plans wait for actual creation before showing the course controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "zju-course-assistant:synthetic-ui:v2",
      JSON.stringify({ version: 2, published: false, plans: [] }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "了解，开始规划" }).click();
  const guide = page.getByRole("region", { name: "新手指引", exact: true });
  await expect(guide.getByRole("button", { name: "下一步" })).toBeDisabled();
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("指引合成计划");
  await page.getByRole("button", { name: "创建计划", exact: true }).click();
  await expect(guide.getByRole("button", { name: "下一步" })).toBeEnabled();
  await guide.getByRole("button", { name: "下一步" }).click();
  await expect(page.locator("[data-tour-highlight]")).toHaveAttribute(
    "data-tour-highlight",
    '[data-tour="search"]',
  );
  await page.getByRole("button", { name: "03 志愿草稿" }).click();
  await expect(guide).toContainText("这一步的区域暂未显示");
  await guide.getByRole("button", { name: "回到这一步" }).click();
  await expect(page.locator("[data-tour-highlight]")).toHaveAttribute(
    "data-tour-highlight",
    '[data-tour="search"]',
  );
});
