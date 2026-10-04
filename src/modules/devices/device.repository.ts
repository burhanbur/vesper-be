import { AppError } from '../../common/errors/app-error.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ListDevicesQuery, RegisterDeviceInput } from './device.schema.js';
import type { DeviceRecord } from './device.types.js';

export interface DeviceRepository {
  list(userId: string, query: ListDevicesQuery): Promise<{ items: DeviceRecord[]; total: number }>;
  register(
    userId: string,
    id: string,
    input: RegisterDeviceInput,
  ): Promise<{ device: DeviceRecord; created: boolean }>;
}

export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(userId: string, query: ListDevicesQuery) {
    const where = { userId };
    const direction = query.sort === 'created_at' ? 'asc' : 'desc';
    const [items, total] = await this.client.$transaction(
      [
        this.client.device.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: direction }, { id: direction }],
        }),
        this.client.device.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }

  async register(userId: string, id: string, input: RegisterDeviceInput) {
    return this.client.$transaction(async (transaction) => {
      const data = {
        name: input.name,
        platform: input.platform,
        appVersion: input.app_version,
        lastSeenAt: new Date(),
      };
      // ON CONFLICT DO NOTHING handles concurrent retries without ever changing ownership.
      const inserted = await transaction.device.createMany({
        data: [{ id, userId, ...data }],
        skipDuplicates: true,
      });
      const updated = await transaction.device.updateMany({ where: { id, userId }, data });
      if (updated.count !== 1) {
        throw new AppError({
          statusCode: 409,
          code: 'DEVICE_ID_UNAVAILABLE',
          message: 'ID perangkat tidak tersedia.',
        });
      }
      const device = await transaction.device.findFirst({ where: { id, userId } });
      if (!device) {
        throw new AppError({
          statusCode: 409,
          code: 'DEVICE_ID_UNAVAILABLE',
          message: 'ID perangkat tidak tersedia.',
        });
      }
      return { device, created: inserted.count === 1 };
    });
  }
}
