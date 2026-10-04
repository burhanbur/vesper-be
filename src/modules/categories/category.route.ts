import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createCategoryController } from './category.controller.js';
import type { CategoryRepository } from './category.repository.js';
import {
  CategoryIdParamsSchema,
  CreateCategorySchema,
  DeleteCategoryQuerySchema,
  ListCategoriesQuerySchema,
  UpdateCategorySchema,
} from './category.schema.js';
import { CategoryService } from './category.service.js';

export function createCategoryRouter(
  repository: CategoryRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createCategoryController(new CategoryService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListCategoriesQuerySchema }), controller.list);
  router.post('/', validateRequest({ body: CreateCategorySchema }), controller.create);
  router.patch(
    '/:id',
    validateRequest({ params: CategoryIdParamsSchema, body: UpdateCategorySchema }),
    controller.update,
  );
  router.delete(
    '/:id',
    validateRequest({ params: CategoryIdParamsSchema, query: DeleteCategoryQuerySchema }),
    controller.remove,
  );
  return router;
}
