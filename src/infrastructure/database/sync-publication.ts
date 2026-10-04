import { generateId } from '../../common/utils/id.js';
import {
  accessibleAccount,
  activeGroup,
  activeMember,
} from '../../common/authorization/account-access.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export const SYNC_LOCK = 5786933010410n;
export async function lockSync(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK})::text`;
}
export const syncEntities = {
  accountType: 'account_types',
  account: 'accounts',
  category: 'categories',
  transaction: 'transactions',
  userProfile: 'user_profiles',
} as const;
export type SyncEntity = (typeof syncEntities)[keyof typeof syncEntities];

export async function accountRecipients(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<string[]> {
  const account = await tx.account.findUnique({ where: { id }, select: { userId: true } });
  if (!account) return [];
  const members = await tx.userGroup.findMany({
    where: { ...activeMember(), group: { ...activeGroup, accounts: { some: { accountId: id } } } },
    select: { userId: true },
  });
  return [...new Set([account.userId, ...members.map((member) => member.userId)])];
}
export async function metadataRecipients(
  tx: Prisma.TransactionClient,
  owner: string,
  typeId?: string,
): Promise<string[]> {
  const accounts = await tx.account.findMany({
    where: { userId: owner, deletedAt: null, ...(typeId ? { accountTypeId: typeId } : {}) },
    select: { id: true },
  });
  const recipients = new Set([owner]);
  for (const account of accounts)
    for (const user of await accountRecipients(tx, account.id)) recipients.add(user);
  return [...recipients];
}
export async function publish(
  tx: Prisma.TransactionClient,
  entityType: SyncEntity,
  entityId: string,
  recipients: string[],
  operation: string,
  deviceId: string | null,
): Promise<void> {
  for (const userId of [...new Set(recipients)].sort()) {
    await tx.syncChange.create({
      data: { id: generateId(), userId, deviceId, entityType, entityId, operation },
    });
  }
}

type Row = { id?: string; userId?: string; accountId?: string; deletedAt?: Date | null };
function row(value: unknown): Row | null {
  if (!value || typeof value !== 'object') return null;
  const result: Row = {};
  for (const key of ['id', 'userId', 'accountId'] as const) {
    const field: unknown = Reflect.get(value, key);
    if (typeof field === 'string') result[key] = field;
  }
  const deleted: unknown = Reflect.get(value, 'deletedAt');
  if (deleted === null || deleted instanceof Date) result.deletedAt = deleted;
  return result;
}
async function recipients(
  tx: Prisma.TransactionClient,
  entity: SyncEntity,
  record: Row,
): Promise<string[]> {
  if (entity === 'accounts') return record.id ? accountRecipients(tx, record.id) : [];
  if (entity === 'transactions')
    return record.accountId ? accountRecipients(tx, record.accountId) : [];
  if (!record.userId) return [];
  if (entity === 'user_profiles') return [record.userId];
  return metadataRecipients(tx, record.userId, entity === 'account_types' ? record.id : undefined);
}

/** Preserve the repositories' transaction boundary and validation. The proxy only observes
 * persisted rows; no request object is passed through to Prisma by this adapter.
 * The casts preserve the exact Prisma delegate API while wrapping its callable methods. */
export function syncClient(
  client: PrismaClient,
  deviceId: string | null = null,
  publishChanges = true,
): PrismaClient {
  async function run<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: object,
  ): Promise<T> {
    return client.$transaction(
      async (tx) => {
        await lockSync(tx);
        const changes = new Map<
          string,
          { entity: SyncEntity; id: string; users: Set<string>; operation: string }
        >();
        const grantAccounts = new Map<string, Set<string>>();
        async function rememberGrantAccounts(args: unknown) {
          const groupIds = new Set<string>();
          const accountIds = new Set<string>();
          function identifiers(value: unknown): void {
            if (!value || typeof value !== 'object') return;
            for (const [key, field] of Object.entries(value)) {
              if (key === 'groupId' && typeof field === 'string') groupIds.add(field);
              else if (key === 'accountId' && typeof field === 'string') accountIds.add(field);
              else identifiers(field);
            }
          }
          identifiers(args);
          if (groupIds.size) {
            const shares = await tx.groupAccount.findMany({
              where: { groupId: { in: [...groupIds] } },
              select: { accountId: true },
            });
            for (const share of shares) accountIds.add(share.accountId);
          }
          for (const accountId of accountIds)
            if (!grantAccounts.has(accountId))
              grantAccounts.set(accountId, new Set(await accountRecipients(tx, accountId)));
        }
        const observed = new Proxy(tx, {
          get(target, property) {
            const delegate: unknown = Reflect.get(target, property);
            if (typeof property !== 'string' || !delegate || typeof delegate !== 'object')
              return delegate;
            const entity = syncEntities[property as keyof typeof syncEntities];
            const grant = property === 'groupAccount' || property === 'userGroup';
            if (!entity && !grant) return delegate;
            return new Proxy(delegate, {
              get(model, method) {
                const fn: unknown = Reflect.get(model, method);
                if (typeof fn !== 'function') return fn;
                if (
                  typeof method !== 'string' ||
                  ![
                    'create',
                    'createMany',
                    'update',
                    'updateMany',
                    'upsert',
                    'delete',
                    'deleteMany',
                  ].includes(method)
                )
                  return fn.bind(model) as unknown;
                return async (args: unknown) => {
                  if (!publishChanges) return Reflect.apply(fn, model, [args]) as unknown;
                  if (grant) await rememberGrantAccounts(args);
                  const before: Row[] = [];
                  const where: unknown =
                    args && typeof args === 'object' ? Reflect.get(args, 'where') : undefined;
                  if (entity && where) {
                    const finder: unknown = Reflect.get(model, 'findMany');
                    if (typeof finder === 'function') {
                      const found: unknown = await Reflect.apply(finder, model, [{ where }]);
                      if (Array.isArray(found))
                        for (const value of found) {
                          const record = row(value);
                          if (record) before.push(record);
                        }
                    }
                  }
                  for (const record of before) {
                    const id = entity === 'user_profiles' ? record.userId : record.id;
                    if (!entity || !id) continue;
                    const key = entity + ':' + id;
                    const change = changes.get(key) ?? {
                      entity,
                      id,
                      users: new Set<string>(),
                      operation: 'UPDATE',
                    };
                    for (const user of await recipients(tx, entity, record)) change.users.add(user);
                    changes.set(key, change);
                  }
                  const result: unknown = await Reflect.apply(fn, model, [args]);
                  if (entity) {
                    const after = row(result);
                    const records = after?.id || after?.userId ? [after] : before;
                    if (method === 'createMany' && args && typeof args === 'object') {
                      const data: unknown = Reflect.get(args, 'data');
                      for (const value of Array.isArray(data) ? data : [data]) {
                        const record = row(value);
                        if (record) records.push(record);
                      }
                    }
                    for (let record of records) {
                      if (method === 'updateMany') {
                        const finder: unknown = Reflect.get(model, 'findUnique');
                        if (typeof finder === 'function') {
                          const latest: unknown = await Reflect.apply(finder, model, [
                            {
                              where:
                                entity === 'user_profiles'
                                  ? { userId: record.userId }
                                  : { id: record.id },
                            },
                          ]);
                          record = row(latest) ?? record;
                        }
                      }
                      const id = entity === 'user_profiles' ? record.userId : record.id;
                      if (!id) continue;
                      const key = entity + ':' + id;
                      const change = changes.get(key) ?? {
                        entity,
                        id,
                        users: new Set<string>(),
                        operation: 'CREATE',
                      };
                      for (const user of await recipients(tx, entity, record))
                        change.users.add(user);
                      change.operation =
                        record.deletedAt || method.startsWith('delete')
                          ? 'DELETE'
                          : change.operation;
                      changes.set(key, change);
                    }
                  }
                  return result;
                };
              },
            });
          },
        });
        const result = await operation(observed);
        for (const change of changes.values()) {
          // Investment-generated cash rows remain online-only even when touched by other paths.
          if (
            change.entity === 'transactions' &&
            (await tx.investmentTransaction.findUnique({
              where: { linkedTransactionId: change.id },
              select: { id: true },
            }))
          )
            continue;
          const record =
            change.entity === 'accounts'
              ? await tx.account.findUnique({ where: { id: change.id } })
              : null;
          if (record?.deletedAt) change.operation = 'DELETE';
          await publish(
            tx,
            change.entity,
            change.id,
            [...change.users],
            change.operation,
            deviceId,
          );
          if (record) {
            await publish(
              tx,
              'account_types',
              record.accountTypeId,
              [...change.users],
              'UPDATE',
              deviceId,
            );
            const categories = await tx.category.findMany({
              where: { userId: record.userId },
              select: { id: true },
            });
            for (const category of categories)
              await publish(tx, 'categories', category.id, [...change.users], 'UPDATE', deviceId);
            if (record.deletedAt) {
              const transactions = await tx.transaction.findMany({
                where: { accountId: record.id, investmentTransaction: null },
                select: { id: true },
              });
              for (const transaction of transactions)
                await publish(
                  tx,
                  'transactions',
                  transaction.id,
                  [...change.users],
                  'DELETE',
                  deviceId,
                );
            }
          }
        }
        if (grantAccounts.size) {
          for (const [id, before] of grantAccounts) {
            const after = new Set(await accountRecipients(tx, id));
            for (const user of new Set([...before, ...after])) {
              if (before.has(user) === after.has(user)) continue;
              await publish(
                tx,
                'accounts',
                id,
                [user],
                after.has(user) ? 'CREATE' : 'DELETE',
                deviceId,
              );
              const account = await tx.account.findUnique({ where: { id } });
              if (!account) continue;
              const categories = await tx.category.findMany({
                where: { userId: account.userId },
                select: { id: true },
              });
              await publish(
                tx,
                'account_types',
                account.accountTypeId,
                [user],
                after.has(user) ? 'CREATE' : 'DELETE',
                deviceId,
              );
              for (const category of categories)
                await publish(
                  tx,
                  'categories',
                  category.id,
                  [user],
                  after.has(user) ? 'CREATE' : 'DELETE',
                  deviceId,
                );
              const transactions = await tx.transaction.findMany({
                where: { accountId: id, investmentTransaction: null },
                select: { id: true },
              });
              for (const transaction of transactions)
                await publish(
                  tx,
                  'transactions',
                  transaction.id,
                  [user],
                  after.has(user) ? 'CREATE' : 'DELETE',
                  deviceId,
                );
            }
          }
        }
        return result;
      },
      { isolationLevel: 'ReadCommitted', ...options },
    );
  }
  return new Proxy(client, {
    get(target, property) {
      if (property === '$transaction')
        return (operation: unknown, options?: object) =>
          typeof operation === 'function'
            ? run(operation as (tx: Prisma.TransactionClient) => Promise<unknown>, options)
            : target.$transaction(operation as Prisma.PrismaPromise<unknown>[], options);
      const value: unknown = Reflect.get(target, property);
      if (
        typeof property === 'string' &&
        property in syncEntities &&
        value &&
        typeof value === 'object'
      )
        return new Proxy(value, {
          get(delegate, method) {
            const fn: unknown = Reflect.get(delegate, method);
            if (typeof fn !== 'function') return fn;
            if (
              typeof method === 'string' &&
              ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(method)
            )
              return (args: unknown) =>
                run(async (tx) => {
                  const model: unknown = Reflect.get(tx, property);
                  const operation: unknown = Reflect.get(model as object, method);
                  if (typeof operation !== 'function')
                    throw new Error('Invalid Prisma mutation delegate');
                  return Reflect.apply(operation, model, [args]) as Promise<unknown>;
                });
            return fn.bind(delegate) as unknown;
          },
        });
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
}

export async function canReadMetadata(
  tx: Prisma.TransactionClient,
  userId: string,
  owner: string,
  typeId?: string,
): Promise<boolean> {
  return (
    owner === userId ||
    !!(await tx.account.findFirst({
      where: {
        AND: [
          accessibleAccount(userId),
          { userId: owner, ...(typeId ? { accountTypeId: typeId } : {}) },
        ],
      },
      select: { id: true },
    }))
  );
}
