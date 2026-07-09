import { defineConfig } from "vitest/config";

// contract / domain / server 三层测试在 Node 环境运行（docs/05 §1–§3）。
// E2E 用 Playwright（playwright.config.ts），不进 Vitest。
// 客户端组件测试后续如需引入 jsdom/browser mode，必须先按 docs/07 §6 走依赖决策。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{contract,domain,server}/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
