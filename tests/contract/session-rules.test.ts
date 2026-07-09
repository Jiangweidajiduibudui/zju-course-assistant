import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSessionDraft } from "../../src/client/features/import-export/sessionDraft.js";
import { updateSessionCreditLimit } from "../../src/client/features/session/sessionRules.js";
import { catalogSchema, sessionSchema } from "../../src/shared/contracts/index.js";

const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function getDemoSession() {
  const catalog = catalogSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, "demo-catalog.synthetic.json"), "utf8")),
  );
  return buildDemoSessionDraft(catalog, {
    id: "session-demo-test",
    name: "合成 Demo session",
    now: "2026-07-09T15:00:00.000+08:00",
  });
}

describe("session 学分上限规则", () => {
  it("把正数学分上限写入 rules.creditLimit，并保留 session 其他状态", () => {
    const session = getDemoSession();
    const updated = updateSessionCreditLimit(session, 18);

    expect(() => sessionSchema.parse(updated)).not.toThrow();
    expect(updated.rules.creditLimit).toBe(18);
    expect(session.rules.creditLimit).toBeNull();
    expect(updated.baseline).toEqual(session.baseline);
    expect(updated.pool).toEqual(session.pool);
    expect(updated.plan).toBeNull();
    expect(updated.history).toEqual([]);
  });

  it("拒绝非正数学分上限", () => {
    const session = getDemoSession();

    expect(() => updateSessionCreditLimit(session, 0)).toThrow();
    expect(() => updateSessionCreditLimit(session, -1)).toThrow();
  });
});
