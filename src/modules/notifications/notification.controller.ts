import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { ListNotificationsQuery, NotificationIdParams } from './notification.schema.js';
import type { NotificationService } from './notification.service.js';

export function createNotificationController(service: NotificationService) {
  const list: RequestHandler = async (request, response) => {
    // Authentication and validation middleware establish these local contracts.
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const query = validated.query as ListNotificationsQuery;
    const result = await service.list(principal.id, query);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Notifikasi berhasil diambil.',
    });
  };
  const markRead: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const params = validated.params as NotificationIdParams;
    const notification = await service.markRead(principal.id, params.id);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: notification,
      message: 'Notifikasi berhasil ditandai sebagai dibaca.',
    });
  };
  return { list, markRead };
}
