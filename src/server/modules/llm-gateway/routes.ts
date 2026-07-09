import type { FastifyInstance } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";

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
 *
 * 计划端点（Task 4 实现）：
 * - POST /api/llm/capability-check   端点能力检测（D10）
 * - POST /api/llm/review-summary     评论摘要（纯展示，无状态通道，D24）
 * - POST /api/llm/group-ranking      组内排序（阶段③）
 * - POST /api/llm/plan-comparison    Top10 方案比较（阶段⑤）
 * - POST /api/llm/preference         偏好结构化（确认制）
 * - POST /api/llm/explain            解释
 */
export async function llmGatewayRoutes(app: FastifyInstance): Promise<void> {
  const notImplemented = { errorCode: ErrorCodes.COMMON_NOT_IMPLEMENTED, message: "Task 4 交付" };
  app.post("/capability-check", async (_req, reply) => reply.code(501).send(notImplemented));
  app.post("/review-summary", async (_req, reply) => reply.code(501).send(notImplemented));
  app.post("/group-ranking", async (_req, reply) => reply.code(501).send(notImplemented));
  app.post("/plan-comparison", async (_req, reply) => reply.code(501).send(notImplemented));
  app.post("/preference", async (_req, reply) => reply.code(501).send(notImplemented));
  app.post("/explain", async (_req, reply) => reply.code(501).send(notImplemented));
}
