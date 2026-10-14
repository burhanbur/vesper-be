import type { DashboardRepository } from './dashboard.repository.js';
import {
    dashboardPeriodBounds,
    type DashboardSummaryDto,
    type DashboardSummaryQuery,
} from './dashboard.schema.js';

export class DashboardService {
    constructor(private readonly repository: DashboardRepository) { }

    async summary(userId: string, query: DashboardSummaryQuery): Promise<DashboardSummaryDto> {
        const { start, end } = dashboardPeriodBounds(query);
        const { income, expense } = await this.repository.summarize(userId, start, end);
        return {
            ...query,
            end_value: query.end_value ?? query.value,
            timezone: 'Asia/Jakarta',
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            income_total: income.toFixed(2),
            expense_total: expense.toFixed(2),
            net_cashflow: income.minus(expense).toFixed(2),
        };
    }
}
