import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createBudgetController } from './budget.controller.js';
import type { BudgetRepository } from './budget.repository.js';
import {
  BudgetIdParamsSchema,
  BudgetProgressQuerySchema,
  CreateBudgetSchema,
  EmptyBudgetQuerySchema,
  ListBudgetsQuerySchema,
  UpdateBudgetSchema,
} from './budget.schema.js';
import { BudgetService } from './budget.service.js';

export function createBudgetRouter(repository: BudgetRepository, authService: AuthService): Router {
  const router = Router();
  const controller = createBudgetController(new BudgetService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListBudgetsQuerySchema }), controller.list);
  router.post(
    '/',
    validateRequest({ body: CreateBudgetSchema, query: EmptyBudgetQuerySchema }),
    controller.create,
  );
  router.patch(
    '/:id',
    validateRequest({
      params: BudgetIdParamsSchema,
      body: UpdateBudgetSchema,
      query: EmptyBudgetQuerySchema,
    }),
    controller.update,
  );
  router.delete(
    '/:id',
    validateRequest({ params: BudgetIdParamsSchema, query: EmptyBudgetQuerySchema }),
    controller.remove,
  );
  router.get(
    '/:id/progress',
    validateRequest({ params: BudgetIdParamsSchema, query: BudgetProgressQuerySchema }),
    controller.progress,
  );
  return router;
}
