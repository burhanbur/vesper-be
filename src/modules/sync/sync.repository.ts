import { AppError } from '../../common/errors/app-error.js';
import { accessibleAccount } from '../../common/authorization/account-access.js';
import {
  canReadMetadata,
  syncClient,
  type SyncEntity,
} from '../../infrastructure/database/sync-publication.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { PrismaAccountTypeRepository } from '../account-types/account-type.repository.js';
import { PrismaAccountRepository } from '../accounts/account.repository.js';
import { PrismaCategoryRepository } from '../categories/category.repository.js';
import { PrismaTransactionRepository } from '../transactions/transaction.repository.js';
import { PrismaProfileRepository } from '../profiles/profile.repository.js';
import { toAccountTypeDto } from '../account-types/account-type.types.js';
import { toAccountDto } from '../accounts/account.types.js';
import { toCategoryDto } from '../categories/category.types.js';
import { toTransactionDto } from '../transactions/transaction.types.js';
import { toProfileDto } from '../profiles/profile.types.js';
import {
  CreateAccountTypeSchema,
  UpdateAccountTypeSchema,
} from '../account-types/account-type.schema.js';
import { CreateAccountSchema, UpdateAccountSchema } from '../accounts/account.schema.js';
import { CreateCategorySchema, UpdateCategorySchema } from '../categories/category.schema.js';
import {
  CreateTransactionSchema,
  UpdateTransactionSchema,
} from '../transactions/transaction.schema.js';
import { PatchProfileSchema } from '../profiles/profile.schema.js';
import type { PullQuery, PushItem } from './sync.schema.js';

function fail(statusCode: number, message: string): never {
  throw new AppError({ statusCode, code: 'SYNC_MUTATION_REJECTED', message });
}
export type SyncData = Record<string, unknown>;
/** Repositories already own validation and persistence rules. Within a push item their
 * transaction callback runs on the existing transaction, never a nested transaction.
 * The cast is limited to that adapter; only mutation methods are invoked on it. */
function transactionClient(tx: Prisma.TransactionClient): PrismaClient {
  return new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction')
        return (operation: (inner: Prisma.TransactionClient) => Promise<unknown>) => operation(tx);
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  }) as PrismaClient;
}

export class SyncRepository {
  constructor(private readonly client: PrismaClient) {}

  private async device(tx: Prisma.TransactionClient, userId: string, id: string): Promise<void> {
    if (!(await tx.device.findFirst({ where: { id, userId }, select: { id: true } })))
      fail(404, 'Perangkat tidak ditemukan.');
  }

  async data(
    tx: Prisma.TransactionClient,
    userId: string,
    entity: SyncEntity,
    id: string,
    tombstone = false,
  ): Promise<SyncData | null> {
    if (entity === 'user_profiles') {
      if (id !== userId) return null;
      const record = await tx.userProfile.findUnique({ where: { userId } });
      return record && (tombstone || !record.deletedAt) ? toProfileDto(record) : null;
    }
    if (entity === 'accounts') {
      const record = await tx.account.findFirst({
        where: { id, ...(tombstone ? { userId } : accessibleAccount(userId)) },
      });
      return record ? toAccountDto(record) : null;
    }
    if (entity === 'transactions') {
      const record = await tx.transaction.findFirst({
        where: {
          id,
          account: accessibleAccount(userId),
          investmentTransaction: null,
          ...(tombstone ? {} : { deletedAt: null }),
        },
      });
      return record ? toTransactionDto(record) : null;
    }
    if (entity === 'account_types') {
      const record = await tx.accountType.findUnique({ where: { id } });
      if (
        !record ||
        (!tombstone && record.deletedAt) ||
        !(await canReadMetadata(tx, userId, record.userId, id))
      )
        return null;
      return toAccountTypeDto(record);
    }
    const record = await tx.category.findUnique({ where: { id } });
    if (
      !record ||
      (!tombstone && record.deletedAt) ||
      !(await canReadMetadata(tx, userId, record.userId))
    )
      return null;
    return toCategoryDto(record);
  }

