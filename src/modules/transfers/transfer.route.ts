import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createTransferController } from './transfer.controller.js';
import type { TransferRepository } from './transfer.repository.js';
import { CreateTransferSchema } from './transfer.schema.js';
import { TransferService } from './transfer.service.js';

export function createTransferRouter(
  repository: TransferRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createTransferController(new TransferService(repository));
  router.use(createRequireAuthentication(authService));
  router.post('/', validateRequest({ body: CreateTransferSchema }), controller.create);
  return router;
}
