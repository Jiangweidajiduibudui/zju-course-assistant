import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: ".local/test-results/local",
  testDir: "tests/local",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4318",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm build && node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
    timeout: 60000,
  },
  fullyParallel: false,
  workers: 1,
});
