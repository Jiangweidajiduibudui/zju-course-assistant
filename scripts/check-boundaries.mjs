import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve("src");
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name))
      : /\.(ts|tsx)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
const problems = [];
for (const file of walk(root)) {
  const name = relative(root, file);
  const content = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const check = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (
        name.startsWith("domain/") &&
        ((!specifier.startsWith(".") && !["zod"].includes(specifier)) ||
          /server|client|fixtures|node:/.test(specifier))
      )
        problems.push(`${name}: domain I/O boundary import`);
      if (name.startsWith("client/") && /server|node:/.test(specifier))
        problems.push(`${name}: client/server boundary import`);
      if (
        name.startsWith("server/") &&
        ![
          "server/llm/transport.ts",
          "server/reviews/transport.ts",
          "server/zdbk/session.ts",
          "server/zdbk/read.ts",
        ].includes(name) &&
        /^(?:node:)?(?:https?|net|tls|dns)$|undici|axios|playwright/.test(
          specifier,
        )
      )
        problems.push(
          `${name}: external transport outside approved adapter modules`,
        );
    }
    if (
      name.startsWith("server/") &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    )
      problems.push(`${name}: external fetch bypasses the guarded adapter`);
    ts.forEachChild(node, check);
  };
  check(parsed);
  if (
    /\b(?:enumerateArrangements|EnumerationResource|rankGroup|compareArrangements|SearchCoverage)\b/.test(
      content,
    )
  )
    problems.push(`${name}: retired planning pipeline`);
  // Exact read paths contain repeated "xk" in their names; substring matching
  // falsely rejects the allowlist itself. Reject any unrecognized selection URL.
  const readPaths = new Set([
    "/jwglxt/xsxk/zzxkghb_cxZzxkGhbIndex.html",
    "/jwglxt/xsxk/zzxkghb_cxZzxkGhbDdkcList.html",
    "/jwglxt/xsxk/zzxkghb_cxZzxkGhbJxbList.html",
    "/jwglxt/xsxk/zzxkghb_cxZzxkGhbChoosed.html",
    "/jwglxt/xsxk/zzxkghb_cxZzxkDxqzcList.html",
  ]);
  for (const match of content.matchAll(/\/jwglxt\/xsxk\/[^\s"'`?]*\.html/g))
    if (!readPaths.has(match[0]))
      problems.push(`${name}: unreviewed school selection path`);
}
if (problems.length) throw new Error(problems.join("\n"));
console.log(
  "Domain/client/server boundaries and absence of retired or upstream-write transports verified.",
);
