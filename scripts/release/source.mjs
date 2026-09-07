import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const name = `${pkg.name}-${pkg.version}-source`;
mkdirSync(".local", { recursive: true });
mkdirSync("releases", { recursive: true });
const work = mkdtempSync(resolve(".local/source-package-"));
const stage = join(work, name);
mkdirSync(stage);
// Read the current working tree, never HEAD or the index (the old app is staged for deletion).
const entries = [
  "src",
  "tests",
  "fixtures",
  "scripts",
  ".agents",
  ".codex",
  ".githooks",
  "docs/api/openapi.json",
  ".gitignore",
  ".npmrc",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "MAINTAINING.md",
  "RELEASE_NOTES.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "environment.yml",
  "conda-linux-64.lock",
  "biome.json",
  "tsconfig.contracts.json",
  "tsconfig.server.json",
  "tsconfig.build.json",
  "tsconfig.ui.json",
  "vite.config.ts",
  "vitest.contracts.config.ts",
  "vitest.domain.config.ts",
  "vitest.server.config.ts",
  "playwright.ui.config.ts",
  "playwright.local.config.ts",
];
const forbidden =
  /(^|\/)(?:\.git|\.local|\.data|node_modules|dist|runtime|releases|backup|test-results|playwright-report)(?:\/|$)|\.(?:sqlite3?|db|har|trace|log)(?:[.-]|$)|(^|\/)\.env(?:\.|$)/i;
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
try {
  for (const entry of entries) {
    if (!existsSync(entry))
      throw new Error(`Missing source release file: ${entry}`);
    const files = lstatSync(entry).isDirectory() ? walk(entry) : [entry];
    for (const file of files) {
      if (forbidden.test(file) || lstatSync(file).isSymbolicLink())
        throw new Error(`Disallowed source file: ${file}`);
      const text = readFileSync(file, "utf8");
      if (/sk-[A-Za-z0-9_-]{24,}|(?:Bearer\s+)[A-Za-z0-9._-]{40,}/.test(text))
        throw new Error(`Potential credential in source file: ${file}`);
    }
    cpSync(entry, join(stage, entry), { recursive: true });
  }
  const archive = resolve("releases", `${name}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", work, name]);
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
  console.log(
    JSON.stringify({
      archive: `releases/${name}.tar.gz`,
      files: walk(stage).length,
      sha256: digest,
    }),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
