import * as z from "zod";
import { assertChalaoshiBaseUrlConfig } from "./modules/chalaoshi/url-guard.js";

/**
 * 服务端配置（.env → 进程环境；示例见 .env.example）。
 * 注意：配置中永远不包含 LLM key（D40）、zdbk 凭据（D31）。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  /** 可缺省：无 PostgreSQL 时 chalaoshi 模块降级为 L1 + seed（开发便利） */
  DATABASE_URL: z.string().optional(),
  /** chalaoshi 域名可配置（docs/03 §3：.de 可能被墙） */
  CHALAOSHI_BASE_URL: z.url().default("https://chalaoshi.de"),
  CHALAOSHI_API_BASE_URL: z.url().default("https://api.chalaoshi.de"),
  /**
   * 出站 allowlist（逗号分隔）。仅这些 host 可被抓取；
   * 另由 url-guard 拒绝 localhost/私网/link-local/zdbk。
   */
  CHALAOSHI_ALLOWED_HOSTS: z
    .string()
    .default("chalaoshi.de,api.chalaoshi.de")
    .transform((raw) =>
      raw
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0),
    )
    .pipe(z.array(z.string().min(1)).min(1)),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const config = envSchema.parse(env);
  assertChalaoshiBaseUrlConfig(
    config.CHALAOSHI_BASE_URL,
    config.CHALAOSHI_API_BASE_URL,
    config.CHALAOSHI_ALLOWED_HOSTS,
  );
  return config;
}
