import { AppError } from '../../common/errors/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PushItemSchema, type PullQuery, type PushBody, type PushResult } from './sync.schema.js';
import type { SyncRepository } from './sync.repository.js';

export class SyncService {
  constructor(private readonly repository: SyncRepository) {}
  pull(userId: string, query: PullQuery) {
    return this.repository.pull(userId, query);
  }
  async push(userId: string, body: PushBody) {
    await this.repository.assertDevice(userId, body.device_id);
    const results: PushResult[] = [];
    for (const [index, raw] of body.items.entries()) {
      const parsed = PushItemSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ index, status: 'rejected', message: 'Data perubahan tidak valid.' });
        continue;
      }
      const item = parsed.data;
      try {
        results.push({
          index,
          entity_id: item.entity_id,
          ...(await this.repository.apply(userId, body.device_id, item)),
        });
      } catch (error) {
        if (error instanceof AppError) {
          // Domain errors only attach server_data after an authorized lookup.
          const errors: unknown = error.errors;
          const serverData: unknown =
            errors && typeof errors === 'object' ? Reflect.get(errors, 'server_data') : undefined;
          results.push({
            index,
            entity_id: item.entity_id,
            status: error.statusCode === 409 ? 'conflict' : 'rejected',
            message: error.message,
            ...(serverData && typeof serverData === 'object' && !Array.isArray(serverData)
              ? { server_data: Object.fromEntries(Object.entries(serverData)) }
              : {}),
          });
        } else if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          results.push({
            index,
            entity_id: item.entity_id,
            status: 'conflict',
            message: 'ID data tidak tersedia.',
          });
        } else {
          // Unexpected infrastructure failures are not reported as successfully processed batches.
          throw error;
        }
      }
    }
    return { results };
  }
}
