import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createTransactionController } from './transaction.controller.js';
import type { TransactionRepository } from './transaction.repository.js';
import {
  CreateTransactionSchema,
  DeleteTransactionQuerySchema,
  ListTransactionsQuerySchema,
  TransactionIdParamsSchema,
  UpdateTransactionSchema,
} from './transaction.schema.js';
import { TransactionService } from './transaction.service.js';

export function createTransactionRouter(
  repository: TransactionRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createTransactionController(new TransactionService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListTransactionsQuerySchema }), controller.list);
  router.post('/', validateRequest({ body: CreateTransactionSchema }), controller.create);
  router.patch(
    '/:id',
    validateRequest({ params: TransactionIdParamsSchema, body: UpdateTransactionSchema }),
    controller.update,
  );
  router.delete(
    '/:id',
    validateRequest({ params: TransactionIdParamsSchema, query: DeleteTransactionQuerySchema }),
    controller.remove,
  );
  return router;
}
