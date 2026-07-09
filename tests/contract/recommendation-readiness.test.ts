import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSessionDraft } from "../../src/client/features/import-export/sessionDraft.js";
import { getRecommendationReadiness } from "../../src/client/features/session/recommendationReadiness.js";
import { updateSessionCreditLimit } from "../../src/client/features/session/sessionRules.js";
import { catalogSchema } from "../../src/shared/contracts/index.js";

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

describe("生成推荐前置状态", () => {
  it("未填写学分上限时提示用户前置未完成，且不允许生成", () => {
    const readiness = getRecommendationReadiness(getDemoSession());

    expect(readiness.userPrerequisitesMet).toBe(false);
    expect(readiness.canGenerateRecommendation).toBe(false);
    expect(readiness.summary).toBe("还缺 1 项用户前置：学分上限");
    expect(readiness.items).toEqual([
      { id: "session", label: "Session 已创建", state: "ready", detail: "合成 Demo session" },
      {
        id: "creditLimit",
        label: "学分上限",
        state: "missing",
        detail: "请先在设置页填写学分上限",
      },
      {
        id: "pool",
        label: "待选池已准备",
        state: "ready",
        detail: "3 门课程 / 5 个候选教学班",
      },
      {
        id: "llmConfig",
        label: "LLM/key 配置",
        state: "blocked",
        detail: "尚未配置 LLM key 或完成能力检测；当前不会调用后端生成推荐",
      },
      {
        id: "selectionModel",
        label: "selection-model/planner 接入",
        state: "blocked",
        detail: "等待 Task 1/Task 6 接入后才能真正生成推荐",
      },
    ]);
  });

  it("用户前置齐备后仍明确等待 selection-model，而不是假装可生成", () => {
    const session = updateSessionCreditLimit(getDemoSession(), 18);
    const readiness = getRecommendationReadiness(session);

    expect(readiness.userPrerequisitesMet).toBe(true);
    expect(readiness.canGenerateRecommendation).toBe(false);
    expect(readiness.summary).toBe(
      "用户前置已完成；生成推荐暂不可用：LLM/key 未配置，且等待 selection-model 接入",
    );
    expect(readiness.items.find((item) => item.id === "creditLimit")).toEqual({
      id: "creditLimit",
      label: "学分上限已填写",
      state: "ready",
      detail: "18 学分",
    });
  });

  it("用户前置齐备但 LLM/key 未配置时给出明确降级原因", () => {
    const session = updateSessionCreditLimit(getDemoSession(), 18);
    const readiness = getRecommendationReadiness(session);

    expect(readiness.canGenerateRecommendation).toBe(false);
    expect(readiness.summary).toBe(
      "用户前置已完成；生成推荐暂不可用：LLM/key 未配置，且等待 selection-model 接入",
    );
    expect(readiness.items).toContainEqual({
      id: "llmConfig",
      label: "LLM/key 配置",
      state: "blocked",
      detail: "尚未配置 LLM key 或完成能力检测；当前不会调用后端生成推荐",
    });
  });
});
