import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const [stage, platform] = process.argv.slice(2);
if (!stage || !["linux", "win32"].includes(platform))
  throw new Error("Usage: finalize.mjs <staging directory> <linux|win32>");
const root = resolve(stage);
if (!existsSync(join(root, "release-build.json")))
  throw new Error("Expected a prepared release staging directory");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// Discard generated dependency-manager paths and native-build intermediates.
for (const path of [
  "browsers/.links",
  "node_modules/.bin",
  "node_modules/.pnpm",
  "node_modules/.modules.yaml",
  "node_modules/.pnpm-workspace-state-v1.json",
  "node_modules/better-sqlite3/build",
])
  rmSync(join(root, path), { recursive: true, force: true });
const prebuilds = join(root, "node_modules/better-sqlite3/prebuilds");
for (const file of readdirSync(prebuilds))
  if (file !== `${platform}-x64.node`) rmSync(join(prebuilds, file));
writeFileSync(
  join(root, "package.json"),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", private: true, dependencies: pkg.dependencies }, null, 2)}\n`,
);
for (const file of [".npmrc", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
  rmSync(join(root, file), { force: true });
cpSync("scripts/release/launch.mjs", join(root, "launch.mjs"));
cpSync(
  platform === "linux"
    ? "scripts/release/start.sh"
    : "scripts/release/Start.cmd",
  join(root, platform === "linux" ? "start.sh" : "Start.cmd"),
);
if (platform === "win32") rmSync(join(root, "使用说明.txt"), { force: true });
cpSync(
  platform === "linux"
    ? "scripts/release/USER_GUIDE_WSL.txt"
    : "scripts/release/USER_GUIDE.txt",
  join(root, platform === "linux" ? "使用说明.txt" : "USER_GUIDE.txt"),
);
const build = JSON.parse(
  readFileSync(join(root, "release-build.json"), "utf8"),
);
writeFileSync(
  join(root, "release-build.json"),
  `${JSON.stringify({ ...build, platform, arch: "x64" }, null, 2)}\n`,
);
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Unexpected symlink in package: ${relativePath(file)}`);
    return entry.isDirectory() ? walk(file) : [file];
  });
const relativePath = (file) => relative(root, file).split(sep).join("/");
const paths = walk(root);
const notices = [
  "Third-party components retain their original licenses. Original license files remain in the package.",
  "Node.js: runtime/LICENSE",
  "Chromium: bundled browser original resources and chrome://credits.",
  "",
];
const components = [];
const seen = new Set();
for (const file of paths.filter(
  (p) =>
    relativePath(p).split("/").includes("node_modules") &&
    basename(p) === "package.json",
)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!data.name || !data.version || seen.has(`${data.name}@${data.version}`))
    continue;
  seen.add(`${data.name}@${data.version}`);
  const folder = dirname(file);
  const licenses = readdirSync(folder).filter(
    (name) =>
      /^(licen[sc]e|copying|notice)(\.|$)/i.test(name) &&
      lstatSync(join(folder, name)).isFile(),
  );
  components.push({
    name: data.name,
    version: data.version,
    license: data.license ?? "See package license",
    licenses: licenses.map((name) => relativePath(join(folder, name))),
  });
  notices.push(
    `${data.name}@${data.version} — ${typeof data.license === "string" ? data.license : "See included license"}`,
  );
  for (const name of licenses)
    notices.push(
      `\n--- ${relativePath(join(folder, name))} ---\n${readFileSync(join(folder, name), "utf8")}\n`,
    );
}
writeFileSync(join(root, "THIRD_PARTY_NOTICES.txt"), notices.join("\n"));
writeFileSync(
  join(root, "components.json"),
  `${JSON.stringify(components, null, 2)}\n`,
);
const manifest = walk(root)
  .filter((p) => basename(p) !== "FILES.sha256")
  .sort()
  .map(
    (file) =>
      `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${relativePath(file)}`,
  );
writeFileSync(join(root, "FILES.sha256"), `${manifest.join("\n")}\n`);
console.log(
  JSON.stringify({
    payloadFiles: manifest.length,
    components: components.length,
    platform,
  }),
);
