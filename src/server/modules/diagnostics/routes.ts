import type { FastifyInstance } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";

/**
 * diagnostics 模块（负责人；docs/08 §5.1）。
 *
 * 定位：结构化日志与本地诊断导出。
 * 边界：不记录隐私字段；默认不外发远程遥测。
 * 成功判据：Task 6 门禁 —— 日志导出不含敏感字段（docs/05 §5.1 日志断言）。
 */
export async function diagnosticsRoutes(app: FastifyInstance): Promise<void> {
  // TODO(Task 6, 负责人): 诊断导出 —— 汇集最近 N 条 log.v1 事件供用户主动下载。
  app.get("/export", async (_request, reply) => {
    return reply.code(501).send({
      errorCode: ErrorCodes.COMMON_NOT_IMPLEMENTED,
      message: "诊断导出未实现（Task 6）",
    });
  });
}
