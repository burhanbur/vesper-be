import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
    createSuccessResponseSchema,
    ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { DashboardSummaryDtoSchema, DashboardSummaryQuerySchema } from './dashboard.schema.js';

export function registerDashboardOpenApi(registry: OpenAPIRegistry): void {
    registry.register('DashboardSummary', DashboardSummaryDtoSchema);
    registry.registerPath({
        method: 'get',
        path: '/api/v1/dashboard/summary',
        operationId: 'getDashboardSummary',
        tags: ['Dashboard'],
        summary: 'Get calendar-period cashflow summary',
        description:
            'Access JWT and active Redis session required; no additional RBAC permission. Strict period/value query: daily YYYY-MM-DD, monthly YYYY-MM, yearly YYYY; real calendar dates and years 1000–9998 only. Optional end_value uses the same format, must be greater than or equal to value, and defaults to value. The ending period is inclusive; end_at is midnight after that period. The response always includes the resolved end_value. Fixed Asia/Jakarta UTC+7 midnight boundaries, start-inclusive/end-exclusive, returned as UTC ISO timestamps. Aggregates live INCOME and EXPENSE transactions with null transfer_id across accessible active owned/group-shared accounts, using one RepeatableRead snapshot. TRANSFER legs are excluded. Decimal strings have two fractional digits; net_cashflow = income_total - expense_total. No currency conversion or cache.',
        security: [{ bearerAuth: [] }],
        request: { query: DashboardSummaryQuerySchema },
        responses: {
            200: {
                description: 'Cashflow summary',
                content: {
                    'application/json': {
                        schema: createSuccessResponseSchema(DashboardSummaryDtoSchema),
                        example: {
                            success: true,
                            message: 'Ringkasan dashboard berhasil diambil.',
                            timestamp: '2026-10-13 10:00:00',
                            total_data: 1,
                            data: {
                                period: 'monthly',
                                value: '2026-10',
                                end_value: '2026-10',
                                timezone: 'Asia/Jakarta',
                                start_at: '2026-09-30T17:00:00.000Z',
                                end_at: '2026-10-31T17:00:00.000Z',
                                income_total: '100.00',
                                expense_total: '30.00',
                                net_cashflow: '70.00',
                            },
                        },
                    },
                },
            },
            ...Object.fromEntries(
                ([400, 401, 422, 429, 500, 503] as const).map((status) => [
                    status,
                    {
                        description: {
                            400: 'Malformed request',
                            401: 'Invalid authentication/session',
                            422: 'Invalid query/calendar value',
                            429: 'Rate limit exceeded',
                            500: 'Unexpected server error',
                            503: 'Authentication dependency unavailable',
                        }[status],
                        content: {
                            'application/json': {
                                schema: ErrorResponseSchema,
                                example: {
                                    success: false,
                                    message: 'Permintaan tidak valid.',
                                    timestamp: '2026-10-13 10:00:00',
                                },
                            },
                        },
                    },
                ]),
            ),
        },
    });
}
