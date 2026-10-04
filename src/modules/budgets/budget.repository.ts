import { AppError } from '../../common/errors/app-error.js';
import { budgetPeriodRange } from '../../common/utils/budget-period.js';
import { generateId } from '../../common/utils/id.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { CreateBudgetInput, ListBudgetsQuery, UpdateBudgetInput } from './budget.schema.js';
import type { BudgetRecord } from './budget.types.js';

export interface BudgetRepository {
  list(userId: string, query: ListBudgetsQuery): Promise<{ items: BudgetRecord[]; total: number }>;
  create(userId: string, input: CreateBudgetInput): Promise<BudgetRecord>;
  update(userId: string, id: string, input: UpdateBudgetInput): Promise<BudgetRecord>;
  softDelete(userId: string, id: string): Promise<void>;
  progress(
    userId: string,
    id: string,
    period: string,
  ): Promise<{ record: BudgetRecord; start: Date; end: Date; total: Prisma.Decimal }>;
}
const include = { category: true, amounts: { where: { effectiveTo: null } } } as const;
function missing(): never {
  throw new AppError({
    statusCode: 404,
    code: 'BUDGET_NOT_FOUND',
    message: 'Anggaran tidak ditemukan.',
  });
}
export class PrismaBudgetRepository implements BudgetRepository {
  constructor(private readonly client: PrismaClient) {}
  async list(userId: string, query: ListBudgetsQuery) {
    const where: Prisma.BudgetWhereInput = {
      deletedAt: null,
      category: { userId, deletedAt: null },
      ...(query.category_id === undefined ? {} : { categoryId: query.category_id }),
      ...(query.period_type === undefined ? {} : { periodType: query.period_type }),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const orderBy: Prisma.BudgetOrderByWithRelationInput[] = [
      query.sort.endsWith('sequence_order')
        ? { sequenceOrder: direction }
        : { createdAt: direction },
      { id: direction },
    ];
    const [items, total] = await this.client.$transaction(
      [
        this.client.budget.findMany({
          where,
          include,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.client.budget.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }
  private async ownerLock(tx: Prisma.TransactionClient, userId: string) {
    // Bound SQL coordinates with existing category/account/ledger writers.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text`;
  }
  private async categoryLock(tx: Prisma.TransactionClient, userId: string, categoryId: string) {
    await tx.$queryRaw`SELECT id FROM categories WHERE id = ${categoryId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    const category = await tx.category.findFirst({
      where: { id: categoryId, userId, deletedAt: null },
    });
    if (!category)
      throw new AppError({
        statusCode: 422,
        code: 'BUDGET_CATEGORY_INVALID',
        message: 'Kategori aktif milik pengguna diperlukan.',
      });
  }
  private async lockedBudget(tx: Prisma.TransactionClient, userId: string, id: string) {
    await this.ownerLock(tx, userId);
    await tx.$queryRaw`SELECT b.id FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.id = ${id}::uuid AND c.user_id = ${userId}::uuid AND c.deleted_at IS NULL AND b.deleted_at IS NULL FOR UPDATE OF b`;
    const record = await tx.budget.findFirst({
      where: { id, deletedAt: null, category: { userId, deletedAt: null } },
      include,
    });
    if (!record) return missing();
    await this.categoryLock(tx, userId, record.categoryId);
    return record;
  }
  create(userId: string, input: CreateBudgetInput) {
    return this.client.$transaction(
      async (tx) => {
        await this.ownerLock(tx, userId);
        await this.categoryLock(tx, userId, input.category_id);
        const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
        return tx.budget.create({
          data: {
            id: generateId(),
            categoryId: input.category_id,
            anchorDate: new Date(input.anchor_date + 'T00:00:00.000Z'),
            periodType: input.period_type,
            baseCurrency: input.base_currency,
            icon: input.icon ?? null,
            description: input.description ?? null,
            sequenceOrder: BigInt(input.sequence_order),
            amounts: { create: { id: generateId(), amount: input.amount, effectiveFrom: today } },
          },
          include,
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
  update(userId: string, id: string, input: UpdateBudgetInput) {
    return this.client.$transaction(
      async (tx) => {
        const current = await this.lockedBudget(tx, userId, id);
        if (
          (input.category_id !== undefined && input.category_id !== current.categoryId) ||
          (input.anchor_date !== undefined &&
            input.anchor_date !== current.anchorDate.toISOString().slice(0, 10)) ||
          (input.period_type !== undefined && input.period_type !== current.periodType)
        ) {
          throw new AppError({
            statusCode: 409,
            code: 'BUDGET_SCHEDULE_IMMUTABLE',
            message:
              'Kategori dan jadwal anggaran tidak dapat diubah. Buat anggaran baru untuk menjaga histori.',
          });
        }
        if (input.amount !== undefined) {
          const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
          await tx.budgetAmount.updateMany({
            where: { budgetId: id, effectiveTo: null },
            data: { effectiveTo: today },
          });
          await tx.budgetAmount.create({
            data: { id: generateId(), budgetId: id, amount: input.amount, effectiveFrom: today },
          });
        }
        return tx.budget.update({
          where: { id },
          data: {
            updatedAt: new Date(),
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.sequence_order === undefined
              ? {}
              : { sequenceOrder: BigInt(input.sequence_order) }),
          },
          include,
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
  async softDelete(userId: string, id: string) {
    await this.client.$transaction(
      async (tx) => {
        await this.lockedBudget(tx, userId, id);
        await tx.budget.update({ where: { id }, data: { deletedAt: new Date() } });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
  progress(userId: string, id: string, period: string) {
    return this.client.$transaction(
      async (tx) => {
        const budget = await tx.budget.findFirst({
          where: { id, deletedAt: null, category: { userId, deletedAt: null } },
          include,
        });
        if (!budget) return missing();
        let range: { start: Date; end: Date };
        try {
          range = budgetPeriodRange(budget.anchorDate, budget.periodType, period);
        } catch {
          throw new AppError({
            statusCode: 422,
            code: 'BUDGET_PERIOD_INVALID',
            message:
              'Periode harus YYYY-MM untuk bulanan, YYYY untuk tahunan, atau YYYY-MM-DD untuk harian/mingguan.',
          });
        }
        const amounts = await tx.budgetAmount.findMany({
          where: {
            budgetId: id,
            effectiveFrom: { lt: range.end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: range.start } }],
          },
          orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const sum = await tx.transaction.aggregate({
          where: {
            categoryId: budget.categoryId,
            type: budget.category.type,
            transferId: null,
            deletedAt: null,
            transactedAt: { gte: range.start, lt: range.end },
            account: {
              userId,
              deletedAt: null,
              currency: budget.baseCurrency,
              accountType: { userId, deletedAt: null },
            },
          },
          _sum: { amount: true },
        });
        // Include the open row for current_amount even when the requested range is historical.
        const record: BudgetRecord = {
          ...budget,
          amounts: [
            ...amounts,
            ...budget.amounts.filter((row) => !amounts.some((item) => item.id === row.id)),
          ],
        };
        return { record, ...range, total: sum._sum.amount ?? new Prisma.Decimal(0) };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
