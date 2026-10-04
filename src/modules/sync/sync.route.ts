import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createSyncController } from './sync.controller.js';
import type { SyncRepository } from './sync.repository.js';
import { PullQuerySchema, PushBodySchema } from './sync.schema.js';
import { SyncService } from './sync.service.js';

export function createSyncRouter(repository: SyncRepository, authService: AuthService): Router {
  const router = Router();
  const controller = createSyncController(new SyncService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/pull', validateRequest({ query: PullQuerySchema }), controller.pull);
  router.post('/push', validateRequest({ body: PushBodySchema }), controller.push);
  return router;
}
