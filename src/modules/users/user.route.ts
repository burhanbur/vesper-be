import { Router } from 'express';
import multer from 'multer';
import { validateRequest } from '../../common/middleware/validate.js';
import { config } from '../../config/index.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import type { AuthorizationRepository } from '../authorization/authorization.repository.js';
import { createUserExcelController } from './user-excel.controller.js';
import { createUserExcelService } from './user-excel.service.js';
import { createUserController } from './user.controller.js';
import {
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  UserIdParamsSchema,
} from './user.schema.js';
import { UserService } from './user.service.js';
import type { UserRepository } from './user.repository.js';

export function createUserRouter(
  repository: UserRepository,
  authService: AuthService,
  authorizationRepository: AuthorizationRepository,
): Router {
  const router = Router();
  const controller = createUserController(new UserService(repository));
  const excelController = createUserExcelController(createUserExcelService(repository));
  const authenticate = createRequireAuthentication(authService);
  const authorize = (permissionName: string) =>
    requirePermission(authorizationRepository, permissionName);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: config.EXCEL_IMPORT_MAX_BYTES },
  });

  router.get(
    '/',
    authenticate,
    authorize('user.index'),
    validateRequest({ query: ListUsersQuerySchema }),
    controller.list,
  );
  router.get('/export', authenticate, authorize('user.index'), excelController.exportUsers);
  router.get(
    '/import/template',
    authenticate,
    authorize('user.create'),
    excelController.downloadTemplate,
  );
  router.post(
    '/import',
    authenticate,
    authorize('user.store'),
    upload.single('file'),
    excelController.importUsers,
  );
  router.get(
    '/:id',
    authenticate,
    authorize('user.index'),
    validateRequest({ params: UserIdParamsSchema }),
    controller.show,
  );
  router.post(
    '/',
    authenticate,
    authorize('user.store'),
    validateRequest({ body: CreateUserSchema }),
    controller.create,
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('user.update'),
    validateRequest({ params: UserIdParamsSchema, body: UpdateUserSchema }),
    controller.update,
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('user.destroy'),
    validateRequest({ params: UserIdParamsSchema }),
    controller.remove,
  );

  return router;
}
