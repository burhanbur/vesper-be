import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createNotificationController } from './notification.controller.js';
import type { NotificationRepository } from './notification.repository.js';
import {
  ListNotificationsQuerySchema,
  MarkNotificationReadSchema,
  NotificationIdParamsSchema,
} from './notification.schema.js';
import { NotificationService } from './notification.service.js';

export function createNotificationRouter(
  repository: NotificationRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createNotificationController(new NotificationService(repository));
  router.use(createRequireAuthentication(authService));
  router.get('/', validateRequest({ query: ListNotificationsQuerySchema }), controller.list);
  router.patch(
    '/:id/read',
    validateRequest({
      params: NotificationIdParamsSchema,
      body: MarkNotificationReadSchema,
    }),
    controller.markRead,
  );
  return router;
}
