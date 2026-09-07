import { execFileSync, spawnSync } from "node:child_process";

// Inspect the index, including ignored files added with --force; never restage.
const paths = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const privatePath =
  /(^|\/)(\.local|\.data|node_modules|dist|coverage|backup|runtime|releases|playwright-report|test-results|\.claude)(\/|$)|\.(sqlite3?|db)([-.]|$)|\.har$/i;
const forbidden = paths.filter(
  (path) =>
    privatePath.test(path) ||
    (path.startsWith("docs/") && path !== "docs/api/openapi.json") ||
    (/(^|\/)\.env($|\.)/.test(path) &&
      !path.endsWith("/.env.example") &&
      path !== ".env.example"),
);
if (forbidden.length) {
  console.error("Private or generated files are staged; unstage these paths:");
  console.error(forbidden.join("\n"));
  process.exit(1);
}
const whitespace = spawnSync("git", ["diff", "--cached", "--check"], {
  stdio: "inherit",
});
if (whitespace.error) throw whitespace.error;
process.exit(whitespace.status ?? 1);
