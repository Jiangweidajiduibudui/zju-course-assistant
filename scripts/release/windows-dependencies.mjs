import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "win32")
  throw new Error("Run this helper with the pinned Windows Node distribution.");
const [stageArg, toolsArg] = process.argv.slice(2);
if (!stageArg || !toolsArg)
  throw new Error(
    "Usage: windows-dependencies.mjs <stage> <private build tools directory>",
  );
const stage = resolve(stageArg),
  tools = resolve(toolsArg);
const pkg = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
if (process.versions.node !== pkg.engines.node)
  throw new Error("Wrong Node version");
mkdirSync(tools, { recursive: true });
writeFileSync(join(tools, "empty.npmrc"), "");
const env = {
  ...process.env,
  PATH: `${dirname(process.execPath)};${process.env.PATH}`,
  npm_config_cache: join(tools, "npm-cache"),
  npm_config_userconfig: join(tools, "empty.npmrc"),
  npm_config_registry: "https://registry.npmjs.org",
  PLAYWRIGHT_BROWSERS_PATH: join(stage, "browsers"),
};
const run = (args, cwd) =>
  execFileSync(process.execPath, args, { cwd, env, stdio: "inherit" });
run(
  [
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    "install",
    "--prefix",
    tools,
    `pnpm@${pkg.engines.pnpm}`,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  tools,
);
run(
  [
    join(tools, "node_modules/pnpm/bin/pnpm.cjs"),
    "install",
    "--prod",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--store-dir",
    join(tools, "pnpm-store"),
  ],
  stage,
);
// better-sqlite3 13 ships the N-API prebuild; no compiler or Python is required.
run(
  [
    join(stage, "node_modules/playwright/cli.js"),
    "install",
    "chromium",
    "--no-shell",
  ],
  stage,
);
mkdirSync(join(stage, "runtime"), { recursive: true });
cpSync(process.execPath, join(stage, "runtime/node.exe"));
cpSync(
  join(dirname(process.execPath), "LICENSE"),
  join(stage, "runtime/LICENSE"),
);
console.log("Pinned production dependencies and bundled browser are ready.");
