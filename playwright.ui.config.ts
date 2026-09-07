import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: ".local/test-results/fixture",
  testDir: "tests/ui",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm ui:dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
  fullyParallel: false,
});
