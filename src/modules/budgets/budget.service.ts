import { UTC_DAY_MS } from '../../common/utils/budget-period.js';
import type { PaginatedData } from '../../common/http/api-response.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { BudgetRepository } from './budget.repository.js';
import type {
  BudgetDto,
  BudgetProgressDto,
  CreateBudgetInput,
  ListBudgetsQuery,
  UpdateBudgetInput,
} from './budget.schema.js';
import { toBudgetDto } from './budget.types.js';

export class BudgetService {
  constructor(private readonly repository: BudgetRepository) {}
  async list(userId: string, query: ListBudgetsQuery): Promise<PaginatedData<BudgetDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toBudgetDto),
      pagination: {
        total,
        per_page: query.limit,
        current_page: query.page,
        last_page: Math.max(1, Math.ceil(total / query.limit)),
        from: items.length ? offset + 1 : null,
        to: items.length ? offset + items.length : null,
      },
    };
  }
  async create(userId: string, input: CreateBudgetInput) {
    return toBudgetDto(await this.repository.create(userId, input));
  }
  async update(userId: string, id: string, input: UpdateBudgetInput) {
    return toBudgetDto(await this.repository.update(userId, id, input));
  }
  delete(userId: string, id: string) {
    return this.repository.softDelete(userId, id);
  }
  async progress(userId: string, id: string, period: string): Promise<BudgetProgressDto> {
    const { record, start, end, total } = await this.repository.progress(userId, id, period);
    const periodDays = (end.getTime() - start.getTime()) / UTC_DAY_MS;
    let allowance = new Prisma.Decimal(0);
    const budgetAmounts: BudgetProgressDto['budget_amounts'] = [];
    for (const row of record.amounts) {
      const segmentStart = new Date(Math.max(start.getTime(), row.effectiveFrom.getTime()));
      const segmentEnd = new Date(
        Math.min(end.getTime(), row.effectiveTo?.getTime() ?? end.getTime()),
      );
      const activeDays = (segmentEnd.getTime() - segmentStart.getTime()) / UTC_DAY_MS;
      if (activeDays <= 0) continue;
      // Decimal multiplication/division only; round each contribution to cents so displayed segments sum exactly.
      const contribution = row.amount
        .mul(new Prisma.Decimal(activeDays))
        .div(new Prisma.Decimal(periodDays))
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      allowance = allowance.add(contribution);
      budgetAmounts.push({
        id: row.id,
        amount: row.amount.toFixed(2),
        effective_from: row.effectiveFrom.toISOString().slice(0, 10),
        effective_to: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
        start: segmentStart.toISOString().slice(0, 10),
        end: segmentEnd.toISOString().slice(0, 10),
        active_days: activeDays,
        allowance: contribution.toFixed(2),
      });
    }
    return {
      budget: toBudgetDto(record),
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      period_days: periodDays,
      total_amount: total.toFixed(2),
      allowance: allowance.toFixed(2),
      remaining_amount: allowance.sub(total).toFixed(2),
      progress_percent: allowance.isZero()
        ? null
        : total.div(allowance).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      budget_amounts: budgetAmounts,
    };
  }
}
