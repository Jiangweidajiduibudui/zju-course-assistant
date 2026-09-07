import { lookup } from "node:dns/promises";
import { type RequestOptions, request } from "node:https";
import { BlockList, isIP } from "node:net";
import { fail, ServiceError } from "../errors.js";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 88, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  const global = new BlockList();
  global.addSubnet("2000::", 3, "ipv6");
  const special = new BlockList();
  special.addSubnet("2001::", 23, "ipv6");
  special.addSubnet("2001:db8::", 32, "ipv6");
  special.addSubnet("2002::", 16, "ipv6");
  special.addSubnet("3fff::", 20, "ipv6");
  return (
    isIP(address) === 6 &&
    global.check(address, "ipv6") &&
    !special.check(address, "ipv6")
  );
}
export function endpointUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.hostname === "platform.deepseek.com")
    return fail(
      "ENDPOINT_REJECTED",
      "这是 DeepSeek 控制台地址，请使用 API Base URL：https://api.deepseek.com。",
    );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== "443") ||
    !url.hostname.includes(".") ||
    isIP(url.hostname.replace(/[[\]]/g, "")) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)
  )
    return fail(
      "ENDPOINT_REJECTED",
      "模型地址必须是公开 HTTPS 地址，不含凭据、查询参数或非标准端口。",
    );
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions")
    ? path
    : `${path || "/v1"}/chat/completions`;
  return url;
}
export async function postJson(
  url: URL,
  key: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new Error("aborted"));
      else
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    return fail("ENDPOINT_REJECTED", "模型域名解析到非公开地址，已阻止请求。");
  const selected = addresses[0];
  if (!selected) return fail("ENDPOINT_REJECTED", "模型域名没有可用地址。");
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        family: selected.family,
        autoSelectFamily: false,
        agent: false,
        signal,
        // Pin the validated resolution to this connection; retain hostname for TLS/SNI.
        lookup: (_hostname, _options, callback) =>
          callback(null, selected.address, selected.family),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "Content-Length": Buffer.byteLength(payload),
          "Accept-Encoding": "identity",
        },
      } as RequestOptions & { autoSelectFamily: boolean },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          response.resume();
          reject(
            new ServiceError(
              "UPSTREAM_UNAVAILABLE",
              status === 401 || status === 403
                ? "模型服务拒绝认证，请检查 API key 和模型权限。"
                : status === 429
                  ? "模型服务限流，请稍后重试。"
                  : "模型服务请求失败，请检查地址与模型名；重定向不会被跟随。",
              true,
            ),
          );
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_048_576) response.destroy(new Error("response limit"));
          else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(
            new ServiceError(
              "UPSTREAM_UNAVAILABLE",
              "模型响应中断或超出大小限制。",
              true,
            ),
          ),
        );
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(
              new ServiceError(
                "LLM_OUTPUT_INVALID",
                "模型服务未返回有效 JSON。",
              ),
            );
          }
        });
      },
    );
    req.on("error", () =>
      reject(
        new ServiceError(
          "UPSTREAM_UNAVAILABLE",
          "模型连接失败、已取消或超时。",
          true,
        ),
      ),
    );
    req.end(payload);
  });
}
