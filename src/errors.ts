import type { BaseResponse } from "./types.ts";

export class ConflictError extends Error {
  override readonly name = "ConflictError";
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

export function baseResponse(message: string, statusCode: number): BaseResponse {
  return { message, statusCode };
}
