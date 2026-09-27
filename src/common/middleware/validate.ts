import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';

export type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

export type ValidatedInput = {
  body?: unknown;
  params?: unknown;
  query?: unknown;
};

export function validateRequest(schemas: RequestSchemas) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const input: ValidatedInput = {};
    const errors: Record<string, unknown> = {};

    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key];
      if (!schema) {
        continue;
      }

      const result = schema.safeParse(request[key]);
      if (!result.success) {
        errors[key] = result.error.flatten();
      } else {
        input[key] = result.data;
      }
    }

    if (Object.keys(errors).length > 0) {
      next(
        new AppError({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: 'Validasi gagal. Silakan periksa kembali input Anda.',
          errors,
        }),
      );
      return;
    }

    response.locals.validated = input;
    next();
  };
}
