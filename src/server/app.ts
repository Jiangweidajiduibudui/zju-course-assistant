import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerConfig } from "./config.js";
import { chalaoshiRoutes } from "./modules/chalaoshi/routes.js";
import { diagnosticsRoutes } from "./modules/diagnostics/routes.js";
import { importRoutes } from "./modules/import/routes.js";
import { llmGatewayRoutes } from "./modules/llm-gateway/routes.js";
import { plannerRoutes } from "./modules/planner/routes.js";

/**
 * Fastify 应用装配（负责人；docs/08 §4）。
 *
 * 铁律（在此文件层面强制）：
 * - 本服务没有任何 zdbk 端点、zdbk 出站请求或 zdbk 凭据处理（D31；
 *   scripts/verify-no-zdbk-write.ts + E2E 网络断言双重验证）；
 * - Fastify v5 插件统一 async 风格，不混用 done 回调（docs/07 §4.4）。
 */
export async function buildApp(config: ServerConfig): Promise<FastifyInstance> {
  // 结构化日志由 diagnostics/logger.ts 负责（log.v1），不用 Fastify 内建 pino 输出。
  const app = Fastify({ logger: false });

  await app.register(helmet, {
    // CSP 需要结合 Vite 产物显式配置（docs/07 §2.3 说明），Task 6 收口。
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });

  app.get("/api/health", async () => ({ status: "ok" as const }));

  await app.register(importRoutes, { prefix: "/api/import" });
  await app.register(chalaoshiRoutes, { prefix: "/api/chalaoshi" });
  await app.register(llmGatewayRoutes, { prefix: "/api/llm" });
  await app.register(plannerRoutes, { prefix: "/api/planner" });
  await app.register(diagnosticsRoutes, { prefix: "/api/diagnostics" });

  if (config.NODE_ENV === "production") {
    // 生产环境同源托管 Vite 产物 dist/client（docs/07 §1）。
    // 本文件构建后位于 dist/server/app.js，故产物目录是 ../client。
    const { default: fastifyStatic } = await import("@fastify/static");
    const { fileURLToPath } = await import("node:url");
    await app.register(fastifyStatic, {
      root: fileURLToPath(new URL("../client", import.meta.url)),
      prefix: "/",
    });
  }

  return app;
}
