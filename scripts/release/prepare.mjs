import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const target = process.argv[2];
if (!target)
  throw new Error(
    "Usage: node scripts/release/prepare.mjs <empty staging directory>",
  );
const directory = resolve(target);
if (existsSync(directory))
  throw new Error(
    "Release staging directory already exists; choose an empty path.",
  );
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync(directory, { recursive: true });
cpSync("dist/app", join(directory, "dist/app"), { recursive: true });
cpSync(".local/server-build/src", join(directory, "app/src"), {
  recursive: true,
});
mkdirSync(join(directory, "app/scripts"), { recursive: true });
cpSync(
  ".local/server-build/scripts/start-server.js",
  join(directory, "app/scripts/start-server.js"),
);
for (const file of [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "LICENSE",
])
  cpSync(file, join(directory, file));
cpSync("scripts/release/launch.mjs", join(directory, "launch.mjs"));
cpSync("scripts/release/USER_GUIDE.txt", join(directory, "使用说明.txt"));
writeFileSync(
  join(directory, ".npmrc"),
  "node-linker=hoisted\npackage-import-method=copy\n",
);
writeFileSync(
  join(directory, "release-build.json"),
  `${JSON.stringify(
    {
      product: pkg.name,
      version: pkg.version,
      node: pkg.engines.node,
      pnpm: pkg.engines.pnpm,
      lockfileSha256: createHash("sha256")
        .update(readFileSync("pnpm-lock.yaml"))
        .digest("hex"),
      provenance:
        "Built from the current working source using an explicit allowlist; no user data or development evidence is copied.",
    },
    null,
    2,
  )}\n`,
);
console.log(`Prepared ${pkg.name} ${pkg.version}`);
