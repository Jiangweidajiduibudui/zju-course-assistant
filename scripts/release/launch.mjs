import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, "browsers");
try {
  const { chromium } = await import("playwright");
  if (!existsSync(chromium.executablePath()))
    throw new Error(
      "Bundled Chromium is missing. Extract the complete archive again.",
    );
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.prepare("SELECT 1").get();
  db.close();
  if (process.argv.includes("--check")) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: chromium.executablePath(),
    });
    await browser.close();
    console.log(
      JSON.stringify({
        status: "ready",
        platform: process.platform,
        node: process.versions.node,
        sqlite: true,
        chromium: true,
      }),
    );
  } else {
    // One service process keeps console shutdown and in-memory credentials in
    // the same lifecycle on both Windows and WSL2.
    const { ready } = await import("./app/scripts/start-server.js");
    const origin = await ready;
    if (!process.argv.includes("--no-open")) {
      if (process.platform === "win32" || process.env.WSL_DISTRO_NAME)
        spawn("cmd.exe", ["/d", "/c", "start", "", origin], {
          stdio: "ignore",
          windowsHide: true,
        }).on("error", () => {});
      else
        spawn("xdg-open", [origin], { stdio: "ignore" }).on("error", () => {});
    }
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Startup check failed.",
  );
  process.exitCode = 1;
}
