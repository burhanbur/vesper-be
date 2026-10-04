import type { Prisma } from '../../generated/prisma/client.js';
import type { BudgetDto } from './budget.schema.js';

export type BudgetRecord = Prisma.BudgetGetPayload<{ include: { amounts: true; category: true } }>;
export function toBudgetDto(record: BudgetRecord): BudgetDto {
  return {
    id: record.id,
    category_id: record.categoryId,
    icon: record.icon,
    anchor_date: record.anchorDate.toISOString().slice(0, 10),
    period_type: record.periodType,
    base_currency: 'IDR',
    description: record.description,
    sequence_order: record.sequenceOrder.toString(),
    current_amount:
      record.amounts.find((row) => row.effectiveTo === null)?.amount.toFixed(2) ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    deleted_at: record.deletedAt?.toISOString() ?? null,
  };
}
