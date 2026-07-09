import type { FastifyInstance, FastifyReply } from "fastify";
import * as z from "zod";
import { type ApiError, ErrorCodes } from "../../../shared/contracts/errors.js";
import { llmEndpointConfigSchema } from "../../../shared/contracts/llm.js";
import { checkEndpointUrl } from "../llm-gateway/ssrf-guard.js";

/**
 * planner 模块路由（负责人接入，依赖 C/D 的交付；docs/08 §5.1）。
 *
 * 定位：编排两阶段 LLM 与 selection-model（docs/04 §3.2 流水线①–⑦）。
 * 边界：不复制领域硬约束逻辑 —— 一切校验调用 selection-model。
 *
 * 编排顺序（阶段号对应 docs/04 §3.2）：
 * ① 输入装配（刷新 chalaoshi 数据，D20）→ ② 硬过滤（selection-model）
 * → ③ LLM 组内排序（llm-gateway）→ ④ Top10 枚举（selection-model）
 * → ⑤ LLM 方案比较（llm-gateway）→ ⑥ 终校验（selection-model.finalValidate）
 * → ⑦ 原子应用（全过才返回；失败/取消不改状态，D27）。
 *
 * 并发（D27）：请求携带递增 generationId；旧代际结果直接丢弃（PLAN_STALE_GENERATION）。
 * 成功判据：Task 4/6 门禁 —— 无 key 不生成推荐；校验失败不改状态；E2E 主流程绿。
 */
export async function plannerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/generate", async (req, reply) => handlePlannerEntrypoint(req.body, reply));
  app.post("/reoptimize", async (req, reply) => handlePlannerEntrypoint(req.body, reply));
}

const plannerEnvelopeSchema = z
  .object({
    llm: z
      .object({
        apiKey: z.string().optional(),
        endpoint: llmEndpointConfigSchema.optional(),
      })
      .optional(),
    apiKey: z.string().optional(),
    endpoint: llmEndpointConfigSchema.optional(),
  })
  .passthrough();

async function handlePlannerEntrypoint(rawBody: unknown, reply: FastifyReply) {
  const preflight = preflightPlannerRequest(rawBody);
  if (!preflight.ok) {
    return reply.code(preflight.statusCode).send(preflight.error);
  }

  return reply.code(501).send({
    errorCode: ErrorCodes.COMMON_NOT_IMPLEMENTED,
    message: "Planner 真实编排将在后续 Task 6 接入；D 阶段仅开放安全降级门禁",
  });
}

type PlannerPreflightResult = { ok: true } | { ok: false; statusCode: number; error: ApiError };

function preflightPlannerRequest(rawBody: unknown): PlannerPreflightResult {
  const parsed = plannerEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      error: {
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "Planner 请求体不符合 envelope",
        details: z.treeifyError(parsed.error),
      },
    };
  }

  const endpoint = parsed.data.llm?.endpoint ?? parsed.data.endpoint;
  if (endpoint !== undefined) {
    const endpointVerdict = checkEndpointUrl(endpoint.baseUrl);
    if (!endpointVerdict.allowed) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          errorCode: endpointVerdict.errorCode ?? ErrorCodes.LLM_ENDPOINT_BLOCKED_SSRF,
          message: endpointVerdict.reason ?? "LLM endpoint 被安全策略拒绝",
        },
      };
    }
  }

  const apiKey = (parsed.data.llm?.apiKey ?? parsed.data.apiKey ?? "").trim();
  if (apiKey.length === 0) {
    return {
      ok: false,
      statusCode: 401,
      error: {
        errorCode: ErrorCodes.LLM_KEY_MISSING,
        message: "未配置 LLM key，planner 不生成推荐",
      },
    };
  }

  return { ok: true };
}
