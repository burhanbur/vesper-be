import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from './auth.service.js';

export function readBearerToken(request: Request): string | undefined {
  const authorization = request.get('authorization');
  if (!authorization) return undefined;

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token && !extra ? token : undefined;
}

export function createRequireAuthentication(service: AuthService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      response.locals.auth = await service.authenticate(readBearerToken(request));
      next();
    } catch (error) {
      next(error);
    }
  };
}
