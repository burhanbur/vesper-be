import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createAccountController } from './account.controller.js';
import type { AccountRepository } from './account.repository.js';
import {
  AccountIdParamsSchema,
  CreateAccountSchema,
  DeleteAccountQuerySchema,
  ListAccountsQuerySchema,
  UpdateAccountSchema,
} from './account.schema.js';
import { AccountService } from './account.service.js';

export function createAccountRouter(
  repository: AccountRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createAccountController(new AccountService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListAccountsQuerySchema }), controller.list);
  router.post('/', validateRequest({ body: CreateAccountSchema }), controller.create);
  router.patch(
    '/:id',
    validateRequest({ params: AccountIdParamsSchema, body: UpdateAccountSchema }),
    controller.update,
  );
  router.delete(
    '/:id',
    validateRequest({ params: AccountIdParamsSchema, query: DeleteAccountQuerySchema }),
    controller.remove,
  );
  return router;
}
