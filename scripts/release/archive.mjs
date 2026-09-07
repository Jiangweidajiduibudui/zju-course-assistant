import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const [stageArg, reportArg] = process.argv.slice(2);
if (!stageArg || !reportArg)
  throw new Error("Usage: archive.mjs <finalized stage> <native smoke report>");
const stage = resolve(stageArg),
  build = JSON.parse(readFileSync(join(stage, "release-build.json"), "utf8"));
const report = JSON.parse(readFileSync(reportArg, "utf8"));
assert.equal(report.status, "passed");
assert.equal(report.platform, build.platform);
assert.equal(report.node, build.node);
assert.equal(report.emptyWorkspace, true);
assert.equal(report.headedChromium, true);
assert.equal(report.uiRendered, true);
const manifest = readFileSync(join(stage, "FILES.sha256"), "utf8");
assert.equal(
  createHash("sha256").update(manifest).digest("hex"),
  report.manifestSha256,
  "Payload changed after its native smoke test",
);
for (const line of manifest.trim().split("\n")) {
  const hash = line.slice(0, 64),
    file = line.slice(66);
  assert.ok(file && !file.startsWith("/") && !file.split("/").includes(".."));
  if (build.platform === "win32")
    assert.ok(/^[\x20-\x7e]+$/.test(file), "Windows ZIP paths must be ASCII");
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(stage, file)))
      .digest("hex"),
    hash,
    `Payload changed: ${file}`,
  );
}
const platform = build.platform === "win32" ? "windows" : "wsl2";
const name = `${build.product}-${build.version}-${platform}-x64`;
assert.equal(
  basename(stage),
  name,
  "Rename the finalized stage to its release name before archiving",
);
mkdirSync("releases", { recursive: true });
const filename = `${name}.${build.platform === "win32" ? "zip" : "tar.gz"}`,
  archive = resolve("releases", filename);
if (existsSync(archive))
  throw new Error(
    "Release archive already exists; do not append to a previous package",
  );
if (build.platform === "win32")
  execFileSync("zip", ["-q", "-r", archive, name], { cwd: dirname(stage) });
else execFileSync("tar", ["-czf", archive, "-C", dirname(stage), name]);
const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${sha256}  ${filename}\n`);
console.log(JSON.stringify({ archive: `releases/${filename}`, sha256 }));