  async pull(userId: string, input: PullQuery) {
    // ReadCommitted plus the global writer lock prevents both mixed authorization and
    // sequence/commit inversion. Payloads and the watermark are one coherent view.
    return syncClient(this.client, null, false).$transaction(async (tx) => {
      await this.device(tx, userId, input.device_id);
      const watermark =
        (await tx.syncChange.aggregate({ _max: { version: true } }))._max.version ?? 0n;
      const since = BigInt(input.since_version);
      if (since > watermark) fail(422, 'Cursor sinkronisasi melebihi versi server.');
      const events = await tx.syncChange.findMany({
        where: { userId, version: { gt: since, lte: watermark } },
        orderBy: { version: 'asc' },
        take: input.limit + 1,
      });
      const page = events.slice(0, input.limit);
      const changes = [];
      for (const event of page) {
        const entity = event.entityType;
        if (
          !['account_types', 'accounts', 'categories', 'transactions', 'user_profiles'].includes(
            entity,
          )
        )
          throw new Error('Invalid persisted sync entity');
        // Persisted entity types are constrained by the migration and publication helper.
        const payload = await this.data(tx, userId, entity as SyncEntity, event.entityId);
        changes.push({
          entity_type: entity,
          entity_id: event.entityId,
          operation: payload ? (event.operation === 'CREATE' ? 'CREATE' : 'UPDATE') : 'DELETE',
          version: event.version.toString(),
          payload,
        });
      }
      const hasMore = events.length > input.limit;
      const next = hasMore ? (page.at(-1)?.version ?? since) : watermark;
      // Delivery cursor, not acknowledgement. Explicit since_version always controls replay.
      await tx.device.updateMany({
        where: { id: input.device_id, userId, lastSyncVersion: { lt: next } },
        data: { lastSyncVersion: next, lastSyncAt: new Date() },
      });
      await tx.device.update({ where: { id: input.device_id }, data: { lastSeenAt: new Date() } });
      return {
        changes,
        next_version: next.toString(),
        watermark: watermark.toString(),
        has_more: hasMore,
      };
    });
  }

  async assertDevice(userId: string, id: string): Promise<void> {
    await this.device(this.client, userId, id);
  }

