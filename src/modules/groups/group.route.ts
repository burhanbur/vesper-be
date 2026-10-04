import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { sendError } from '../../common/http/api-response.js';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createGroupController } from './group.controller.js';
import type { GroupRepository } from './group.repository.js';
import { GroupService } from './group.service.js';
import {
  CreateGroupSchema,
  JoinGroupSchema,
  GroupPageSchema,
  GroupParamsSchema,
  GroupAccountSchema,
  GroupMappingSchema,
  GroupCategoryParamsSchema,
  CreateGroupCategorySchema,
  PatchGroupCategorySchema,
  ManageGroupCategorySchema,
  GroupReportQuerySchema,
} from './group.schema.js';

export function createGroupRouter(repository: GroupRepository, authService: AuthService): Router {
  const router = Router();
  const controller = createGroupController(new GroupService(repository));
  router.use(createRequireAuthentication(authService));
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  const joinLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (request, response) =>
      sendError(request, response, {
        statusCode: 429,
        message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
      }),
  });
  router.get('/', validateRequest({ query: GroupPageSchema }), controller.list);
  router.post('/', validateRequest({ body: CreateGroupSchema }), controller.create);
  router.post(
    '/:id/join',
    joinLimit,
    validateRequest({ params: GroupParamsSchema, body: JoinGroupSchema }),
    controller.join,
  );
  router.get(
    '/:id/members',
    validateRequest({ params: GroupParamsSchema, query: GroupPageSchema }),
    controller.members,
  );
  router.post(
    '/:id/accounts',
    validateRequest({ params: GroupParamsSchema, body: GroupAccountSchema }),
    controller.share(false),
  );
  router.delete(
    '/:id/accounts',
    validateRequest({ params: GroupParamsSchema, body: GroupAccountSchema }),
    controller.share(true),
  );
  router.get(
    '/:id/categories',
    validateRequest({ params: GroupParamsSchema, query: GroupPageSchema }),
    controller.categories,
  );
  router.post(
    '/:id/categories',
    validateRequest({ params: GroupParamsSchema, body: CreateGroupCategorySchema }),
    controller.createCategory,
  );
  router.patch(
    '/:id/categories',
    validateRequest({ params: GroupParamsSchema, body: PatchGroupCategorySchema }),
    controller.changeCategory(false),
  );
  router.delete(
    '/:id/categories',
    validateRequest({ params: GroupParamsSchema, body: ManageGroupCategorySchema }),
    controller.changeCategory(true),
  );
  router.post(
    '/:id/categories/:gcId/mapping',
    validateRequest({ params: GroupCategoryParamsSchema, body: GroupMappingSchema }),
    controller.mapping(false),
  );
  router.delete(
    '/:id/categories/:gcId/mapping',
    validateRequest({ params: GroupCategoryParamsSchema, body: GroupMappingSchema }),
    controller.mapping(true),
  );
  router.get(
    '/:id/category-report',
    validateRequest({ params: GroupParamsSchema, query: GroupReportQuerySchema }),
    controller.report,
  );
  return router;
}
