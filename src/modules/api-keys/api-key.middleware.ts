import type { Request, RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { ApiKeyService } from './api-key.service.js';

export function readApiKeyHeader(request: Request): string | undefined {
  const header = request.header('X-API-Key') ?? request.headers['x-api-key'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  return undefined;
}

export function createRequireApiKey(service: ApiKeyService): RequestHandler {
  return async (request, response, next) => {
    try {
      const key = readApiKeyHeader(request);
      if (!key) {
        throw new AppError({
          statusCode: 401,
          code: 'API_KEY_REQUIRED',
          message: 'Header X-API-Key diperlukan untuk autentikasi.',
        });
      }

      const clientIp = request.ip ?? request.socket.remoteAddress ?? '';
      const principal = await service.validateKey(key, clientIp);
      response.locals.apiKey = principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}
