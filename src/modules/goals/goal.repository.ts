import { AppError } from '../../common/errors/app-error.js';
import { activeGroup, activeMember } from '../../common/authorization/account-access.js';
import { Prisma, type Goal } from '../../generated/prisma/client.js';
import {
  CreateGoalSchema,
  UpdateGoalSchema,
  CreateGoalAllocationSchema,
  UpdateGoalAllocationSchema,
} from './goal.schema.js';

function fail(message: string, statusCode = 422): never {
  throw new AppError({ code: 'GOAL_MUTATION_REJECTED', message, statusCode });
}
export function goalAccess(userId: string): Prisma.GoalWhereInput {
  return {
    user: { status: 'ACTIVE', deletedAt: null },
    OR: [
      { userId, groupId: null },
      { group: { ...activeGroup, members: { some: activeMember(userId) } } },
    ],
  };
}
export async function goalRecipients(tx: Prisma.TransactionClient, id: string): Promise<string[]> {
  const goal = await tx.goal.findUnique({ where: { id } });
  if (!goal) return [];
  if (!goal.groupId) return [goal.userId];
  const members = await tx.userGroup.findMany({
    where: {
      groupId: goal.groupId,
      ...activeMember(),
      group: activeGroup,
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}
export function toGoalDto(row: Goal) {
  return {
    id: row.id,
    user_id: row.userId,
    group_id: row.groupId,
    name: row.name,
    currency: row.currency,
    target_amount: row.targetAmount.toFixed(2),
    start_date: row.startDate.toISOString().slice(0, 10),
    target_date: row.targetDate.toISOString().slice(0, 10),
    status: row.status,
    version: row.version.toString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
  };
}
export async function allocationDtos(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: string[],
  tombstone = false,
) {
  const requested = await tx.goalAllocation.findMany({
    where: {
      id: { in: ids },
      ...(tombstone ? {} : { deletedAt: null }),
      OR: [{ userId }, { goal: { ...goalAccess(userId), deletedAt: null } }],
    },
  });
  const all = await tx.goalAllocation.findMany({
    where: {
      accountId: { in: [...new Set(requested.map((a) => a.accountId))] },
      deletedAt: null,
      goal: { deletedAt: null },
    },
    include: {
      account: {
        include: {
          accountType: true,
          children: { where: { deletedAt: null }, select: { id: true } },
          mappedObligations: { where: { deletedAt: null }, select: { id: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10001,
  });
  if (all.length > 10000) fail('Terlalu banyak alokasi dalam akun.');
  const remaining = new Map<string, Prisma.Decimal>();
  const backing = new Map<string, Prisma.Decimal>();
  for (const allocation of all) {
    const account = allocation.account;
    if (!remaining.has(account.id))
      remaining.set(
        account.id,
        account.deletedAt ||
          account.accountType.deletedAt ||
          account.accountType.category !== 'CASH' ||
          account.children.length ||
          account.mappedObligations.length
          ? new Prisma.Decimal(0)
          : Prisma.Decimal.max(0, account.balance),
      );
    const available = remaining.get(account.id) ?? new Prisma.Decimal(0);
    const backed = Prisma.Decimal.min(available, allocation.amount);
    backing.set(allocation.id, backed);
    remaining.set(account.id, available.minus(backed));
  }
  const checked = new Date().toISOString();
  return requested.map((a) => ({
    id: a.id,
    user_id: a.userId,
    goal_id: a.goalId,
    account_id: a.userId === userId ? a.accountId : null,
    amount: a.amount.toFixed(2),
    backed_amount: (backing.get(a.id) ?? new Prisma.Decimal(0)).toFixed(2),
    backing_checked_at: checked,
    version: a.version.toString(),
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
    deleted_at: a.deletedAt?.toISOString() ?? null,
  }));
}

export class GoalRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  async write(
    userId: string,
    entity: 'goals' | 'goal_allocations',
    id: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    payload: unknown,
  ) {
    const tx = this.tx;
    if (entity === 'goals') {
      if (operation === 'CREATE') {
        const input = CreateGoalSchema.parse(payload);
        if (
          input.group_id &&
          !(await tx.userGroup.findFirst({
            where: {
              userId,
              groupId: input.group_id,
              ...activeMember(),
              group: activeGroup,
            },
          }))
        )
          fail('Keanggotaan rumah tangga tidak aktif.', 403);
        if ((await tx.goal.count({ where: { userId, deletedAt: null } })) >= 200)
          fail('Maksimal 200 goal aktif.');
        return tx.goal.create({
          data: {
            id,
            userId,
            groupId: input.group_id,
            name: input.name,
            currency: input.currency,
            targetAmount: input.target_amount,
            startDate: new Date(input.start_date),
            targetDate: new Date(input.target_date),
          },
        });
      }
      const goal = await tx.goal.findFirst({
        where: { id, ...goalAccess(userId), userId, deletedAt: null },
      });
      if (!goal) fail('Hanya pembuat goal yang aktif dapat mengubah goal.', 403);
      if (operation === 'DELETE') {
        await tx.goalAllocation.updateMany({
          where: { goalId: id, deletedAt: null },
          data: { amount: 0, deletedAt: new Date(), version: { increment: 1 } },
        });
        return tx.goal.update({
          where: { id },
          data: { deletedAt: new Date(), version: { increment: 1 } },
        });
      }
      const input = UpdateGoalSchema.parse(payload);
      if (input.target_date < goal.startDate.toISOString().slice(0, 10))
        fail('Tanggal target tidak valid.');
      if (input.status === 'COMPLETED') {
        const rows = await tx.goalAllocation.findMany({
          where: { goalId: id, deletedAt: null },
          select: { id: true },
        });
        const allocations = await allocationDtos(
          tx,
          userId,
          rows.map((a) => a.id),
        );
        const funded = allocations.reduce(
          (sum, a) => sum.plus(a.backed_amount),
          new Prisma.Decimal(0),
        );
        if (funded.lt(input.target_amount)) fail('Dana yang didukung saldo belum mencapai target.');
      }
      return tx.goal.update({
        where: { id },
        data: {
          name: input.name,
          targetAmount: input.target_amount,
          targetDate: new Date(input.target_date),
          status: input.status,
          version: { increment: 1 },
        },
      });
    }
    const old =
      operation === 'CREATE'
        ? null
        : await tx.goalAllocation.findFirst({ where: { id, userId, deletedAt: null } });
    if (operation !== 'CREATE' && !old) fail('Alokasi tidak ditemukan.', 404);
    const input = operation === 'CREATE' ? CreateGoalAllocationSchema.parse(payload) : null;
    const amount =
      operation === 'DELETE'
        ? '0.00'
        : (input?.amount ?? UpdateGoalAllocationSchema.parse(payload).amount);
    const goalId = input?.goal_id ?? old?.goalId;
    const accountId = input?.account_id ?? old?.accountId;
    if (!goalId || !accountId) fail('Alokasi tidak valid.');
    const goal = await tx.goal.findFirst({
      where: { id: goalId, ...goalAccess(userId), deletedAt: null },
    });
    const increasing = new Prisma.Decimal(amount).gt(old?.amount ?? 0);
    if (!goal && (increasing || !old)) fail('Goal tidak dapat diakses.', 403);
    if (increasing || !old) {
      const account = await tx.account.findFirst({
        where: {
          id: accountId,
          userId,
          deletedAt: null,
          accountType: { category: 'CASH', deletedAt: null },
          children: { none: { deletedAt: null } },
          mappedObligations: { none: { deletedAt: null } },
        },
      });
      if (!account || account.currency !== goal?.currency)
        fail('Pilih akun kas milik sendiri dengan mata uang yang sama.');
      const totals = await tx.goalAllocation.aggregate({
        where: { accountId, id: { not: id }, deletedAt: null, goal: { deletedAt: null } },
        _sum: { amount: true },
      });
      if (
        new Prisma.Decimal(amount)
          .plus(totals._sum.amount ?? 0)
          .gt(Prisma.Decimal.max(0, account.balance))
      )
        fail('Saldo tersedia sudah dialokasikan untuk goal lain.', 409);
    }
    if (input) return tx.goalAllocation.create({ data: { id, userId, goalId, accountId, amount } });
    return tx.goalAllocation.update({
      where: { id },
      data: {
        amount,
        ...(operation === 'DELETE' ? { deletedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
  }
}
