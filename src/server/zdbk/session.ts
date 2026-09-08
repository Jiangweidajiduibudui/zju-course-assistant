import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type APIRequestContext,
  type BrowserContext,
  chromium,
  request,
} from "playwright";
import { fail, ServiceError } from "../errors.js";
import {
  allowedLogin,
  allowedRead,
  READ_PATHS,
  SCHOOL_ORIGIN,
  SELECTION_URL,
} from "./allowlist.js";

export type PageContext = {
  year: string;
  code: string;
  quotaDisplay: string;
  principal: string;
  parts: string[];
};
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
export function readPageContext(html: string): PageContext {
  const fields = new Map<string, string>();
  for (const input of html.match(/<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ??
    []) {
    const attrs = new Map<string, string>();
    for (const match of input.matchAll(
      /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    ))
      attrs.set(
        (match[1] ?? "").toLowerCase(),
        decode(match[2] ?? match[3] ?? match[4] ?? ""),
      );
    if (attrs.has("id"))
      fields.set(attrs.get("id") ?? "", attrs.get("value") ?? "");
  }
  const year = fields.get("xn") ?? "",
    code = fields.get("xq") ?? "",
    principal = fields.get("sessionUserKey") ?? "";
  if (!/^20\d\d-20\d\d$/.test(year) || !/^\d{1,2}$/.test(code) || !principal)
    return fail(
      "SESSION_EXPIRED",
      "教务会话已失效，或页面登录上下文发生变化，请重新登录。",
    );
  const parts = [
    ...new Set(
      [...html.matchAll(/data-xxq\s*=\s*["']([^"']+)["']/g)].map((m) =>
        decode(m[1] ?? ""),
      ),
    ),
  ];
  if (!parts.length)
    return fail(
      "UPSTREAM_SCHEMA_CHANGED",
      "教务学期结构发生变化，未发布快照。",
    );
  return {
    year,
    code,
    principal,
    parts,
    quotaDisplay: fields.get("ylxs") ?? "",
  };
}
export class SchoolSession {
  private browser: BrowserContext | null = null;
  private client: APIRequestContext | null = null;
  private active = false;
  private state: "logged_out" | "logging_in" | "authenticated" | "expired" =
    "logged_out";
  private pageContext: PageContext | null = null;
  private salt: string;
  readonly sessionFile: string;
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.sessionFile = join(directory, "session.json");
    const saltFile = join(directory, "scope-salt");
    if (!existsSync(saltFile))
      writeFileSync(saltFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    this.salt = readFileSync(saltFile, "utf8");
    // Persisted cookies are not evidence of a currently valid session.
    if (existsSync(this.sessionFile)) this.state = "expired";
  }
  status() {
    return { state: this.state, checkedAt: new Date().toISOString() };
  }
  private save(state: Awaited<ReturnType<APIRequestContext["storageState"]>>) {
    writeFileSync(this.sessionFile, JSON.stringify(state), { mode: 0o600 });
    chmodSync(this.sessionFile, 0o600);
  }
  async login(signal: AbortSignal): Promise<PageContext> {
    if (this.active) return fail("OPERATION_IN_PROGRESS", "登录窗口已经打开。");
    this.active = true;
    this.state = "logging_in";
    const close = () => {
      void this.browser?.close().catch(() => {});
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      await this.client?.dispose();
      this.client = null;
      this.browser = await chromium.launchPersistentContext(
        join(this.directory, "cas-profile"),
        {
          headless: false,
          viewport: null,
          serviceWorkers: "block",
          args: ["--start-maximized"],
        },
      );
      if (signal.aborted) return fail("SESSION_REQUIRED", "登录已取消。");
      await this.browser.route("**/*", async (route) => {
        const req = route.request();
        if (allowedLogin(req.url(), req.method(), req.resourceType()))
          await route.continue();
        else await route.abort();
      });
      const page = this.browser.pages()[0] ?? (await this.browser.newPage());
      await page
        .goto(SELECTION_URL, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        })
        .catch(() => {
          if (signal.aborted || page.isClosed())
            fail("SESSION_REQUIRED", "登录已取消或窗口已关闭。");
          // Keep the headed window available for manual reload after a route change.
        });
      await page.bringToFront();
      const deadline = Date.now() + 300000;
      while (!signal.aborted && Date.now() < deadline) {
        if (page.isClosed())
          return fail("SESSION_REQUIRED", "登录窗口已关闭，可以重新打开。");
        const url = new URL(page.url());
        if (
          url.origin === SCHOOL_ORIGIN &&
          url.pathname.split(";")[0] === "/jwglxt/xtgl/index_initMenu.html"
        )
          await page
            .goto(SELECTION_URL, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            })
            .catch(() => {
              if (signal.aborted || page.isClosed())
                fail("SESSION_REQUIRED", "登录已取消或窗口已关闭。");
            });
        if (new URL(page.url()).pathname === READ_PATHS.index) {
          const html = await page.content();
          try {
            const data = readPageContext(html);
            this.save(await this.browser.storageState());
            this.pageContext = data;
            this.state = "authenticated";
            return data;
          } catch (error) {
            if (
              error instanceof ServiceError &&
              error.code === "UPSTREAM_SCHEMA_CHANGED"
            )
              throw error;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return fail(
        "SESSION_REQUIRED",
        signal.aborted ? "登录已取消。" : "登录等待超时，请重试。",
      );
    } catch (error) {
      this.state = "logged_out";
      if (error instanceof ServiceError) throw error;
      return fail(
        "SESSION_REQUIRED",
        "登录窗口未能完成认证，请检查窗口和网络后重试。",
      );
    } finally {
      signal.removeEventListener("abort", close);
      this.active = false;
      await this.browser?.close().catch(() => {});
      this.browser = null;
    }
  }
  async read(
    name: keyof typeof READ_PATHS,
    form: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.readOnce(name, form, signal);
      } catch (error) {
        if (
          signal.aborted ||
          attempt >= 2 ||
          !(error instanceof ServiceError) ||
          error.code !== "UPSTREAM_UNAVAILABLE"
        )
          throw error;
        try {
          await delay(500 * 2 ** attempt, undefined, { signal });
        } catch {
          return fail("SYNC_INCOMPLETE", "同步已取消。");
        }
      }
    }
  }
  private async readOnce(
    name: keyof typeof READ_PATHS,
    form: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    const method = name === "index" ? "GET" : "POST";
    const url = new URL(READ_PATHS[name], SCHOOL_ORIGIN);
    url.searchParams.set("gnmkdm", "N253530");
    if (name === "index") url.searchParams.set("layout", "default");
    if (!allowedRead(url.href, method))
      return fail("ENDPOINT_REJECTED", "教务读取未通过白名单。");
    if (signal.aborted) return fail("SESSION_REQUIRED", "读取已取消。");
    if (!existsSync(this.sessionFile))
      return fail("SESSION_REQUIRED", "请先登录教务系统。");
    if (!this.client)
      this.client = await request.newContext({
        storageState: this.sessionFile,
        extraHTTPHeaders: {
          "X-Requested-With": "XMLHttpRequest",
          Referer: SELECTION_URL,
        },
        timeout: 30000,
        ignoreHTTPSErrors: false,
      });
    const client = this.client;
    const abort = () => {
      void client.dispose().catch(() => {});
      if (this.client === client) this.client = null;
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await client.fetch(url.href, {
        method,
        ...(method === "POST" ? { form } : {}),
        maxRedirects: 0,
        timeout: 30000,
      });
      try {
        if ([301, 302, 303, 307, 308, 401, 403].includes(response.status())) {
          this.state = "expired";
          return fail("SESSION_EXPIRED", "教务会话已失效，请重新登录。");
        }
        if (!response.ok())
          return fail(
            [408, 429, 500, 502, 503, 504].includes(response.status())
              ? "UPSTREAM_UNAVAILABLE"
              : "SYNC_INCOMPLETE",
            "教务读取失败；旧快照保持不变。",
          );
        const buffer = await response.body();
        if (buffer.length > 32 * 1024 * 1024)
          return fail("SYNC_INCOMPLETE", "教务单次响应超出大小限制。");
        const text = buffer.toString("utf8");
        if (name !== "index" && !/^[\s]*[[{]/.test(text)) {
          if (/login_slogin|cas\/login|用户登录/.test(text)) {
            this.state = "expired";
            return fail("SESSION_EXPIRED", "教务返回了登录页，请重新登录。");
          }
          return fail(
            "UPSTREAM_SCHEMA_CHANGED",
            "教务返回了非数据错误响应，旧快照保持不变。",
          );
        }
        if (signal.aborted) return fail("SESSION_REQUIRED", "读取已取消。");
        this.save(await client.storageState());
        return text;
      } finally {
        await response.dispose().catch(() => {});
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      return fail(
        "UPSTREAM_UNAVAILABLE",
        "教务读取中断或超时；已按读取策略重试，旧快照保持不变。请确认学校页面可访问，网络或 VPN 切换后重新登录并同步。",
      );
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async context(signal: AbortSignal) {
    const data = readPageContext(await this.read("index", {}, signal));
    this.pageContext = data;
    this.state = "authenticated";
    return data;
  }
  cachedContext() {
    return this.pageContext;
  }
  scope(data: PageContext) {
    return createHash("sha256")
      .update(this.salt)
      .update(data.principal)
      .digest("hex");
  }
  assertScope(data: PageContext): void {
    const file = join(this.directory, "dataset-scope");
    if (existsSync(file) && readFileSync(file, "utf8") !== this.scope(data))
      fail(
        "SESSION_SCOPE_CHANGED",
        "当前登录账号与本地数据绑定不同；请明确清除规划数据或使用独立数据目录。",
      );
  }
  bind(data: PageContext) {
    this.assertScope(data);
    writeFileSync(join(this.directory, "dataset-scope"), this.scope(data), {
      mode: 0o600,
    });
  }
  clearBinding() {
    rmSync(join(this.directory, "dataset-scope"), { force: true });
  }
  async logout() {
    await this.close();
    rmSync(this.sessionFile, { force: true });
    rmSync(join(this.directory, "cas-profile"), {
      recursive: true,
      force: true,
    });
    this.pageContext = null;
    this.state = "logged_out";
  }
  async close() {
    await this.browser?.close().catch(() => {});
    await this.client?.dispose().catch(() => {});
    this.browser = null;
    this.client = null;
  }
}
