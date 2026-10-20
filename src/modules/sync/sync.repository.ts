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
import { PrismaTransferRepository } from '../transfers/transfer.repository.js';
import { toTransferDto } from '../transfers/transfer.types.js';
import { PrismaInvestmentRepository } from '../investments/investment.repository.js';
import { toInvestmentDto } from '../investments/investment.types.js';
import { SyncEntitySchema, type PullQuery, type PushItem } from './sync.schema.js';
import { InvestmentRecoveryRepository } from './investment-recovery.repository.js';
import { ObligationRepository } from '../obligations/obligation.repository.js';
import { toObligationDto, toObligationEventDto } from '../obligations/obligation.types.js';

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

export class SyncRepository extends InvestmentRecoveryRepository {
  constructor(private readonly client: PrismaClient) {
    super(client);
  }

  private async device(tx: Prisma.TransactionClient, userId: string, id: string): Promise<void> {
    if (
      !(await tx.device.findFirst({
        where: { id, userId, user: { status: 'ACTIVE', deletedAt: null } },
        select: { id: true },
      }))
    )
      fail(404, 'Perangkat tidak ditemukan.');
  }

  async data(
    tx: Prisma.TransactionClient,
    userId: string,
    entity: SyncEntity,
    id: string,
    tombstone = false,
  ): Promise<SyncData | null> {
    if (entity === 'obligations') {
      const record = await tx.obligation.findFirst({
        where: {
          id,
          userId,
          user: { status: 'ACTIVE', deletedAt: null },
          ...(tombstone ? {} : { deletedAt: null }),
        },
      });
      return record ? toObligationDto(record) : null;
    }
    if (entity === 'obligation_events') {
      const record = await tx.obligationEvent.findFirst({
        where: { id, userId, user: { status: 'ACTIVE', deletedAt: null } },
      });
      return record ? toObligationEventDto(record) : null;
    }
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
    if (entity === 'investment_transactions') {
      const record = await tx.investmentTransaction.findFirst({
        where: {
          id,
          account: accessibleAccount(userId),
          ...(tombstone ? {} : { deletedAt: null }),
        },
      });
      return record ? toInvestmentDto(record) : null;
    }
    if (entity === 'transactions') {
      const record = await tx.transaction.findFirst({
        where: {
          id,
          account: accessibleAccount(userId),
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
      // The feed carries current record snapshots, not historical ledger deltas.
      // Opt-in clients need only the last change per identity in this window.
      // Bound values and the existing (user_id,version) index keep the scan scoped.
      const events =
        input.compact === 'true'
          ? await tx.$queryRaw<
              { entityType: string; entityId: string; operation: string; version: bigint }[]
            >`
            SELECT entity_type AS "entityType", entity_id AS "entityId", operation, version
            FROM (
              SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, operation, version
              FROM sync_changes
              WHERE user_id = ${userId}::uuid AND version > ${since} AND version <= ${watermark}
              ORDER BY entity_type, entity_id, version DESC
            ) latest
            ORDER BY version ASC
            LIMIT ${input.limit + 1}`
          : await tx.syncChange.findMany({
              where: { userId, version: { gt: since, lte: watermark } },
              orderBy: { version: 'asc' },
              take: input.limit + 1,
            });
      const page = events.slice(0, input.limit);
      for (const event of page) {
        if (!SyncEntitySchema.safeParse(event.entityType).success) {
          throw new Error('Invalid persisted sync entity');
        }
      }
      const payloads = await this.pageData(tx, userId, page);
      const changes = [];
      for (const event of page) {
        const entity = event.entityType;
        // Persisted entity types are constrained by the migration and publication helper.
        const payload = payloads.get(`${entity}:${event.entityId}`) ?? null;
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

  private async pageData(
    tx: Prisma.TransactionClient,
    userId: string,
    page: { entityType: string; entityId: string }[],
  ): Promise<Map<string, SyncData | null>> {
    const result = new Map<string, SyncData | null>();
    for (const type of ['accounts', 'transactions', 'investment_transactions', 'obligations', 'obligation_events'] as const) {
      const ids = [
        ...new Set(
          page.filter((event) => event.entityType === type).map((event) => event.entityId),
        ),
      ];
      if (!ids.length) continue;
      // Apply exactly the point-read authorization policy to every batch. A
      // missing/deleted/revoked row stays absent and is emitted as a tombstone.
      if (type === 'accounts') {
        const rows = await tx.account.findMany({
          where: { id: { in: ids }, ...accessibleAccount(userId) },
        });
        for (const row of rows) result.set(`${type}:${row.id}`, toAccountDto(row));
      } else if (type === 'transactions') {
        const rows = await tx.transaction.findMany({
          where: { id: { in: ids }, deletedAt: null, account: accessibleAccount(userId) },
        });
        for (const row of rows) result.set(`${type}:${row.id}`, toTransactionDto(row));
      } else if (type === 'investment_transactions') {
        const rows = await tx.investmentTransaction.findMany({
          where: { id: { in: ids }, deletedAt: null, account: accessibleAccount(userId) },
        });
        for (const row of rows) result.set(`${type}:${row.id}`, toInvestmentDto(row));
      } else if (type === 'obligations') {
        const rows = await tx.obligation.findMany({ where: { id: { in: ids }, userId, deletedAt: null, user: { status: 'ACTIVE', deletedAt: null } } });
        for (const row of rows) result.set(`${type}:${row.id}`, toObligationDto(row));
      } else {
        const rows = await tx.obligationEvent.findMany({ where: { id: { in: ids }, userId, user: { status: 'ACTIVE', deletedAt: null } } });
        for (const row of rows) result.set(`${type}:${row.id}`, toObligationEventDto(row));
      }
    }
    for (const event of page) {
      if (['accounts', 'transactions', 'investment_transactions', 'obligations', 'obligation_events'].includes(event.entityType))
        continue;
      const key = `${event.entityType}:${event.entityId}`;
      if (!result.has(key)) {
        // Caller validates the persisted entity type before invoking this helper.
        result.set(
          key,
          await this.data(tx, userId, event.entityType as SyncEntity, event.entityId),
        );
      }
    }
    return result;
  }

  async assertDevice(userId: string, id: string): Promise<void> {
    await this.device(this.client, userId, id);
  }

  async apply(userId: string, deviceId: string, item: PushItem) {
    return syncClient(this.client, deviceId).$transaction(async (tx) => {
      await this.device(tx, userId, deviceId);
      if (item.entity_type === 'obligation_cancellations') {
        const result = await new ObligationRepository(transactionClient(tx)).cancel(
          userId,
          item.entity_id,
          item.payload,
        );
        return { status: 'applied' as const, server_data: result };
      }
      if (item.entity_type === 'obligation_commands') {
        const result = await new ObligationRepository(transactionClient(tx)).apply(
          userId,
          item.entity_id,
          item.payload,
        );
        return { status: 'applied' as const, server_data: result };
      }
      const payloadIds =
        item.payload && typeof item.payload === 'object'
          ? Object.entries(item.payload)
              .filter(([key, value]) => key.endsWith('transaction_id') && typeof value === 'string')
              .map(([, value]) => String(value))
          : [];
      if (
        await tx.obligationCommandId.count({
          where: { id: { in: [item.entity_id, ...payloadIds] } },
        })
      )
        fail(409, 'ID sudah digunakan oleh perintah pinjaman.');
      if (item.entity_type === 'investment_transactions') {
        const { linked_transaction_id, ...input } = item.payload;
        const trade = await new PrismaInvestmentRepository(transactionClient(tx)).createOffline(
          userId,
          item.entity_id,
          linked_transaction_id,
          input,
        );
        return { status: 'applied' as const, server_data: toInvestmentDto(trade) };
      }
      if (item.entity_type === 'transfers') {
        const transfer = await new PrismaTransferRepository(transactionClient(tx)).createOffline(
          userId,
          item.entity_id,
          item.payload,
        );
        return { status: 'applied' as const, server_data: toTransferDto(transfer) };
      }
      const version = item.client_version;
      const before = await this.data(tx, userId, item.entity_type, item.entity_id, true);
      if (item.entity_type === 'user_profiles' && item.entity_id !== userId)
        fail(403, 'Profil hanya dapat diubah oleh pemilik.');
      if (item.entity_type !== 'transactions' && before && before.user_id !== userId)
        fail(403, 'Metadata hanya dapat diubah oleh pemilik.');
      if (
        item.entity_type === 'transactions' &&
        before &&
        (before.transfer_id !== null ||
          before.category_id === null ||
          before.is_obligation_settlement === true)
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
