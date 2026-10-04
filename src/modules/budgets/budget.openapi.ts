import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  BudgetDtoSchema,
  BudgetIdParamsSchema,
  BudgetProgressDtoSchema,
  BudgetProgressQuerySchema,
  CreateBudgetSchema,
  ListBudgetsQuerySchema,
  UpdateBudgetSchema,
} from './budget.schema.js';

const id = '019a4fff-7000-7000-8000-000000000001';
const example = {
  id,
  category_id: '019a4fff-7000-7000-8000-000000000002',
  anchor_date: '2026-10-01',
  period_type: 'MONTHLY',
  base_currency: 'IDR',
  icon: null,
  description: null,
  sequence_order: '0',
  current_amount: '310000.00',
  created_at: '2026-10-04T10:00:00.000Z',
  updated_at: '2026-10-04T10:00:00.000Z',
  deleted_at: null,
};
const description =
  'JWT and active Redis session required; no RBAC permission. Only budgets with an active category owned by the authenticated user are accessible. Both INCOME and EXPENSE categories are allowed. IDR only; no currency conversion. No budget version field. Amount is a positive decimal(20,2) STRING (18 integer digits, up to 2 fractional digits); sequence_order is a signed bigint STRING. Strict snake_case input. UTC date boundaries are start-inclusive/end-exclusive. Owner advisory lock then budget/category row locks serialize mutations. Category, anchor_date and period_type are immutable after creation: changing them returns 409; create a new budget instead to preserve historical interpretation. PATCH can change icon, description, sequence_order and amount. An amount PATCH closes the current row at today UTC and inserts a new row effective today UTC; amounts are never overwritten. Same-day zero-duration rows are retained for audit. DELETE soft-deletes the budget only, retaining all amount history. Reads use RepeatableRead snapshots. No group access, sync publication or cached progress.';
export function registerBudgetOpenApi(registry: OpenAPIRegistry): void {
  registry.register('Budget', BudgetDtoSchema);
  registry.register('BudgetProgress', BudgetProgressDtoSchema);
  const errors = Object.fromEntries(
    ([400, 401, 404, 409, 422, 429, 500, 503] as const).map((status) => [
      status,
      {
        description: {
          400: 'Malformed request',
          401: 'Invalid authentication/session',
          404: 'Budget absent, deleted or not owned',
          409: 'Immutable category/schedule change or persistence conflict',
          422: 'Invalid input/category/period',
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
              timestamp: '2026-10-04 10:00:00',
            },
          },
        },
      },
    ]),
  );
  const success = (schema: z.ZodType, data: unknown) => ({
    description: 'Successful operation',
    content: {
      'application/json': {
        schema: Array.isArray(data)
          ? createSuccessResponseSchema(schema).extend({ pagination: PaginationSchema })
          : createSuccessResponseSchema(schema),
        example: {
          success: true,
          message: 'Anggaran berhasil diambil.',
          timestamp: '2026-10-04 10:00:00',
          total_data: Array.isArray(data) ? data.length : 1,
          data,
          ...(Array.isArray(data)
            ? {
                pagination: {
                  total: data.length,
                  per_page: 20,
                  current_page: 1,
                  last_page: 1,
                  from: data.length ? 1 : null,
                  to: data.length || null,
                },
              }
            : {}),
        },
      },
    },
  });
  const common = { tags: ['Budgets'], security: [{ bearerAuth: [] }], description };
  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/v1/budgets',
    operationId: 'listBudgets',
    summary: 'List owned budgets',
    request: { query: ListBudgetsQuerySchema },
    responses: { 200: success(z.array(BudgetDtoSchema), [example]), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path: '/api/v1/budgets',
    operationId: 'createBudget',
    summary: 'Create a budget and initial effective amount',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateBudgetSchema,
            example: {
              category_id: example.category_id,
              anchor_date: example.anchor_date,
              period_type: 'MONTHLY',
              amount: '310000.00',
              base_currency: 'IDR',
              sequence_order: '0',
            },
          },
        },
      },
    },
    responses: { 201: success(BudgetDtoSchema, example), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'patch',
    path: '/api/v1/budgets/{id}',
    operationId: 'updateBudget',
    summary: 'Update budget metadata or append a new amount',
    request: {
      params: BudgetIdParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateBudgetSchema,
            example: { amount: '620000.00', description: 'Revised allowance' },
          },
        },
      },
    },
    responses: {
      200: success(BudgetDtoSchema, { ...example, current_amount: '620000.00' }),
      ...errors,
    },
  });
  registry.registerPath({
    ...common,
    method: 'delete',
    path: '/api/v1/budgets/{id}',
    operationId: 'deleteBudget',
    summary: 'Soft-delete an owned budget',
    request: { params: BudgetIdParamsSchema },
    responses: { 204: { description: 'Budget soft-deleted; no response body' }, ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/v1/budgets/{id}/progress',
    operationId: 'getBudgetProgress',
    summary: 'Calculate progress using overlapping effective amount segments',
    description:
      description +
      ' Required period: MONTHLY YYYY-MM (start month), ANNUAL YYYY (start year), WEEKLY/DAILY YYYY-MM-DD (containing UTC day). Monthly starts on the anchor day clamped independently in each month, including day 31; annual starts on the anchor month/day, clamping February 29 in non-leap years; weekly starts on the anchor weekday on or before the requested date. Transactions count across the entire period: live category/type-matching transactions with null transfer_id and active IDR accounts/account types owned by the same user. TRANSFER legs are excluded. Overlap policy: each positive-duration amount segment contributes amount * active UTC days / period UTC days, rounded HALF_UP to cents per segment, then summed. Creation mid-period only funds active days. Zero-duration history is not returned. Monetary totals and percentages are decimal strings with 2 places, no floating-point money arithmetic; progress_percent = total_amount / allowance * 100 (not capped), null when allowance is zero. remaining_amount may be negative. current_amount is the latest open amount, not the historical period allowance. No past effective amount is overwritten; backdated transaction changes can still change historical transaction totals.',
    request: { params: BudgetIdParamsSchema, query: BudgetProgressQuerySchema },
    responses: {
      200: success(BudgetProgressDtoSchema, {
        budget: example,
        period: '2026-10',
        start: '2026-10-01T00:00:00.000Z',
        end: '2026-11-01T00:00:00.000Z',
        period_days: 31,
        total_amount: '140000.00',
        allowance: '280000.00',
        remaining_amount: '140000.00',
        progress_percent: '50.00',
        budget_amounts: [
          {
            id: '019a4fff-7000-7000-8000-000000000003',
            amount: '310000.00',
            effective_from: '2026-10-04',
            effective_to: null,
            start: '2026-10-04',
            end: '2026-11-01',
            active_days: 28,
            allowance: '280000.00',
          },
        ],
      }),
      ...errors,
    },
  });
}
