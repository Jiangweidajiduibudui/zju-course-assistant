import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { LocalArchive } from "../../src/shared/contracts/operations.js";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("zju-course-assistant:welcome:v2", "acknowledged");
  });
});

test("HTTP workbench persists preferences, guides model setup, and round-trips additive archives", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (new URL(r.url()).hostname !== "127.0.0.1") external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "秋冬 · 主计划", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("合成数据", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("HTTP 持久化计划");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByRole("button", { name: "我的偏好", exact: true }).click();
  await page
    .getByRole("button", { name: "＋ 候选顺序优先", exact: true })
    .click();
  await page
    .getByLabel("自然语言偏好", { exact: true })
    .fill("尽量集中上课，无额外硬约束");
  await page.getByRole("checkbox", { name: /我已确认上方硬约束/ }).check();
  await page.getByRole("button", { name: "确认并保存偏好" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "HTTP 持久化计划", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "02 候选清单" }).click();
  await page.getByRole("button", { name: "我的偏好", exact: true }).click();
  await expect(page.getByLabel("自然语言偏好", { exact: true })).toHaveValue(
    "尽量集中上课，无额外硬约束",
  );
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByRole("button", { name: "AI 帮我排", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "模型设置" })).toBeVisible();
  await expect(page.getByLabel("模型接口地址")).toHaveValue(
    "https://api.deepseek.com",
  );
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue(
    "deepseek-v4-flash",
  );
  await page
    .getByLabel("API key", { exact: true })
    .fill("synthetic-local-test-key");
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "模型设置" }).getByRole("status"),
  ).toContainText("已保存并启用");
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue(
    "deepseek-v4-flash",
  );
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute(
    "placeholder",
    /已配置/,
  );
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((k) =>
        k.startsWith("zju-course-assistant:synthetic-ui"),
      ),
    ),
  ).toBe(false);
  await page.getByText("本机数据与备份", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部规划备份" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Missing backup");
  const archive = LocalArchive.parse(JSON.parse(await readFile(path, "utf8")));
  expect(archive.schemaVersion).toBe(2);
  expect(JSON.stringify(archive)).not.toContain("synthetic-local-test-key");
  expect(archive.plans[0]?.content.name).toBe("HTTP 持久化计划");
  expect(archive.snapshots[0]?.meta.schemaVersion).toBe(1);
  await page.getByLabel("导入归档（JSON）").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await expect(
    page.getByRole("dialog", { name: "确认导入归档" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "我的计划" }).getByRole("button"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "确认添加为新计划" }).click();
  await expect(
    page.getByRole("navigation", { name: "我的计划" }).getByRole("button"),
  ).toHaveCount(2);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile model settings reject a console URL before sending credentials", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "模型设置" });
  await page.getByLabel("模型接口地址").fill("https://platform.deepseek.com");
  await page
    .getByLabel("API key", { exact: true })
    .fill("synthetic-key-never-sent");
  const credentials: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/credential") && r.method() === "PUT")
      credentials.push(r.url());
  });
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("控制台地址");
  expect(credentials).toHaveLength(0);
  await page.getByRole("button", { name: "使用 DeepSeek 官方配置" }).click();
  await expect(page.getByLabel("模型接口地址")).toHaveValue(
    "https://api.deepseek.com",
  );
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "连接教务", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "教务连接与同步" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "同步当前学期", exact: true }),
  ).toBeDisabled();
});
