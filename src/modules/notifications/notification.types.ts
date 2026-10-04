import type { Notification } from '../../generated/prisma/client.js';
import { NotificationDtoSchema, type NotificationDto } from './notification.schema.js';

export type NotificationRecord = Notification;

export function toNotificationDto(notification: NotificationRecord): NotificationDto {
  return NotificationDtoSchema.parse({
    id: notification.id,
    user_id: notification.userId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    metadata: notification.metadata,
    is_read: notification.isRead,
    read_at: notification.readAt?.toISOString() ?? null,
    created_at: notification.createdAt.toISOString(),
    updated_at: notification.updatedAt.toISOString(),
  });
}
