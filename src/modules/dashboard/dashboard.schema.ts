import { z } from '../../common/openapi/zod.js';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const PeriodSchema = z.enum(['daily', 'monthly', 'yearly']);
type Period = z.infer<typeof PeriodSchema>;

function calendarStart(period: Period, value: string): Date | undefined {
    const pattern = { daily: /^\d{4}-\d{2}-\d{2}$/, monthly: /^\d{4}-\d{2}$/, yearly: /^\d{4}$/ }[
        period
    ];
    if (!pattern.test(value)) return undefined;
    const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
    if (year < 1000 || year > 9998 || month < 1 || month > 12 || day < 1 || day > 31)
        return undefined;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    )
        return undefined;
    return date;
}

export const DashboardSummaryQuerySchema = z
    .strictObject({
        period: PeriodSchema,
        value: z.string().openapi({
            description:
                'daily: YYYY-MM-DD; monthly: YYYY-MM; yearly: YYYY. Valid calendar values, years 1000–9998.',
            example: '2026-10',
        }),
        end_value: z.string().optional().openapi({
            description:
                'Inclusive ending period in the same format as value. Defaults to value; must be a real calendar value (years 1000–9998) greater than or equal to value.',
            example: '2026-12',
        }),
    })
    .superRefine(({ period, value, end_value }, context) => {
        const start = calendarStart(period, value);
        if (!start) {
            context.addIssue({
                code: 'custom',
                path: ['value'],
                message: 'Periode kalender tidak valid (tahun 1000–9998).',
            });
        }
        if (end_value !== undefined) {
            const end = calendarStart(period, end_value);
            if (!end) {
                context.addIssue({
                    code: 'custom',
                    path: ['end_value'],
                    message: 'Periode kalender akhir tidak valid (tahun 1000–9998).',
                });
            } else if (start && end.getTime() < start.getTime()) {
                context.addIssue({
                    code: 'custom',
                    path: ['end_value'],
                    message: 'Periode akhir harus sama dengan atau setelah periode awal.',
                });
            }
        }
    });
export type DashboardSummaryQuery = z.infer<typeof DashboardSummaryQuerySchema>;

/** Fixed WIB calendar boundaries; UTC output is start-inclusive and end-exclusive. */
export function dashboardPeriodBounds(query: DashboardSummaryQuery): { start: Date; end: Date } {
    const validated = DashboardSummaryQuerySchema.parse(query);
    const start = calendarStart(validated.period, validated.value);
    const end = calendarStart(validated.period, validated.end_value ?? validated.value);
    if (!start || !end) throw new Error('Validated dashboard calendar invariant violated');
    if (validated.period === 'daily') end.setUTCDate(end.getUTCDate() + 1);
    if (validated.period === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1);
    if (validated.period === 'yearly') end.setUTCFullYear(end.getUTCFullYear() + 1);
    return {
        start: new Date(start.getTime() - WIB_OFFSET_MS),
        end: new Date(end.getTime() - WIB_OFFSET_MS),
    };
}

const MoneySchema = z.string().regex(/^-?\d+\.\d{2}$/);
export const DashboardSummaryDtoSchema = z.strictObject({
    period: PeriodSchema,
    value: z.string(),
    end_value: z
        .string()
        .openapi({ description: 'Resolved inclusive ending period; defaults to value.' }),
    timezone: z.literal('Asia/Jakarta'),
    start_at: z.iso.datetime(),
    end_at: z.iso.datetime(),
    income_total: MoneySchema,
    expense_total: MoneySchema,
    net_cashflow: MoneySchema,
});
export type DashboardSummaryDto = z.infer<typeof DashboardSummaryDtoSchema>;
