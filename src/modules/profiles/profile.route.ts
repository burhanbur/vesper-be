import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createProfileController } from './profile.controller.js';
import type { ProfileRepository } from './profile.repository.js';
import { PatchProfileSchema } from './profile.schema.js';
import { ProfileService } from './profile.service.js';

export function createProfileRouter(
  repository: ProfileRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createProfileController(new ProfileService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', controller.get);
  router.patch('/', validateRequest({ body: PatchProfileSchema }), controller.patch);
  return router;
}
