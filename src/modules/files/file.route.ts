import { Router } from 'express';
import multer from 'multer';
import { validateRequest } from '../../common/middleware/validate.js';
import { config } from '../../config/index.js';
import type { FileStorage } from '../../infrastructure/storage/file-storage.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import type { AuthorizationRepository } from '../authorization/authorization.repository.js';
import { createFileController } from './file.controller.js';
import type { FileRepository } from './file.repository.js';
import { FileIdParamsSchema, ListFilesQuerySchema } from './file.schema.js';
import { FileService } from './file.service.js';

export function createFileRouter(
  repository: FileRepository,
  storage: FileStorage,
  authService: AuthService,
  authorizationRepository: AuthorizationRepository,
): Router {
  const router = Router();
  const controller = createFileController(new FileService(repository, storage));
  const authenticate = createRequireAuthentication(authService);
  const authorize = (permissionName: string) =>
    requirePermission(authorizationRepository, permissionName);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: config.FILE_UPLOAD_MAX_BYTES },
  });

  router.get(
    '/',
    authenticate,
    authorize('file.index'),
    validateRequest({ query: ListFilesQuerySchema }),
    controller.list,
  );
  router.post('/', authenticate, authorize('file.store'), upload.single('file'), controller.upload);
  router.get(
    '/:id',
    authenticate,
    authorize('file.show'),
    validateRequest({ params: FileIdParamsSchema }),
    controller.show,
  );
  router.get(
    '/:id/download',
    authenticate,
    authorize('file.download'),
    validateRequest({ params: FileIdParamsSchema }),
    controller.download,
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('file.destroy'),
    validateRequest({ params: FileIdParamsSchema }),
    controller.remove,
  );

  return router;
}
