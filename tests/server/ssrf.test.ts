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

  it.each([
    "https://localhost/v1",
    "https://foo.localhost/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
  ])("拒绝 localhost / loopback 字面量：%s", (url) => {
    const verdict = checkEndpointUrl(url);
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF);
  });

  it.each([
    "https://10.1.2.3/v1",
    "https://172.16.0.1/v1",
    "https://172.31.255.255/v1",
    "https://192.168.1.1/v1",
    "https://169.254.1.1/v1",
  ])("拒绝私网 / link-local IPv4 字面量：%s", (url) => {
    const verdict = checkEndpointUrl(url);
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF);
  });

  it.each([
    "https://0177.0.0.1/v1",
    "https://0x7f.0x0.0x0.0x1/v1",
    "https://2130706433/v1",
  ])("拒绝 IPv4 十进制/八进制/十六进制混合写法绕过：%s", (url) => {
    const verdict = checkEndpointUrl(url);
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF);
  });
});

describe("assertResolvedAddressAllowed（DNS 复查）", () => {
  it.each(["93.184.216.34", "8.8.8.8", "2001:4860:4860::8888"])("放行公网 IP：%s", (ip) => {
    expect(assertResolvedAddressAllowed(ip)).toEqual({ allowed: true });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.10.20",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ])("拒绝私网/回环/link-local/reserved IP：%s", (ip) => {
    const verdict = assertResolvedAddressAllowed(ip);
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF);
  });

  it.todo("重定向后对新目标重新执行全部检查（Task 4，集成测试）");
  it.todo("请求体大小 / 超时 / 并发 / 响应大小限制（Task 4，集成测试）");
});
