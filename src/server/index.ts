import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logEvent } from "./modules/diagnostics/logger.js";

/** 服务端入口：pnpm dev:api（tsx watch）/ pnpm start（dist 产物） */
const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  logEvent({
    level: "info",
    requestId: null,
    generationId: null,
    module: "server",
    action: "listen",
    status: "ok",
    durationMs: null,
    errorCode: null,
  });
} catch (error) {
  logEvent({
    level: "error",
    requestId: null,
    generationId: null,
    module: "server",
    action: "listen",
    status: "failed",
    durationMs: null,
    errorCode: "COMMON_INTERNAL",
  });
  app.log.error?.(error);
  process.exit(1);
}
