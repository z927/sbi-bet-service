import type { BaseResponse } from "./types.ts";

export class ConflictError extends Error {
  override readonly name = "ConflictError";
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

export const baseResponse = (message: string, statusCode: number): BaseResponse => {
  return { message, statusCode };
}
