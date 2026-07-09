import { ErrorCodes } from "../../../shared/contracts/errors.js";

/**
 * chalaoshi 出站 URL 边界（组员 B）。
 * 限制 HTTPS + allowlist host；拒绝 localhost / 私网 / link-local / zdbk。
 * redirect 逐跳复查时复用本函数。
 *
 * 不依赖 fetcher，避免循环引用；调用方将 UrlGuardError 映射为 ChalaoshiFetchError。
 */

export class UrlGuardError extends Error {
  readonly errorCode = ErrorCodes.CHALAOSHI_UPSTREAM_UNAVAILABLE;

  constructor(message: string) {
    super(message);
    this.name = "UrlGuardError";
  }
}

const ZDBK_HOST_RE = /zdbk/i;

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, "").toLowerCase();
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isBlockedIpv4(octets: number[]): boolean {
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // Unique local fc00::/7, link-local fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true;
  }
  return false;
}

function isBlockedHostname(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (ZDBK_HOST_RE.test(host)) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return isBlockedIpv4(ipv4);
  if (host.includes(":")) return isBlockedIpv6(host);
  return false;
}

export function assertChalaoshiUrlAllowed(rawUrl: string, allowedHosts: readonly string[]): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlGuardError(`出站 URL 非法: ${rawUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new UrlGuardError(`chalaoshi 仅允许 HTTPS: ${rawUrl}`);
  }

  if (url.port !== "" && url.port !== "443") {
    throw new UrlGuardError(`chalaoshi 仅允许 443 端口: ${rawUrl}`);
  }

  if (url.username || url.password) {
    throw new UrlGuardError(`禁止带凭据的出站 URL: ${url.origin}`);
  }

  const host = stripBrackets(url.hostname);
  if (isBlockedHostname(host)) {
    throw new UrlGuardError(`禁止的出站主机: ${host}`);
  }

  const allow = new Set(allowedHosts.map((h) => h.toLowerCase()));
  if (!allow.has(host)) {
    throw new UrlGuardError(`主机不在 chalaoshi allowlist: ${host}`);
  }
}

/** 配置加载时校验 base URL（失败则进程拒绝启动） */
export function assertChalaoshiBaseUrlConfig(
  baseUrl: string,
  apiBaseUrl: string,
  allowedHosts: readonly string[],
): void {
  assertChalaoshiUrlAllowed(baseUrl, allowedHosts);
  assertChalaoshiUrlAllowed(apiBaseUrl, allowedHosts);
}
