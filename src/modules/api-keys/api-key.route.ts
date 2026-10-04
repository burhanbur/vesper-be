import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createApiKeyController } from './api-key.controller.js';
import { createRequireApiKey } from './api-key.middleware.js';
import type { ApiKeyRepository } from './api-key.repository.js';
import {
  ApiKeyIdParamsSchema,
  CreateApiKeySchema,
  ListApiKeysQuerySchema,
  UpdateApiKeySchema,
} from './api-key.schema.js';
import { ApiKeyService } from './api-key.service.js';

export function createApiKeyRouter(repository: ApiKeyRepository, authService: AuthService): Router {
  const router = Router();
  const service = new ApiKeyService(repository);
  const controller = createApiKeyController(service);
  const requireAuth = createRequireAuthentication(authService);
  const requireApiKey = createRequireApiKey(service);

  // M2M authentication verification endpoint
  router.get('/verify', requireApiKey, controller.verifyM2m);

  // Management endpoints (requires user auth)
  router.get('/', requireAuth, validateRequest({ query: ListApiKeysQuerySchema }), controller.list);
  router.post('/', requireAuth, validateRequest({ body: CreateApiKeySchema }), controller.create);
  router.get(
    '/:id',
    requireAuth,
    validateRequest({ params: ApiKeyIdParamsSchema }),
    controller.getById,
  );
  router.patch(
    '/:id',
    requireAuth,
    validateRequest({
      params: ApiKeyIdParamsSchema,
      body: UpdateApiKeySchema,
    }),
    controller.update,
  );
  router.delete(
    '/:id',
    requireAuth,
    validateRequest({ params: ApiKeyIdParamsSchema }),
    controller.remove,
  );

  return router;
}
