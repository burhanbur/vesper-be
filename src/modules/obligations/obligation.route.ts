import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ObligationRepository } from './obligation.repository.js';
import { createObligationController } from './obligation.controller.js';
import { ObligationHttpCommandSchema, ObligationIdParamsSchema } from './obligation.schema.js';

export function createObligationRouter(
  repository: ObligationRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createObligationController(repository);
  router.use(createRequireAuthentication(authService));
  router.get('/', controller.list);
  router.get(
    '/:id/events',
    validateRequest({ params: ObligationIdParamsSchema }),
    controller.events,
  );
  router.post(
    '/commands',
    validateRequest({ body: ObligationHttpCommandSchema }),
    controller.command,
  );
  return router;
}
