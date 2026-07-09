import { isIP } from "node:net";
import { ErrorCodes } from "../../../shared/contracts/errors.js";

/**
 * SSRF 防护（组员 D；D40；docs/08 §7.3）—— llm-gateway 的安全地基。
 *
 * 必须全部实现并有单测（tests/server/ssrf.test.ts，Task 4 门禁）：
 * 1. 仅允许 https:（LLM_ENDPOINT_NOT_HTTPS）；
 * 2. 阻断 localhost / private / link-local / reserved IP（含 IPv6 形态）；
 * 3. DNS 解析后按解析出的 IP 复查（防 DNS rebinding）；
 * 4. 每次重定向后对新目标重新执行全部检查；
 * 5. 限制端口（默认仅 443）、请求体大小、超时、并发与响应大小；
 * 6. LAN 模型端点默认不可用（未来本地部署安全模式另行决策）。
 */
export interface SsrfVerdict {
  allowed: boolean;
  errorCode?:
    | typeof ErrorCodes.LLM_ENDPOINT_NOT_HTTPS
    | typeof ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF;
  reason?: string;
}

/** 同步的 URL 形态检查（协议/端口/字面量 IP）；DNS 复查见 assertResolvedAddressAllowed */
export function checkEndpointUrl(rawUrl: string): SsrfVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, errorCode: ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF, reason: "URL 非法" };
  }
  if (url.protocol !== "https:") {
    return { allowed: false, errorCode: ErrorCodes.LLM_ENDPOINT_NOT_HTTPS, reason: "仅允许 HTTPS" };
  }
  if (url.port !== "" && url.port !== "443") {
    return {
      allowed: false,
      errorCode: ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF,
      reason: "仅允许 443 端口",
    };
  }
  const hostname = normalizeHostname(url.hostname);
  if (isLocalhostName(hostname)) {
    return blocked(`禁止访问 localhost 域名：${hostname}`);
  }

  if (isIP(hostname) !== 0) {
    return assertResolvedAddressAllowed(hostname);
  }

  return { allowed: true };
}

/** DNS 解析后的 IP 白名单复查（Task 4 实现；重定向后同样调用） */
export function assertResolvedAddressAllowed(ip: string): SsrfVerdict {
  const normalizedIp = normalizeHostname(ip);
  const ipVersion = isIP(normalizedIp);
  if (ipVersion === 0) {
    return blocked(`DNS 解析结果不是合法 IP：${ip}`);
  }

  if (ipVersion === 4 && isBlockedIpv4(normalizedIp)) {
    return blocked(`DNS 解析结果指向受限 IPv4 地址：${normalizedIp}`);
  }

  if (ipVersion === 6 && isBlockedIpv6(normalizedIp)) {
    return blocked(`DNS 解析结果指向受限 IPv6 地址：${normalizedIp}`);
  }

  return { allowed: true };
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return withoutBrackets.toLowerCase();
}

function isLocalhostName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function blocked(reason: string): SsrfVerdict {
  return { allowed: false, errorCode: ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF, reason };
}

function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  const [first, second] = octets;
  if (first === undefined || second === undefined || octets.some((octet) => Number.isNaN(octet))) {
    return true;
  }

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isBlockedIpv6(ip: string): boolean {
  const mappedIpv4 = extractIpv4MappedAddress(ip);
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4);
  }

  const value = expandIpv6ToBigInt(ip);
  if (value === null) {
    return true;
  }

  return (
    value === 0n ||
    value === 1n ||
    isIpv6InRange(value, 0xfc00n << 112n, 7) ||
    isIpv6InRange(value, 0xfe80n << 112n, 10) ||
    isIpv6InRange(value, 0xff00n << 112n, 8) ||
    isIpv6InRange(value, 0x20010db8n << 96n, 32)
  );
}

function extractIpv4MappedAddress(ip: string): string | null {
  if (!ip.startsWith("::ffff:")) {
    return null;
  }

  const mapped = ip.slice("::ffff:".length);
  if (isIP(mapped) === 4) {
    return mapped;
  }

  const groups = mapped.split(":");
  if (groups.length !== 2) {
    return null;
  }

  const high = Number.parseInt(groups[0] ?? "", 16);
  const low = Number.parseInt(groups[1] ?? "", 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function expandIpv6ToBigInt(ip: string): bigint | null {
  const [head = "", tail = ""] = ip.split("::", 2);
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const missingGroups = 8 - headGroups.length - tailGroups.length;
  if (missingGroups < 0) {
    return null;
  }

  const groups = [
    ...headGroups,
    ...Array.from({ length: missingGroups }, () => "0"),
    ...tailGroups,
  ];
  if (groups.length !== 8) {
    return null;
  }

  let value = 0n;
  for (const group of groups) {
    const parsed = Number.parseInt(group, 16);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
      return null;
    }
    value = (value << 16n) + BigInt(parsed);
  }

  return value;
}

function isIpv6InRange(value: bigint, prefixValue: bigint, prefixBits: number): boolean {
  const hostBits = 128n - BigInt(prefixBits);
  return value >> hostBits === prefixValue >> hostBits;
}
