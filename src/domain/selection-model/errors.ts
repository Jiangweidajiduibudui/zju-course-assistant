import { ErrorCodes } from "../../shared/contracts/errors.js";

/**
 * 脚手架约定：未实现的领域函数一律抛出 NotImplementedError，
 * 绝不返回假结果冒充真实实现（docs/08 §2-7：不用 mock 结果伪装正式推荐）。
 * 实现完成后删除对应 throw，并同步把 tests/domain 中的 it.todo 变成真实测试。
 */
export class NotImplementedError extends Error {
  readonly errorCode = ErrorCodes.COMMON_NOT_IMPLEMENTED;

  constructor(fn: string, taskRef: string) {
    super(`NotImplemented: ${fn}（实现排期见 docs/08 ${taskRef}）`);
    this.name = "NotImplementedError";
  }
}
