import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * 静态守门（负责人；docs/08 §5、G2）：
 *
 * 1. src/tests/scripts 中不得出现 zdbk 端点特征（Demo 不请求 zdbk —— D31）；
 * 2. 依赖方向检查（docs/07 §3）：
 *    - src/client 不得 import src/server；
 *    - src/domain 不得 import react/fastify/dexie/pg/@fastify/cheerio。
 *
 * 运行：pnpm verify:no-zdbk-write（CI 与 pnpm verify 必跑）。
 * 运行时守门由 E2E 网络断言补充（tests/e2e/demo-flow.spec.ts）。
 */
const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "tests", "scripts"];
const SELF = join("scripts", "verify-no-zdbk-write.ts");

// 拆开拼接，避免本文件自身命中特征。
const ZDBK_MARKERS = [`zdbk.${"zju"}.edu.cn`, `/jw${"glxt"}/`, `zzxk${"ghb"}`, `xsxk/`];

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const violations: Violation[] = [];

function scanFile(absPath: string): void {
  const rel = relative(ROOT, absPath);
  if (rel === SELF) return;
  const lines = readFileSync(absPath, "utf8").split("\n");
  const posix = rel.split(sep).join("/");
  lines.forEach((text, index) => {
    for (const marker of ZDBK_MARKERS) {
      if (text.includes(marker)) {
        violations.push({ file: posix, line: index + 1, rule: `zdbk 特征 "${marker}"`, text });
      }
    }
    if (posix.startsWith("src/client/") && /from\s+["'][^"']*\/server\//.test(text)) {
      violations.push({ file: posix, line: index + 1, rule: "client 禁止 import server", text });
    }
    if (posix.startsWith("src/domain/")) {
      const banned = /from\s+["'](react|react-dom|fastify|@fastify\/|dexie|pg|cheerio|lru-cache)/;
      if (banned.test(text)) {
        violations.push({ file: posix, line: index + 1, rule: "domain 禁止依赖框架/IO", text });
      }
    }
  });
}

for (const dir of SCAN_DIRS) {
  const entries = readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|json|html|css)$/.test(entry.name)) continue;
    scanFile(join(entry.parentPath, entry.name));
  }
}

if (violations.length > 0) {
  console.error(`❌ verify-no-zdbk-write 发现 ${violations.length} 处违规：\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]\n    ${v.text.trim()}`);
  }
  process.exit(1);
}
console.log("✅ verify-no-zdbk-write 通过：无 zdbk 特征，依赖方向合规。");
