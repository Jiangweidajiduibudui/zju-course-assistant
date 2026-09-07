import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Build this package on x86-64 Linux/WSL2.");
const [stageArg, toolsArg] = process.argv.slice(2);
if (!stageArg || !toolsArg)
  throw new Error(
    "Usage: linux-dependencies.mjs <stage> <private build tools directory>",
  );
const stage = resolve(stageArg),
  tools = resolve(toolsArg);
const pkg = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
if (process.versions.node !== pkg.engines.node)
  throw new Error("Use the pinned development Node.");
mkdirSync(tools, { recursive: true });
const filename = `node-v${pkg.engines.node}-linux-x64.tar.xz`;
const expected =
  "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307";
if (pkg.engines.node !== "22.23.2")
  throw new Error("Update the reviewed runtime checksum before changing Node.");
const response = await fetch(
  `https://nodejs.org/dist/v${pkg.engines.node}/${filename}`,
);
if (!response.ok)
  throw new Error("Could not obtain the pinned Node distribution");
const content = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(content).digest("hex") !== expected)
  throw new Error("Node distribution checksum mismatch");
writeFileSync(join(tools, filename), content);
execFileSync("tar", ["-xJf", join(tools, filename), "-C", tools]);
mkdirSync(join(stage, "runtime/bin"), { recursive: true });
cpSync(
  join(tools, `node-v${pkg.engines.node}-linux-x64/bin/node`),
  join(stage, "runtime/bin/node"),
);
cpSync(
  join(tools, `node-v${pkg.engines.node}-linux-x64/LICENSE`),
  join(stage, "runtime/LICENSE"),
);
execFileSync(
  "pnpm",
  ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"],
  { cwd: stage, stdio: "inherit" },
);
execFileSync(
  join(stage, "runtime/bin/node"),
  [
    join(stage, "node_modules/playwright/cli.js"),
    "install",
    "chromium",
    "--no-shell",
  ],
  {
    cwd: stage,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(stage, "browsers") },
  },
);
console.log(
  "Pinned production dependencies and bundled Linux browser are ready.",
);
