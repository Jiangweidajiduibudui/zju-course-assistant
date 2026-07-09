import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { ErrorCodes } from "../../src/shared/contracts/errors.js";

describe("planner low-bar D-stage degradation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: "test" }));
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    "/api/planner/generate",
    "/api/planner/reoptimize",
  ])("%s 无 key 时不生成推荐且不返回方案", async (url) => {
    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        generationId: "gen_1",
        llm: {
          endpoint: {
            baseUrl: "https://api.example.com/v1",
            model: "demo",
            capability: "structured",
          },
        },
        session: { plan: { planId: "existing" } },
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(401);
    expect(body).toMatchObject({ errorCode: ErrorCodes.LLM_KEY_MISSING });
    expect(body).not.toHaveProperty("plan");
    expect(body).not.toHaveProperty("session");
  });
});
