import { defineConfig } from "@playwright/test";

// E2E 原则（docs/05 §5.1）：
// - 只用合成 fixture 与 mock chalaoshi，CI 不访问真实上游；
// - 全程网络记录中不得出现任何 zdbk 请求（AC-2.3 / AC-8.2 / G2）；
// - 使用 locator + web-first assertions，禁止固定 sleep（docs/07 §4.7）。
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm dev:api",
      url: "http://127.0.0.1:3000/api/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm dev:web",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
