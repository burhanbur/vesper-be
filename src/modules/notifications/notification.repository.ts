import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { ListNotificationsQuery } from './notification.schema.js';
import type { NotificationRecord } from './notification.types.js';

export interface NotificationRepository {
  list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<{ items: NotificationRecord[]; total: number }>;
  markRead(userId: string, id: string): Promise<NotificationRecord | null>;
}

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(userId: string, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.is_read === undefined ? {} : { isRead: query.is_read === 'true' }),
      ...(query.type === undefined ? {} : { type: query.type }),
    };
    const direction = query.sort === 'created_at' ? 'asc' : 'desc';
    const [items, total] = await this.client.$transaction(
      [
        this.client.notification.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: direction }, { id: direction }],
        }),
        this.client.notification.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }

  async markRead(userId: string, id: string): Promise<NotificationRecord | null> {
    return this.client.$transaction(async (transaction) => {
      // The conditional write serializes competing readers without overwriting the first timestamp.
      await transaction.notification.updateMany({
        where: { id, userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });
      return transaction.notification.findFirst({ where: { id, userId } });
    });
  }
}
