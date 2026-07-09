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
  errorCode?: typeof ErrorCodes.LLM_ENDPOINT_NOT_HTTPS | typeof ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF;
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
    return { allowed: false, errorCode: ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF, reason: "仅允许 443 端口" };
  }
  // TODO(Task 4, 组员 D): 字面量 IP（IPv4/IPv6/混合写法）与 localhost 判定；
  // 参考 docs/05 §5.1 SSRF 用例矩阵，禁止只做字符串前缀匹配。
  return { allowed: true };
}

/** DNS 解析后的 IP 白名单复查（Task 4 实现；重定向后同样调用） */
export function assertResolvedAddressAllowed(_ip: string): SsrfVerdict {
  // TODO(Task 4, 组员 D): 私网/回环/link-local/reserved 网段判定（IPv4 + IPv6）。
  return {
    allowed: false,
    errorCode: ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF,
    reason: "DNS 复查未实现（Task 4）——默认拒绝",
  };
}
