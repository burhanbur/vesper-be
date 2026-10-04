import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createAccountTypeController } from './account-type.controller.js';
import type { AccountTypeRepository } from './account-type.repository.js';
import {
  AccountTypeIdParamsSchema,
  CreateAccountTypeSchema,
  DeleteAccountTypeQuerySchema,
  ListAccountTypesQuerySchema,
  UpdateAccountTypeSchema,
} from './account-type.schema.js';
import { AccountTypeService } from './account-type.service.js';

export function createAccountTypeRouter(
  repository: AccountTypeRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createAccountTypeController(new AccountTypeService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListAccountTypesQuerySchema }), controller.list);
  router.post('/', validateRequest({ body: CreateAccountTypeSchema }), controller.create);
  router.patch(
    '/:id',
    validateRequest({ params: AccountTypeIdParamsSchema, body: UpdateAccountTypeSchema }),
    controller.update,
  );
  router.delete(
    '/:id',
    validateRequest({ params: AccountTypeIdParamsSchema, query: DeleteAccountTypeQuerySchema }),
    controller.remove,
  );
  return router;
}
