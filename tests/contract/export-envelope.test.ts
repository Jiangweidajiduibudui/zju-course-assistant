import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExportEnvelope,
  formatExportEnvelopePreview,
} from "../../src/client/features/import-export/exportEnvelope.js";
import { buildDemoSessionDraft } from "../../src/client/features/import-export/sessionDraft.js";
import { updateSessionCreditLimit } from "../../src/client/features/session/sessionRules.js";
import { catalogSchema, exportEnvelopeSchema } from "../../src/shared/contracts/index.js";

const FIXTURES = join(import.meta.dirname, "../../docs/fixtures");

function getDemoSession() {
  const catalog = catalogSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, "demo-catalog.synthetic.json"), "utf8")),
  );
  return updateSessionCreditLimit(
    buildDemoSessionDraft(catalog, {
      id: "session-demo-test",
      name: "合成 Demo session",
      now: "2026-07-09T15:00:00.000+08:00",
    }),
    18,
  );
}

describe("export.v1 envelope 预览", () => {
  it("用当前 session 生成可校验的 export.v1 envelope", () => {
    const session = getDemoSession();
    const envelope = buildExportEnvelope(session, {
      exportedAt: "2026-07-09T16:00:00.000+08:00",
    });

    expect(() => exportEnvelopeSchema.parse(envelope)).not.toThrow();
    expect(envelope).toEqual({
      schemaVersion: "export.v1",
      exportedAt: "2026-07-09T16:00:00.000+08:00",
      session,
    });
  });

  it("格式化为稳定缩进的只读预览 JSON", () => {
    const envelope = buildExportEnvelope(getDemoSession(), {
      exportedAt: "2026-07-09T16:00:00.000+08:00",
    });

    expect(formatExportEnvelopePreview(envelope)).toContain('"schemaVersion": "export.v1"');
    expect(formatExportEnvelopePreview(envelope)).toContain('"name": "合成 Demo session"');
    expect(formatExportEnvelopePreview(envelope)).toContain('"creditLimit": 18');
    expect(formatExportEnvelopePreview(envelope)).toContain('\n  "exportedAt"');
  });
});
