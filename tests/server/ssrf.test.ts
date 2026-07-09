import { describe, expect, it } from "vitest";
import {
  assertResolvedAddressAllowed,
  checkEndpointUrl,
} from "../../src/server/modules/llm-gateway/ssrf-guard.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

/**
 * SSRF 防护（组员 D；D40；docs/05 §5.1 —— Task 4 门禁）。
 * 已实现部分先行断言；完整矩阵以 it.todo 锚定，实现后逐条点亮。
 */
describe("checkEndpointUrl（URL 形态检查）", () => {
  it("拒绝非 HTTPS", () => {
    const verdict = checkEndpointUrl("http://api.example.com/v1");
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ErrorCodes.LLM_ENDPOINT_NOT_HTTPS);
  });

  it("拒绝非常规端口", () => {
    const verdict = checkEndpointUrl("https://api.example.com:8080/v1");
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF);
  });

  it("拒绝非法 URL", () => {
    expect(checkEndpointUrl("not-a-url").allowed).toBe(false);
  });

  it("放行常规 HTTPS 端点（形态层面）", () => {
    expect(checkEndpointUrl("https://api.example.com/v1").allowed).toBe(true);
  });

  it.todo("拒绝 localhost / 127.0.0.1 / [::1] 字面量（Task 4）");
  it.todo("拒绝私网 10.x / 172.16-31.x / 192.168.x 字面量（Task 4）");
  it.todo("拒绝 IPv4 十进制/八进制/十六进制混合写法绕过（Task 4）");
});

describe("assertResolvedAddressAllowed（DNS 复查）", () => {
  it("未实现前默认拒绝（fail-closed）", () => {
    expect(assertResolvedAddressAllowed("93.184.216.34").allowed).toBe(false);
  });

  it.todo("放行公网 IP、拒绝私网/回环/link-local/reserved（IPv4+IPv6，Task 4）");
  it.todo("重定向后对新目标重新执行全部检查（Task 4，集成测试）");
  it.todo("请求体大小 / 超时 / 并发 / 响应大小限制（Task 4，集成测试）");
});
