import { AppError } from '../../common/errors/app-error.js';
import type { PaginatedData } from '../../common/http/api-response.js';
import type { NotificationRepository } from './notification.repository.js';
import type { ListNotificationsQuery, NotificationDto } from './notification.schema.js';
import { toNotificationDto } from './notification.types.js';

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<PaginatedData<NotificationDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toNotificationDto),
      pagination: {
        total,
        per_page: query.limit,
        current_page: query.page,
        last_page: Math.max(1, Math.ceil(total / query.limit)),
        from: items.length ? offset + 1 : null,
        to: items.length ? offset + items.length : null,
      },
    };
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const notification = await this.repository.markRead(userId, id);
    if (!notification) {
      throw new AppError({
        statusCode: 404,
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notifikasi tidak ditemukan.',
      });
    }
    return toNotificationDto(notification);
  }
}
