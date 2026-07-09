import { describe, expect, it } from "vitest";
import { logEventSchema } from "../../src/shared/contracts/log.js";

/** log.v1 字段稳定性（D42；docs/08 §12）。 */
describe("日志契约 log.v1", () => {
  const valid = {
    ts: "2026-07-09T10:00:00.000+08:00",
    level: "info",
    requestId: "req_x",
    generationId: null,
    module: "selection-model",
    action: "final_validate",
    status: "ok",
    durationMs: 12,
    errorCode: null,
    schemaVersion: "log.v1",
  };

  it("示例事件（docs/08 §12）通过校验", () => {
    expect(logEventSchema.parse(valid)).toBeTruthy();
  });

  it("缺失必填字段（module）被拒绝", () => {
    const { module: _dropped, ...rest } = valid;
    expect(logEventSchema.safeParse(rest).success).toBe(false);
  });
});
