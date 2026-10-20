import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { NetWorthDtoSchema, NetWorthQuerySchema } from './net-worth.schema.js';

export function registerNetWorthOpenApi(registry: OpenAPIRegistry): void {
  registry.register('NetWorthSnapshot', NetWorthDtoSchema);
  registry.registerPath({
    method: 'get',
    path: '/api/v1/net-worth/snapshots',
    operationId: 'getNetWorthSnapshot',
    tags: ['Net Worth'],
    summary: 'Read an owner-scoped dated net worth assessment',
    description:
      "Access JWT and active session required; no additional RBAC permission. Owner-only, including own shared accounts but never other members' accounts. One currency, no FX. Current UTC date is a live recorded-ledger observation; GET also durably captures the first observation per owner/currency/UTC date, without financial mutation. Prior dates return the exact captured DTO with balance_basis captured_recorded_ledger and original observed_at, or unavailable with null totals if never captured. Captures are point-in-time, not end-of-day; late changes never rewrite them. No backfill or reconstructed cashflow. Historical access requires current active authenticated identity and never household sharing. Future dates return 422. Eligible active leaf accounts require is_include_total; parents excluded defensively. CASH and INVESTMENT ledger balances count once; priced BUY minus SELL holdings added once, DIVIDEND excluded from quantity. Negative ledger balances contribute to known_balance_liabilities, not a full debt model. Missing prices/instruments/currency mismatch yield null position values, never zero. Underlying manual price date/source returned; stale means price_date before snapshot_date. known_* are partial supported subtotals; net_worth always null until liabilities/receivables modeled. Attribution unavailable. No HTTP cache; durable derived owner-only observations; at most 1000 owner currency accounts and 10000 position groups (422 beyond limits). See docs/net-worth.md.",
    security: [{ bearerAuth: [] }],
    request: { query: NetWorthQuerySchema },
    responses: {
      200: {
        description:
          'Partial live or captured observation, or explicitly unavailable missing history',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(NetWorthDtoSchema),
            example: {
              success: true,
              message: 'Snapshot kekayaan berhasil diambil.',
              timestamp: '2026-10-20 10:00:00',
              total_data: 1,
              data: {
                scope: 'owner',
                currency: 'IDR',
                snapshot_date: '2026-10-19',
                observed_at: '2026-10-20T03:00:00.000Z',
                balance_basis: 'unavailable',
                status: 'unavailable',
                known_assets: null,
                known_balance_liabilities: null,
                known_net_worth: null,
                net_worth: null,
                cash_balance: null,
                investment_cash_balance: null,
                holdings_value: null,
                attribution: 'unavailable',
                missing_components: [
                  'historical_balance_evidence_unavailable',
                  'liabilities_unmodeled',
                  'receivables_unmodeled',
                  'attribution_unavailable',
                ],
                excluded_account_count: 0,
                accounts: [],
                holdings: [],
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
              422: 'Invalid query, future date or scope limit',
              429: 'Rate limited',
              500: 'Unexpected error',
              503: 'Authentication unavailable',
            }[status],
            content: {
              'application/json': {
                schema: ErrorResponseSchema,
                example: {
                  success: false,
                  message: 'Permintaan tidak valid.',
                  timestamp: '2026-10-20 10:00:00',
                },
              },
            },
          },
        ]),
      ),
    },
  });
}
