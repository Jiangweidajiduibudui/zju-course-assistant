import type { z } from "zod";
import type { ErrorCode } from "../shared/contracts/common.js";
export class ServiceError extends Error {
  constructor(
    readonly code: z.infer<typeof ErrorCode>,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export const fail = (
  code: z.infer<typeof ErrorCode>,
  message: string,
): never => {
  throw new ServiceError(code, message);
};
