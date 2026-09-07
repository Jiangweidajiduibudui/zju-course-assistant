import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.platform, "win32");
const [stageArg, origin, report] = process.argv.slice(2);
assert.ok(stageArg && report && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const stage = resolve(stageArg);
process.env.PLAYWRIGHT_BROWSERS_PATH = join(stage, "browsers");
const { chromium } = await import(
  pathToFileURL(join(stage, "node_modules/playwright/index.mjs")).href
);
const { data } = await (
  await fetch(`${origin}/api/bootstrap`, {
    headers: { Origin: origin },
    signal: AbortSignal.timeout(5000),
  })
).json();
assert.ok(data.dataDirectory.startsWith("/tmp/zju-release-crosshost-"));
assert.equal(data.settings.content.llmEnabled, false);
assert.equal(data.session.state, "logged_out");
const folder = mkdtempSync(join(tmpdir(), "zju-release-crosshost-browser-"));
let context;
try {
  context = await chromium.launchPersistentContext(folder, {
    headless: false,
    executablePath: chromium.executablePath(),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(origin);
  await page
    .getByRole("button", { name: "了解，开始规划", exact: true })
    .click();
  await page.getByRole("button", { name: "稍后再看", exact: true }).click();
  await page
    .getByRole("heading", { name: "还没有计划", exact: true })
    .waitFor();
  const result = {
    status: "passed",
    browserPlatform: "win32",
    servicePlatform: "linux",
    windowsBrowserToWslLocalhost: true,
    blankWorkbench: true,
  };
  writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await context?.close();
  rmSync(folder, { recursive: true, maxRetries: 5, retryDelay: 200 });
}
