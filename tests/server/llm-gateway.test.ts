import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

const SAFE_ENDPOINT = {
  baseUrl: "https://api.example.com/v1",
  model: "demo-model",
  capability: "structured",
} as const;

describe("LLM gateway low-bar D-stage contract", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: "test" }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("无 key 时不服务组内排序推荐", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/group-ranking",
      payload: {
        llm: { endpoint: SAFE_ENDPOINT },
        input: { groupSectionIds: { group_a: ["sec_1"] } },
        output: {
          groupRankings: [{ groupId: "group_a", orderedSectionIds: ["sec_1"], reasons: [] }],
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ errorCode: ErrorCodes.LLM_KEY_MISSING });
  });

  it.each([
    ["http://api.example.com/v1", ErrorCodes.LLM_ENDPOINT_NOT_HTTPS],
    ["https://localhost/v1", ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF],
  ])("拒绝不安全 endpoint：%s", async (baseUrl, errorCode) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/capability-check",
      payload: {
        llm: {
          apiKey: "sk-test",
          endpoint: { ...SAFE_ENDPOINT, baseUrl },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode });
  });

  it("结构化输出 schema 失败时返回 LLM_SCHEMA_INVALID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/group-ranking",
      payload: {
        llm: { apiKey: "sk-test", endpoint: SAFE_ENDPOINT },
        input: { groupSectionIds: { group_a: ["sec_1"] } },
        output: {
          groupRankings: [{ groupId: "group_a", orderedSectionIds: [], reasons: [] }],
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errorCode: ErrorCodes.LLM_SCHEMA_INVALID });
  });

  it("组内排序返回输入集合外 sectionId 时返回 LLM_ID_OUT_OF_INPUT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/group-ranking",
      payload: {
        llm: { apiKey: "sk-test", endpoint: SAFE_ENDPOINT },
        input: { groupSectionIds: { group_a: ["sec_1"] } },
        output: {
          groupRankings: [{ groupId: "group_a", orderedSectionIds: ["sec_2"], reasons: [] }],
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errorCode: ErrorCodes.LLM_ID_OUT_OF_INPUT });
  });

  it("Top10 方案比较返回输入集合外 planId 时返回 LLM_ID_OUT_OF_INPUT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/plan-comparison",
      payload: {
        llm: { apiKey: "sk-test", endpoint: SAFE_ENDPOINT },
        input: { planIds: ["plan_1", "plan_2"] },
        output: {
          chosenPlanId: "plan_3",
          ranking: ["plan_3", "plan_1"],
          reasons: ["demo"],
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errorCode: ErrorCodes.LLM_ID_OUT_OF_INPUT });
  });

  it("缺少输入 sectionId 集合时不放行组内排序 ID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/group-ranking",
      payload: {
        llm: { apiKey: "sk-test", endpoint: SAFE_ENDPOINT },
        output: {
          groupRankings: [{ groupId: "group_a", orderedSectionIds: ["sec_1"], reasons: [] }],
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errorCode: ErrorCodes.LLM_ID_OUT_OF_INPUT });
  });

  it("缺少 Top10 planId 集合时不放行方案比较 ID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/plan-comparison",
      payload: {
        llm: { apiKey: "sk-test", endpoint: SAFE_ENDPOINT },
        output: {
          chosenPlanId: "plan_1",
          ranking: ["plan_1"],
          reasons: ["demo"],
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errorCode: ErrorCodes.LLM_ID_OUT_OF_INPUT });
  });

  it("合法结构化组内排序只返回校验后的结构化结果", async () => {
    const output = {
      groupRankings: [{ groupId: "group_a", orderedSectionIds: ["sec_1"], reasons: ["低冲突"] }],
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/llm/group-ranking",
      payload: {
        llm: { apiKey: "sk-test", endpoint: SAFE_ENDPOINT },
        input: { groupSectionIds: { group_a: ["sec_1", "sec_2"] } },
        output,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, task: "group-ranking", output });
  });
});
