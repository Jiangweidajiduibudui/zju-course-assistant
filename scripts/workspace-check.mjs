import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(
  process.versions.node,
  pkg.engines.node,
  "Use scripts/in-env or activate the project conda environment",
);
assert.ok(process.env.CONDA_PREFIX, "Conda environment must be active");
assert.ok(
  !relative(process.env.CONDA_PREFIX, process.execPath).startsWith(".."),
  "Node must come from conda",
);
assert.equal(
  execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  pkg.engines.pnpm,
);
for (const [name, version] of Object.entries({
  ...pkg.dependencies,
  ...pkg.devDependencies,
})) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: pin an exact release`);
  const installed = JSON.parse(
    readFileSync(join("node_modules", name, "package.json"), "utf8"),
  );
  assert.equal(
    installed.version,
    version,
    `${name}: install from the lockfile`,
  );
}
for (const file of [
  "AGENTS.md",
  "MAINTAINING.md",
  "environment.yml",
  "pnpm-lock.yaml",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".agents/skills/zju-source-verification/SKILL.md",
]) {
  assert.ok(existsSync(file), `Missing workspace artifact: ${file}`);
}
JSON.parse(readFileSync(".codex/hooks.json", "utf8"));
console.log(
  `Workspace toolchain OK: Node ${process.versions.node}, pnpm ${pkg.engines.pnpm}. Application and live-site acceptance are separate.`,
);
