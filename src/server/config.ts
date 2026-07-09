import * as z from "zod";

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
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return envSchema.parse(env);
}
