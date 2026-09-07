import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "zju-http-e2e-"));
const child = spawn(
  process.execPath,
  [".local/server-build/scripts/start-demo.js"],
  {
    env: { ...process.env, ZJU_PORT: "4318", ZJU_DATA_DIR: directory },
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill("SIGTERM"));
child.on("exit", (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
