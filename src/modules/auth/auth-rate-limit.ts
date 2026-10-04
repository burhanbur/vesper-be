import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/env.js';
import { sendError } from '../../common/http/api-response.js';

function createAuthRateLimit(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (request, response) =>
      sendError(request, response, {
        statusCode: 429,
        message: 'Terlalu banyak percobaan autentikasi. Silakan coba lagi nanti.',
      }),
  });
}

export function createLoginRateLimit(config: AppConfig) {
  return createAuthRateLimit(
    config.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
    config.AUTH_LOGIN_RATE_LIMIT_MAX,
  );
}

export function createRegisterRateLimit(config: AppConfig) {
  return createAuthRateLimit(
    config.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
    config.AUTH_LOGIN_RATE_LIMIT_MAX,
  );
}

export function createRefreshRateLimit(config: AppConfig) {
  return createAuthRateLimit(
    config.AUTH_REFRESH_RATE_LIMIT_WINDOW_MS,
    config.AUTH_REFRESH_RATE_LIMIT_MAX,
  );
}
