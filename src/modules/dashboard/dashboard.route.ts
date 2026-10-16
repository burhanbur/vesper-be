import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createDashboardController } from './dashboard.controller.js';
import type { DashboardRepository } from './dashboard.repository.js';
import { DashboardSummaryQuerySchema } from './dashboard.schema.js';
import { DashboardService } from './dashboard.service.js';

export function createDashboardRouter(
  repository: DashboardRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createDashboardController(new DashboardService(repository));
  router.use(createRequireAuthentication(authService));
  router.get(
    '/summary',
    validateRequest({ query: DashboardSummaryQuerySchema }),
    controller.summary,
  );
  return router;
}
