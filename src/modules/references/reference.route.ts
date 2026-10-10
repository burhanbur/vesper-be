import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createReferenceController } from './reference.controller.js';
import type { ReferenceRepository } from './reference.repository.js';
import {
    ListRefAccountTypesQuerySchema,
    ListRefCategoriesQuerySchema,
} from './reference.schema.js';
import { ReferenceService } from './reference.service.js';

export function createReferenceRouter(
    repository: ReferenceRepository,
    authService: AuthService,
): Router {
    const router = Router();
    const controller = createReferenceController(new ReferenceService(repository));
    const authenticate = createRequireAuthentication(authService);
    router.get(
        '/ref-account-types',
        authenticate,
        validateRequest({ query: ListRefAccountTypesQuerySchema }),
        controller.listAccountTypes,
    );
    router.get(
        '/ref-categories',
        authenticate,
        validateRequest({ query: ListRefCategoriesQuerySchema }),
        controller.listCategories,
    );
    return router;
}
