import { AppError } from '../errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const activeGroup = { isActive: true, deletedAt: null };
export const activeMember = (userId?: string): Prisma.UserGroupWhereInput => ({
  ...(userId === undefined ? {} : { userId }),
  user: { status: 'ACTIVE', deletedAt: null },
});

/** Public finance access policy; OR uses EXISTS and never duplicates account rows. */
export function accessibleAccount(userId: string): Prisma.AccountWhereInput {
  return {
    deletedAt: null,
    accountType: { deletedAt: null, user: { status: 'ACTIVE', deletedAt: null } },
    OR: [
      { accountType: { userId } },
      {
        groupAccounts: {
          some: { group: { ...activeGroup, members: { some: activeMember(userId) } } },
        },
      },
    ],
  };
}
export async function lockOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text`;
}

/** Lock actual owners before any type/account/category locks, including across users. */
export async function lockAccountOwners(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  const accounts = await tx.account.findMany({
    where: { id: { in: ids } },
    select: { accountType: { select: { userId: true } } },
  });
  for (const owner of [...new Set(accounts.map((a) => a.accountType.userId))].sort()) {
    await lockOwner(tx, owner);
  }
}

/** Revocation protocol: group writers take UPDATE; ledger takes SHARE after owner locks.
 * Membership/share rows are protected too. Revalidate after all locks in ReadCommitted.
 * Future membership/deactivation writers must lock the group before changing grants.
 */
export async function lockAccountGrants(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: string[],
): Promise<void> {
  const grants = await tx.groupAccount.findMany({
    where: {
      accountId: { in: ids },
      group: { ...activeGroup, members: { some: activeMember(userId) } },
    },
    select: { groupId: true },
  });
  for (const groupId of [...new Set(grants.map((g) => g.groupId))].sort()) {
    await tx.$queryRaw`SELECT id FROM groups WHERE id = ${groupId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM user_groups WHERE group_id = ${groupId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
    // Lock all selected shares in this group; the group lock prevents new/deleted grants.
    for (const id of [...new Set(ids)].sort()) {
      await tx.$queryRaw`SELECT id FROM group_accounts WHERE group_id = ${groupId}::uuid AND account_id = ${id}::uuid FOR SHARE`;
    }
  }
}
export async function accountCategoryOwner(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<string> {
  const account = await tx.account.findFirst({
    where: { id, ...accessibleAccount(userId) },
    select: { accountType: { select: { userId: true } } },
  });
  if (!account)
    throw new AppError({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Akun tidak ditemukan.',
    });
  return account.accountType.userId;
}
