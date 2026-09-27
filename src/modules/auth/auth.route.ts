import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import type { AppConfig } from '../../config/env.js';
import { createAuthController } from './auth.controller.js';
import { createRequireAuthentication } from './auth.middleware.js';
import { createLoginRateLimit, createRefreshRateLimit } from './auth-rate-limit.js';
import { LoginSchema, RefreshTokenSchema } from './auth.schema.js';
import type { AuthSessionStore } from './auth-session.store.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import type { AuthUserRepository } from './auth-user.repository.js';

export function createAuthService(
  repository: AuthUserRepository,
  sessionStore: AuthSessionStore,
  config: AppConfig,
): AuthService {
  const tokenService = new AuthTokenService({
    accessSecret: config.JWT_ACCESS_SECRET,
    refreshSecret: config.JWT_REFRESH_SECRET,
    issuer: config.AUTH_JWT_ISSUER,
    audience: config.AUTH_JWT_AUDIENCE,
  });
  return new AuthService({ repository, sessionStore, tokenService, options: config });
}

export function createAuthRouter(service: AuthService, config: AppConfig): Router {
  const router = Router();
  const controller = createAuthController(service);
  const requireAuthentication = createRequireAuthentication(service);

  router.post(
    '/login',
    createLoginRateLimit(config),
    validateRequest({ body: LoginSchema }),
    controller.login,
  );
  router.post(
    '/refresh',
    createRefreshRateLimit(config),
    validateRequest({ body: RefreshTokenSchema }),
    controller.refresh,
  );
  router.post('/logout', requireAuthentication, controller.logout);
  router.get('/me', requireAuthentication, controller.me);

  return router;
}
