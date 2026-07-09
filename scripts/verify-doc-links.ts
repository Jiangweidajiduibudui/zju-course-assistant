import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * 文档链接检查（负责人）：README/PROJECT/docs 内的相对 Markdown 链接必须可解析。
 * 运行：pnpm verify:doc-links（GitHub 同步前检查项之一，docs/08 §14）。
 */
const ROOT = join(import.meta.dirname, "..");

const mdFiles: string[] = ["README.md", "PROJECT.md"].filter((f) => existsSync(join(ROOT, f)));
const docsEntries = readdirSync(join(ROOT, "docs"), { recursive: true, withFileTypes: true });
for (const entry of docsEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
  const rel = relative(ROOT, join(entry.parentPath, entry.name));
  // docs/archive 是已失效历史稿（README §5），不检查其内部链接。
  if (rel.split(/[\\/]/).includes("archive")) continue;
  mdFiles.push(rel);
}

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)\)/g;
const broken: Array<{ file: string; target: string }> = [];

for (const file of mdFiles) {
  const content = readFileSync(join(ROOT, file), "utf8");
  for (const match of content.matchAll(LINK_PATTERN)) {
    const raw = match[1];
    if (!raw || /^(https?:|mailto:|#)/.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#")[0] ?? "");
    if (target === "") continue;
    const resolved = join(ROOT, dirname(file), target);
    if (!existsSync(resolved)) {
      broken.push({ file, target: raw });
    }
  }
}

if (broken.length > 0) {
  console.error(`❌ verify-doc-links 发现 ${broken.length} 个失效链接：`);
  for (const b of broken) {
    console.error(`  ${b.file} → ${b.target}`);
  }
  process.exit(1);
}
console.log(`✅ verify-doc-links 通过：${mdFiles.length} 个文档的相对链接全部可解析。`);
