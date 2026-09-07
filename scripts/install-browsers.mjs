import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// MCP may require a different Chromium revision than the stable test runner.
const resolvers = [
  createRequire(import.meta.resolve("@playwright/test")),
  createRequire(import.meta.resolve("@playwright/mcp")),
];
const commands = new Set(
  resolvers.map((resolve) =>
    join(dirname(resolve.resolve("playwright/package.json")), "cli.js"),
  ),
);
for (const cli of commands) {
  const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
