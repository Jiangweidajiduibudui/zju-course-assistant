import { expect, type Page, test } from "@playwright/test";

/**
 * 正式 Demo 主流程 E2E（负责人；docs/08 §3 十六步闭环 + docs/05 §5.1）。
 *
 * CI 原则：只用合成 fixture 与 mock chalaoshi，不访问真实上游。
 * Task 6 前本文件保持 fixme；接入真实页面后逐步点亮。
 */

/** G2 / AC-2.3 / AC-8.2：全程网络记录中不得出现任何 zdbk 请求。 */
function trackZdbkRequests(page: Page): string[] {
  const offenders: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/zdbk\.zju\.edu\.cn|\/jwglxt\//.test(url)) {
      offenders.push(url);
    }
  });
  return offenders;
}

test("Demo mainline 入口：同意后加载合成数据并进入主链路", async ({ page }) => {
  const zdbkRequests = trackZdbkRequests(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /首次使用：隐私声明/ })).toBeVisible();
  await page.getByRole("button", { name: /同意并继续/ }).click();

  await expect(page.getByText("advise-only")).toBeVisible();
  await page.getByRole("button", { name: "加载合成 Demo 数据" }).click();

  await expect(page.getByText("合成演示数据")).toBeVisible();
  await expect(page.getByText("合成微积分演示")).toBeVisible();
  await expect(page.getByText("考试时间缺失")).toBeVisible();
  await expect(page.getByText("学分缺失")).toBeVisible();
  await expect(page.getByText("当前 session 草稿")).toBeVisible();
  await expect(page.getByText("合成 Demo session")).toBeVisible();
  await expect(page.getByText("待选池：3 门课程 / 5 个候选教学班")).toBeVisible();
  await expect(page.getByText("学分上限：未填写")).toBeVisible();

  await page.reload();
  await expect(page.getByText("当前 session 草稿")).toBeVisible();
  await expect(page.getByText("待选池：3 门课程 / 5 个候选教学班")).toBeVisible();

  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: /设置/ })).toBeVisible();
  await expect(page.getByText("当前 session：合成 Demo session")).toBeVisible();
  await page.getByLabel("学分上限").fill("18");
  await page.getByRole("button", { name: "保存学分上限" }).click();
  await expect(page.getByText("已保存学分上限：18")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByText("已保存学分上限：18")).toBeVisible();

  await page.getByRole("button", { name: "导入/导出" }).click();
  await expect(page.getByText("学分上限：18")).toBeVisible();

  await page.getByRole("button", { name: "进入待筛选志愿" }).click();
  await expect(page.getByRole("heading", { name: /待筛选志愿/ })).toBeVisible();
  await expect(page.getByText("尚未生成推荐")).toBeVisible();
  await expect(page.getByText("Session 草稿：合成 Demo session")).toBeVisible();
  await expect(page.getByText("待选池目标：3 门课程")).toBeVisible();
  await expect(page.getByText("候选教学班总数：5")).toBeVisible();
  await expect(page.getByText("生成推荐前置状态")).toBeVisible();
  await expect(
    page.getByText("用户前置已完成；生成推荐暂不可用：等待 selection-model 接入"),
  ).toBeVisible();
  await expect(page.getByText("学分上限已填写：18 学分")).toBeVisible();
  await expect(page.getByText("待选池已准备：3 门课程 / 5 个候选教学班")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成推荐（等待 selection-model）" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "查看预期课表" }).click();
  await expect(page.getByRole("heading", { name: /预期课表/ })).toBeVisible();
  await expect(page.getByText("等待 selection-model 输出")).toBeVisible();

  expect(zdbkRequests).toEqual([]);
});

test.fixme("正式 Demo 十六步闭环（docs/08 §3）", async ({ page }) => {
  const zdbkRequests = trackZdbkRequests(page);
  await page.goto("/");
  // 1. 首次隐私同意（AC-11.1/11.2）
  // 2. 加载内置合成 Demo 数据或导入指定 JSON（AC-2.x）
  // 3. 填写必填学分上限（D38）
  // 4. 浏览课程/教学班/教师评价状态/缺失字段说明（AC-3.x）
  // 5. 教学班入池（AC-4.1）
  // 6. 生成课程志愿组与时间槽志愿组视图（D30、D37）
  // 7. chalaoshi 真实来源与时间 或 seed 演示标记（D41）
  // 8. 配置 OpenAI 兼容端点（同源代理，D40）
  // 9-12. 两阶段 LLM + Top10 + 终校验（D39、D25）
  // 13. 志愿提交方案 + 预期课表投影（docs/08 §8）
  // 14. 手动调整/锁定/重新优化/回滚（AC-7.x）
  // 15. 导出当前 JSON（AC-8.1）
  // 16. 断言无 zdbk 请求：
  expect(zdbkRequests).toEqual([]);
});

test.fixme("降级矩阵：无 key / chalaoshi 不可达 / Schema 失败 / 断网（AC-12.x）", async () => {
  // Task 6：逐情形断言明确 UI 状态，绝不假装成功（FR-12）。
});
