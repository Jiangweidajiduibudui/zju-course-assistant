import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "../src/server/app.js";
import { Store } from "../src/server/storage/store.js";
import { LiveSchool } from "../src/server/zdbk/read.js";
import { SchoolSession } from "../src/server/zdbk/session.js";

process.umask(0o077);
const port = Number(process.env.ZJU_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid ZJU_PORT");
const directory =
  process.env.ZJU_DATA_DIR ??
  (process.platform === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "ZJUCourseAssistant",
      )
    : join(homedir(), ".local", "share", "zju-course-assistant", "data"));
const store = new Store(join(resolve(directory), "workspace.sqlite3"));
const origin = `http://127.0.0.1:${port}`;
const runtime = createApp({
  store,
  origin,
  schoolDriver: new LiveSchool(
    new SchoolSession(join(resolve(directory), "private")),
  ),
});
const root = resolve("dist/app");
if (!existsSync(join(root, "index.html")))
  throw new Error("Build the UI first: pnpm build");
runtime.app.use("*", serveStatic({ root }));
runtime.app.get("*", serveStatic({ path: join(root, "index.html") }));
const server = serve({ fetch: runtime.app.fetch, hostname: "127.0.0.1", port });
export const ready = new Promise<string>((resolve, reject) => {
  server.once("listening", () => resolve(origin));
  server.once("error", reject);
});
console.log(`Local workspace: ${origin}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await runtime.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