  async apply(userId: string, deviceId: string, item: PushItem) {
    return syncClient(this.client, deviceId).$transaction(async (tx) => {
      await this.device(tx, userId, deviceId);
      const version = item.client_version;
      const before = await this.data(tx, userId, item.entity_type, item.entity_id, true);
      if (item.entity_type === 'user_profiles' && item.entity_id !== userId)
        fail(403, 'Profil hanya dapat diubah oleh pemilik.');
      if (item.entity_type !== 'transactions' && before && before.user_id !== userId)
        fail(403, 'Metadata hanya dapat diubah oleh pemilik.');
      if (
        item.entity_type === 'transactions' &&
        before &&
        (before.transfer_id !== null || before.category_id === null)
      )
        fail(422, 'Transaksi turunan harus dikelola melalui modul online.');
      const payload = item.payload;
      const same =
        before &&
        payload &&
        Object.entries(payload).every(([key, value]) => {
          if (key === 'amount' && typeof value === 'string' && typeof before.amount === 'string')
            return new Prisma.Decimal(value).equals(before.amount);
          if (
            key === 'transacted_at' &&
            typeof value === 'string' &&
            typeof before.transacted_at === 'string'
          )
            return new Date(value).getTime() === new Date(before.transacted_at).getTime();
          return before[key] === value;
        });
      const latestEvent = await tx.syncChange.findFirst({
        where: { userId, entityType: item.entity_type, entityId: item.entity_id },
        orderBy: { version: 'desc' },
      });
      const replay = latestEvent?.deviceId === deviceId && latestEvent.operation === item.operation;
      if (item.operation === 'CREATE') {
        if (version !== '0') fail(422, 'CREATE memerlukan client_version 0.');
        if (before) {
          if (same && !before.deleted_at && replay)
            return { status: 'applied' as const, server_data: before };
          return { status: 'conflict' as const, server_data: before };
        }
      } else if (item.entity_type !== 'user_profiles') {
        if (version === '0') fail(422, 'Versi perubahan harus lebih besar dari nol.');
        if (before?.version !== version) {
          const consecutive =
            before &&
            typeof before.version === 'string' &&
            BigInt(before.version) === BigInt(version) + 1n;
          const actor = item.entity_type !== 'transactions' || before?.updated_by === userId;
          if (
            consecutive &&
            actor &&
            replay &&
            ((item.operation === 'DELETE' && before?.deleted_at) || (same && !before?.deleted_at))
          )
            return { status: 'applied' as const, server_data: before };
          if (!before) fail(404, 'Data tidak ditemukan atau tidak dapat diakses.');
          return { status: 'conflict' as const, server_data: before };
        }
      } else if (
        (same && before && !before.deleted_at) ||
        (item.operation === 'DELETE' && before?.deleted_at && replay)
      )
        return { status: 'applied' as const, server_data: before };
      if (before?.deleted_at) return { status: 'conflict' as const, server_data: before };
      const client = transactionClient(tx);
      let result: unknown;
      switch (item.entity_type) {
        case 'account_types': {
          const repository = new PrismaAccountTypeRepository(client);
          result =
            item.operation === 'CREATE'
              ? await repository.create(
                  userId,
                  item.entity_id,
                  CreateAccountTypeSchema.parse(payload),
                )
              : item.operation === 'UPDATE'
                ? await repository.update(
                    userId,
                    item.entity_id,
                    UpdateAccountTypeSchema.parse({ ...payload, version }),
                  )
                : await repository.softDelete(userId, item.entity_id, BigInt(version));
          break;
        }
        case 'accounts': {
          const repository = new PrismaAccountRepository(client);
          result =
            item.operation === 'CREATE'
              ? await repository.create(userId, item.entity_id, CreateAccountSchema.parse(payload))
              : item.operation === 'UPDATE'
                ? await repository.update(
                    userId,
                    item.entity_id,
                    UpdateAccountSchema.parse({ ...payload, version }),
                  )
                : await repository.softDelete(userId, item.entity_id, BigInt(version));
          break;
        }
        case 'categories': {
          const repository = new PrismaCategoryRepository(client);
          result =
            item.operation === 'CREATE'
              ? await repository.create(userId, item.entity_id, CreateCategorySchema.parse(payload))
              : item.operation === 'UPDATE'
                ? await repository.update(
                    userId,
                    item.entity_id,
                    UpdateCategorySchema.parse({ ...payload, version }),
                  )
                : await repository.softDelete(userId, item.entity_id, BigInt(version));
          break;
        }
        case 'transactions': {
          const repository = new PrismaTransactionRepository(client);
          result =
            item.operation === 'CREATE'
              ? await repository.create(
                  userId,
                  item.entity_id,
                  CreateTransactionSchema.parse(payload),
                )
              : item.operation === 'UPDATE'
                ? await repository.update(
                    userId,
                    item.entity_id,
                    UpdateTransactionSchema.parse({ ...payload, version }),
                  )
                : await repository.softDelete(userId, item.entity_id, BigInt(version));
          break;
        }
        case 'user_profiles': {
          if (item.operation === 'DELETE') {
            if (!before) fail(404, 'Profil tidak ditemukan.');
            await tx.userProfile.update({ where: { userId }, data: { deletedAt: new Date() } });
          } else
            result = await new PrismaProfileRepository(client).patch(
              userId,
              PatchProfileSchema.parse(payload),
            );
          break;
        }
      }
      if (
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status !== 'applied'
      ) {
        if (result.status === 'missing') fail(404, 'Data tidak ditemukan.');
        return {
          status: 'conflict' as const,
          server_data: await this.data(tx, userId, item.entity_type, item.entity_id, true),
        };
      }
      return {
        status: 'applied' as const,
        server_data: await this.data(tx, userId, item.entity_type, item.entity_id, true),
      };
    });
  }
}
