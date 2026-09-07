import { lookup } from "node:dns/promises";
import { type RequestOptions, request } from "node:https";
import { isIP } from "node:net";
import { fail, ServiceError } from "../errors.js";
import { publicAddress } from "../llm/transport.js";

export function reviewUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("ENDPOINT_REJECTED", "评价来源地址无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !url.hostname.includes(".") ||
    isIP(url.hostname.replace(/[[\]]/g, "")) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)
  )
    return fail("ENDPOINT_REJECTED", "评价来源必须使用公开 HTTPS 地址。");
  return url;
}

// Public, anonymous reads only. Redirects are not followed and DNS is pinned.
// This transport cannot receive school cookies or model credentials.
export async function getReviewText(
  url: URL,
  signal: AbortSignal,
  maxBytes = 8_388_608,
): Promise<string> {
  reviewUrl(url.href);
  try {
    signal.throwIfAborted();
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
    ]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      return fail(
        "ENDPOINT_REJECTED",
        "评价来源解析到非公开地址，已阻止请求。",
      );
    const selected = addresses[0];
    if (!selected) return fail("ENDPOINT_REJECTED", "评价来源没有可用地址。");
    return await new Promise<string>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          agent: false,
          signal,
          family: selected.family,
          autoSelectFamily: false,
          lookup: (_hostname, _options, callback) =>
            callback(null, selected.address, selected.family),
          headers: {
            Accept: "application/json, text/html, text/plain",
            "Accept-Encoding": "identity",
          },
        } as RequestOptions & { autoSelectFamily: boolean },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(
              new ServiceError(
                "UPSTREAM_UNAVAILABLE",
                "评价来源暂不可用，请稍后重试或切换来源。",
                true,
              ),
            );
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) response.destroy(new Error("response limit"));
            else chunks.push(chunk);
          });
          response.on("error", () =>
            reject(
              new ServiceError(
                "UPSTREAM_UNAVAILABLE",
                "评价响应中断或超出大小限制。",
                true,
              ),
            ),
          );
          response.on("end", () =>
            resolve(Buffer.concat(chunks).toString("utf8")),
          );
        },
      );
      req.on("error", () =>
        reject(
          new ServiceError(
            "UPSTREAM_UNAVAILABLE",
            "评价连接失败或超时，请重试。",
            true,
          ),
        ),
      );
      req.end();
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      "评价连接失败或超时，请重试。",
      true,
    );
  }
}
