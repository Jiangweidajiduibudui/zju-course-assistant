import { expect, test } from "@playwright/test";

test("first-use disclosure is acknowledged once without enabling services", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      external.push(request.url());
  });
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "欢迎使用选课工作台" });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText("你选择的服务商");
  await expect(welcome).toContainText("不保证录取");
  await page.keyboard.press("Escape");
  await expect(welcome).toBeVisible();
  await page.getByRole("button", { name: "了解，开始规划" }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "秋冬 · 主计划", exact: true }),
  ).toBeVisible();
  await expect(welcome).toHaveCount(0);
  await expect(page.getByText("合成数据", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/不保证录取|不代表录取概率|本机 SQLite|修订 \d/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "AI 解释课表 · 即将支持" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(external).toEqual([]);
});

test("blocked browser storage still allows acknowledgement for this visit", async ({
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
  await expect(
    page.getByRole("dialog", { name: "欢迎使用选课工作台" }),
  ).toHaveCount(0);
});
