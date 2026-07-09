import type { FastifyInstance } from "fastify";
import { ErrorCodes } from "../../../shared/contracts/errors.js";

/**
 * chalaoshi 模块路由（组员 B；docs/08 §5.1）。
 *
 * 定位：限频抓取、解析、L1/L2 缓存、合成 seed fallback、来源标记。
 * 边界：只抓 docs/03 §3.1 列出的公开资源；把真实评论提交进仓库 fixture = 违规（D41）。
 * 成功判据：Task 3 门禁 —— 网络失败时 UI 不崩溃；seed 明确标记演示数据；
 * parser fixture tests、缓存命中测试、抓取失败降级测试全绿（docs/05 §1、§5.2）。
 *
 * 计划端点（Task 3 实现）：
 * - GET /api/chalaoshi/teachers?query=…      教师索引搜索（search.json）
 * - GET /api/chalaoshi/teacher/:id           教师详情（均绩分行、点名比例）
 * - GET /api/chalaoshi/teacher/:id/comments  近五年评论（预处理后供 LLM 摘要）
 */
export async function chalaoshiRoutes(app: FastifyInstance): Promise<void> {
  const notImplemented = { errorCode: ErrorCodes.COMMON_NOT_IMPLEMENTED, message: "Task 3 交付" };
  app.get("/teachers", async (_req, reply) => reply.code(501).send(notImplemented));
  app.get("/teacher/:id", async (_req, reply) => reply.code(501).send(notImplemented));
  app.get("/teacher/:id/comments", async (_req, reply) => reply.code(501).send(notImplemented));
}
