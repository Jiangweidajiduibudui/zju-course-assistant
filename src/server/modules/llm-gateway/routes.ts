import type { FastifyInstance, FastifyReply } from "fastify";
import * as z from "zod";
import { type ApiError, ErrorCodes } from "../../../shared/contracts/errors.js";
import { type LlmEndpointConfig, llmEndpointConfigSchema } from "../../../shared/contracts/llm.js";
import { checkEndpointUrl } from "./ssrf-guard.js";
import {
  type StructuredOutputContext,
  type StructuredTask,
  validateStructuredOutput,
} from "./structured-output.js";

/**
 * llm-gateway 模块路由（组员 D；docs/08 §5.1）。
 *
 * 定位：同源 OpenAI 兼容代理、SSRF 防护、结构化输出校验、能力检测。
 * 边界（铁律）：
 * - 前端不直连模型端点，一切 LLM 请求走这里（D40）；
 * - key 只随单次请求进入内存：不落库、不写日志、不进提示词（D40、D04）；
 * - LLM 输出必须过 Zod Schema（src/shared/contracts/llm.ts）；失败即任务失败，
 *   不从自然语言猜测结果（D25）；
 * - 提示词装配用字段白名单（出站过滤器），姓名/学号/Cookie/token/key 永不进入（D04）。
 *
 * 成功判据：Task 4 门禁 —— 无 key 不生成推荐；SSRF 样例被拒；
 * LLM 返回不存在 ID 时不改状态（docs/05 §1 LLM 网关安全 + §4 评测集）。
 */
export async function llmGatewayRoutes(app: FastifyInstance): Promise<void> {
  app.post("/capability-check", async (req, reply) => {
    const preflight = preflightLlmRequest(req.body, { requireStructuredCapability: false });
    if (!preflight.ok) {
      return sendError(reply, preflight.statusCode, preflight.error);
    }

    return reply.send({
      ok: true,
      endpointAllowed: true,
      // 低门槛 D 阶段只做本地配置/安全预检，不伪造真实上游探测结论。
      checked: "local-config-only",
      capability: preflight.endpoint.capability,
    });
  });

  registerStructuredTaskRoute(app, "/review-summary", "review-summary");
  registerStructuredTaskRoute(app, "/group-ranking", "group-ranking");
  registerStructuredTaskRoute(app, "/plan-comparison", "plan-comparison");
  registerStructuredTaskRoute(app, "/preference", "preference");
  registerStructuredTaskRoute(app, "/explain", "explain");
}

const llmEnvelopeSchema = z
  .object({
    llm: z
      .object({
        apiKey: z.string().optional(),
        endpoint: llmEndpointConfigSchema.optional(),
      })
      .optional(),
    apiKey: z.string().optional(),
    endpoint: llmEndpointConfigSchema.optional(),
    input: z
      .object({
        groupSectionIds: z.record(z.string(), z.array(z.string().min(1))).optional(),
        allowedSectionIds: z.array(z.string().min(1)).optional(),
        planIds: z.array(z.string().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    output: z.unknown().optional(),
    rawOutput: z.unknown().optional(),
  })
  .passthrough();

type LlmEnvelope = z.infer<typeof llmEnvelopeSchema>;

type PreflightResult =
  | { ok: true; body: LlmEnvelope; endpoint: LlmEndpointConfig; apiKey: string }
  | { ok: false; statusCode: number; error: ApiError };

function registerStructuredTaskRoute(
  app: FastifyInstance,
  path: string,
  task: StructuredTask,
): void {
  app.post(path, async (req, reply) => {
    const preflight = preflightLlmRequest(req.body, { requireStructuredCapability: true });
    if (!preflight.ok) {
      return sendError(reply, preflight.statusCode, preflight.error);
    }

    const output = preflight.body.output ?? preflight.body.rawOutput;
    const validated = validateStructuredOutput(
      task,
      output,
      extractStructuredContext(preflight.body),
    );
    if (!validated.ok) {
      return sendError(reply, 422, {
        errorCode: validated.errorCode,
        message: validated.message,
        details: validated.details,
      });
    }

    return reply.send({ ok: true, task, output: validated.output });
  });
}

function preflightLlmRequest(
  rawBody: unknown,
  options: { requireStructuredCapability: boolean },
): PreflightResult {
  const parsed = llmEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      error: {
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "LLM 请求体不符合网关 envelope",
        details: z.treeifyError(parsed.error),
      },
    };
  }

  const endpoint = parsed.data.llm?.endpoint ?? parsed.data.endpoint;
  if (endpoint === undefined) {
    return {
      ok: false,
      statusCode: 400,
      error: {
        errorCode: ErrorCodes.COMMON_VALIDATION_FAILED,
        message: "缺少 LLM endpoint 配置",
      },
    };
  }

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

  const apiKey = (parsed.data.llm?.apiKey ?? parsed.data.apiKey ?? "").trim();
  if (apiKey.length === 0) {
    return {
      ok: false,
      statusCode: 401,
      error: {
        errorCode: ErrorCodes.LLM_KEY_MISSING,
        message: "未配置 LLM key，推荐类任务不可用",
      },
    };
  }

  if (options.requireStructuredCapability && endpoint.capability !== "structured") {
    return {
      ok: false,
      statusCode: 409,
      error: {
        errorCode: ErrorCodes.LLM_CAPABILITY_INSUFFICIENT,
        message: "当前端点未声明支持结构化输出",
      },
    };
  }

  return { ok: true, body: parsed.data, endpoint, apiKey };
}

function extractStructuredContext(body: LlmEnvelope): StructuredOutputContext {
  return {
    groupSectionIds: body.input?.groupSectionIds,
    allowedSectionIds: body.input?.allowedSectionIds,
    planIds: body.input?.planIds,
  };
}

function sendError(reply: FastifyReply, statusCode: number, error: ApiError) {
  return reply.code(statusCode).send(error);
}
