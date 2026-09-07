import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [stageArg, reportArg] = process.argv.slice(2);
if (!stageArg || !reportArg)
  throw new Error(
    "Usage: bundled-node smoke.mjs <stage> <report outside stage>",
  );
const stage = resolve(stageArg),
  report = resolve(reportArg);
assert.ok(
  !report.startsWith(stage + (process.platform === "win32" ? "\\" : "/")),
  "Keep acceptance reports out of the payload",
);
const build = JSON.parse(
  readFileSync(join(stage, "release-build.json"), "utf8"),
);
assert.equal(process.platform, build.platform);
assert.equal(process.versions.node, build.node);
process.env.PLAYWRIGHT_BROWSERS_PATH = join(stage, "browsers");
const { chromium } = await import(
  pathToFileURL(join(stage, "node_modules/playwright/index.mjs")).href
);
const temporary = mkdtempSync(join(tmpdir(), "zju-release-smoke-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  ZJU_DATA_DIR: join(temporary, "data"),
  ZJU_PORT: String(port),
};
for (const name of [
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "LD_LIBRARY_PATH",
])
  delete env[name];
const child = spawn(
  process.platform === "win32" ? "cmd.exe" : join(stage, "start.sh"),
  process.platform === "win32"
    ? ["/d", "/c", "Start.cmd", "--no-open"]
    : ["--no-open"],
  { cwd: stage, env, stdio: ["ignore", "pipe", "pipe"] },
);
let result;
let context,
  exited = false,
  output = "";
child.on("exit", () => {
  exited = true;
});
child.stdout.on("data", (chunk) => {
  output = (output + chunk).slice(-4000);
});
child.stderr.on("data", (chunk) => {
  output = (output + chunk).slice(-4000);
});
try {
  let boot;
  for (let i = 0; i < 100 && !exited; i++) {
    try {
      const r = await fetch(`${origin}/api/bootstrap`, {
        headers: { Origin: origin },
        signal: AbortSignal.timeout(500),
      });
      if (r.ok) {
        boot = (await r.json()).data;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(boot, "Packaged service did not start");
  assert.equal(resolve(boot.dataDirectory), resolve(env.ZJU_DATA_DIR));
  assert.equal(boot.settings.content.llmEnabled, false);
  assert.equal(boot.settings.content.reviewsEnabled, false);
  assert.equal(boot.settings.content.endpoints.length, 0);
  assert.equal(boot.session.state, "logged_out");
  const terms = await (
    await fetch(`${origin}/api/terms`, {
      headers: { Origin: origin, "X-Local-Token": boot.localRequestToken },
    })
  ).json();
  assert.equal(terms.data.items.length, 0);
  context = await chromium.launchPersistentContext(
    join(temporary, "headed-profile"),
    {
      headless: false,
      executablePath: chromium.executablePath(),
      viewport: { width: 1360, height: 900 },
    },
  );
  const external = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(true);
      return route.abort();
    }
    return route.continue();
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "了解，开始规划", exact: true })
    .click();
  const guide = page.getByRole("region", { name: "新手指引", exact: true });
  await guide.waitFor();
  assert.equal(
    await guide
      .getByRole("button", { name: "下一步", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .locator("[data-tour-highlight]")
      .getAttribute("data-tour-highlight"),
    '[data-tour="school"]',
  );
  await guide.getByRole("button", { name: "稍后再看", exact: true }).click();
  await page
    .getByRole("heading", { name: "还没有计划", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  assert.equal(
    await page.getByLabel("API key", { exact: true }).inputValue(),
    "",
  );
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  await context.close();
  context = undefined;
  result = {
    status: "passed",
    platform: process.platform,
    node: process.versions.node,
    emptyWorkspace: true,
    loggedOut: true,
    modelDisabled: true,
    reviewsDisabled: true,
    headedChromium: true,
    uiRendered: true,
    anchoredOnboarding: true,
    noExternalRequests: true,
    condaNotRequired: true,
    manifestSha256: createHash("sha256")
      .update(readFileSync(join(stage, "FILES.sha256")))
      .digest("hex"),
  };
} catch (error) {
  // The payload is deliberately blank; do not echo arbitrary upstream output.
  console.error(
    JSON.stringify({
      status: "failed",
      platform: process.platform,
      message: error instanceof Error ? error.message : "Smoke failed",
      processExited: exited,
      outputPresent: Boolean(output),
    }),
  );
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  if (!exited) {
    if (process.platform === "win32")
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else child.kill("SIGTERM");
    for (let i = 0; i < 100 && !exited; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!exited) {
    console.error("Release test process did not stop");
    process.exitCode = 1;
  }
  if (exited && existsSync(temporary))
    rmSync(temporary, { recursive: true, maxRetries: 5, retryDelay: 200 });
}

if (result && !process.exitCode) {
  writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
}
