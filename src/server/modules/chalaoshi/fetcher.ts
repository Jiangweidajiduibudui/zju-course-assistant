import { ErrorCodes } from "../../../shared/contracts/errors.js";
import { assertChalaoshiUrlAllowed, UrlGuardError } from "./url-guard.js";

/**
 * chalaoshi 上游抓取（组员 B；docs/03 §3.2、docs/07 §7）。
 * - 超时 / 限响应体 / 4xx·5xx / Cloudflare 页 → 稳定错误码，不半写缓存；
 * - redirect: manual + 逐跳 allowlist 复查（防 SSRF / 跳到 zdbk·私网）；
 * - 可注入 fetch 便于单测，CI 默认不访问真实上游。
 */

export class ChalaoshiFetchError extends Error {
  constructor(
    readonly errorCode:
      | typeof ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE
      | typeof ErrorCodes.CHALAOSHI_RATE_LIMITED
      | typeof ErrorCodes.CHALAOSHI_TIMEOUT
      | typeof ErrorCodes.CHALAOSHI_PARSE_FAILED,
    message: string,
  ) {
    super(message);
    this.name = "ChalaoshiFetchError";
  }
}

export type FetchLike = typeof fetch;

export interface UpstreamFetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  /** 两次上游请求最小间隔（进程内限频） */
  minIntervalMs?: number;
  /** 出站 host allowlist；缺省时仅做协议/私网检查前须由调用方保证已校验 */
  allowedHosts?: readonly string[];
  /** 最大重定向跳数 */
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MIN_INTERVAL_MS = 200;
const DEFAULT_MAX_REDIRECTS = 5;

let lastUpstreamAt = 0;
let rateChain: Promise<void> = Promise.resolve();

/** 测试用：重置限频状态 */
export function resetUpstreamRateLimitForTests(): void {
  lastUpstreamAt = 0;
  rateChain = Promise.resolve();
}

async function waitRateLimit(minIntervalMs: number): Promise<void> {
  const run = async (): Promise<void> => {
    const now = Date.now();
    const wait = Math.max(0, lastUpstreamAt + minIntervalMs - now);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastUpstreamAt = Date.now();
  };
  const next = rateChain.then(run, run);
  rateChain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

function resolveRedirectUrl(current: string, location: string | null): string {
  if (!location) {
    throw new ChalaoshiFetchError(
      ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
      `重定向缺少 Location: ${current}`,
    );
  }
  try {
    return new URL(location, current).toString();
  } catch {
    throw new ChalaoshiFetchError(
      ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
      `非法重定向 Location: ${location}`,
    );
  }
}

export async function fetchUpstreamText(
  url: string,
  options: UpstreamFetchOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowedHosts = options.allowedHosts;

  await waitRateLimit(minIntervalMs);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (allowedHosts) {
        assertChalaoshiUrlAllowed(currentUrl, allowedHosts);
      }

      const response = await fetchImpl(currentUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json, text/html, */*" },
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        if (hop === maxRedirects) {
          throw new ChalaoshiFetchError(
            ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
            `重定向超过 ${maxRedirects} 跳: ${url}`,
          );
        }
        currentUrl = resolveRedirectUrl(currentUrl, response.headers.get("location"));
        continue;
      }

      if (response.status === 429) {
        throw new ChalaoshiFetchError(ErrorCodes.CHALAOSHI_RATE_LIMITED, `上游限流: ${currentUrl}`);
      }
      if (!response.ok) {
        throw new ChalaoshiFetchError(
          ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
          `上游 HTTP ${response.status}: ${currentUrl}`,
        );
      }

      const buf = await response.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        throw new ChalaoshiFetchError(
          ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
          `响应体过大 (${buf.byteLength} > ${maxBytes}): ${currentUrl}`,
        );
      }
      const text = new TextDecoder("utf-8").decode(buf);
      // Cloudflare / 挑战页粗检：有标题特征且无业务结构时由 parser 再失败；此处拦明显挑战页
      if (/cf-browser-verification|Just a moment\.\.\.|Attention Required/i.test(text)) {
        throw new ChalaoshiFetchError(
          ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
          `疑似 Cloudflare 拦截页: ${currentUrl}`,
        );
      }
      return text;
    }

    throw new ChalaoshiFetchError(
      ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
      `重定向超过 ${maxRedirects} 跳: ${url}`,
    );
  } catch (cause) {
    if (cause instanceof ChalaoshiFetchError) {
      throw cause;
    }
    if (cause instanceof UrlGuardError) {
      throw new ChalaoshiFetchError(cause.errorCode, cause.message);
    }
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new ChalaoshiFetchError(
        ErrorCodes.CHALAOSHI_TIMEOUT,
        `上游超时 ${timeoutMs}ms: ${url}`,
      );
    }
    throw new ChalaoshiFetchError(
      ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE,
      cause instanceof Error ? cause.message : "上游请求失败",
    );
  } finally {
    clearTimeout(timer);
  }
}
