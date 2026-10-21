import { AppError } from '../../common/errors/app-error.js';
import type { EmergencyPlan, Prisma } from '../../generated/prisma/client.js';
import { EmergencyPlanInputSchema } from './emergency-plan.schema.js';

function fail(message: string, statusCode = 422): never {
  throw new AppError({ code: 'EMERGENCY_PLAN_REJECTED', statusCode, message });
}
export function toEmergencyPlanDto(row: EmergencyPlan) {
  return {
    id: row.id,
    user_id: row.userId,
    currency: row.currency,
    baseline_mode: row.baselineMode,
    manual_baseline: row.manualBaseline?.toFixed(2) ?? null,
    coverage_months: row.coverageMonths,
    history_months: row.historyMonths,
    account_ids: row.accountIds,
    category_ids: row.categoryIds,
    goal_id: row.goalId,
    version: row.version.toString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
  };
}
export class EmergencyPlanRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  async write(
    userId: string,
    id: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    payload: unknown,
  ) {
    const tx = this.tx;
    if (
      operation !== 'CREATE' &&
      !(await tx.emergencyPlan.findFirst({ where: { id, userId, deletedAt: null } }))
    ) {
      fail('Rencana dana darurat tidak ditemukan.', 404);
    }
    if (operation === 'DELETE') {
      return tx.emergencyPlan.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
    }
    const input = EmergencyPlanInputSchema.parse(payload);
    if (
      operation === 'CREATE' &&
      (await tx.emergencyPlan.count({ where: { userId, deletedAt: null } }))
    ) {
      fail('Rencana dana darurat sudah ada. Sinkronkan dan ubah rencana yang ada.', 409);
    }
    const accounts = await tx.account.count({
      where: {
        id: { in: input.account_ids },
        userId,
        currency: 'IDR',
        deletedAt: null,
        accountType: { userId, category: 'CASH', deletedAt: null },
        children: { none: { deletedAt: null } },
        mappedObligations: { none: { deletedAt: null } },
      },
    });
    if (accounts !== input.account_ids.length)
      fail('Pilih akun kas/kantong IDR milik sendiri yang aktif.');
    const categories = await tx.category.count({
      where: {
        id: { in: input.category_ids },
        userId,
        type: 'EXPENSE',
        deletedAt: null,
      },
    });
    if (categories !== input.category_ids.length)
      fail('Kategori wajib harus kategori pengeluaran milik sendiri.');
    if (
      input.goal_id &&
      !(await tx.goal.findFirst({
        where: {
          id: input.goal_id,
          userId,
          groupId: null,
          currency: 'IDR',
          deletedAt: null,
        },
      }))
    )
      fail('Pilih goal pribadi IDR milik sendiri yang aktif.');
    const data = {
      currency: input.currency,
      baselineMode: input.baseline_mode,
      manualBaseline: input.manual_baseline,
      coverageMonths: input.coverage_months,
      historyMonths: input.history_months,
      accountIds: input.account_ids,
      categoryIds: input.category_ids,
      goalId: input.goal_id,
    };
    return operation === 'CREATE'
      ? tx.emergencyPlan.create({ data: { id, userId, ...data } })
      : tx.emergencyPlan.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }
}
