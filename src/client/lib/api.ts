import type { ApiError } from "../../shared/contracts/errors.js";

/**
 * 同源 API 封装：client 只访问 /api/*（开发期 vite 代理，生产同源 Fastify）。
 * 铁律：client 不直连外部 LLM 端点或 chalaoshi（D40；docs/08 §5.1）。
 * queryFn 必须把 TanStack Query 提供的 signal 透传进来（docs/07 §4.5）。
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(`${body.errorCode}: ${body.message}`);
    this.name = "ApiRequestError";
  }
}

export async function fetchJson<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      errorCode: "COMMON_INTERNAL",
      message: `HTTP ${response.status}`,
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return (await response.json()) as T;
}
