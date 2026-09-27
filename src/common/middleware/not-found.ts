import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';

export function notFound(request: Request, _response: Response, next: NextFunction): void {
  next(
    new AppError({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `Rute ${request.method} ${request.path} tidak ditemukan.`,
    }),
  );
}
