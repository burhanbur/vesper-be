import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  CreateInstrumentSchema,
  CreatePriceSchema,
  CreateInvestmentSchema,
  ListInstrumentsSchema,
  ListPricesSchema,
  InstrumentDtoSchema,
  PriceDtoSchema,
  InvestmentDtoSchema,
  HoldingDtoSchema,
  SnapshotDtoSchema,
  InvestmentAccountParamsSchema,
  SnapshotQuerySchema,
} from './investment.schema.js';
const id = '019a4fff-7000-7000-8000-000000000001';
const accountId = '019a4fff-7000-7000-8000-000000000002';
const timestamps = {
  created_at: '2026-10-04T10:00:00.000Z',
  updated_at: '2026-10-04T10:00:00.000Z',
};
const instrument = {
  id,
  code: 'BBCA',
  name: 'Bank Central Asia',
  type: 'STOCK',
  currency: 'IDR',
  ...timestamps,
  deleted_at: null,
};
const price = {
  id: accountId,
  instrument_id: id,
  price_date: '2026-10-04',
  close_price: '9000.00000000',
  source: 'MANUAL',
  updated_by: accountId,
  ...timestamps,
};
const investment = {
  id,
  instrument_id: id,
  account_id: accountId,
  cash_account_id: null,
  linked_transaction_id: null,
  type: 'BUY',
  quantity: '100.00000000',
  price_per_unit: '9000.00000000',
  fee: '0.00',
  realized_pl: null,
  transacted_at: timestamps.created_at,
  description: null,
  version: '1',
  created_by: accountId,
  updated_by: accountId,
  ...timestamps,
  deleted_at: null,
};
const holding = { instrument, quantity_held: '100.00000000', avg_cost_price: '9000.00000000' };
export const INVESTMENT_POLICY =
  "JWT and active session required, no RBAC. Instruments and manual prices are global; investment and cash accounts must be active, IDR and owned OR explicitly shared through an active joined group. Holdings/snapshot reads use the same access policy. No FX. Required currency on instrument creation: IDR; codes uppercase, globally unique including deleted records. Decimal inputs are strict strings: positive quantity/prices decimal(20,8), fee >= 0 decimal(20,2). Chronological POST-only writes: timestamp (maximum millisecond precision) must be strictly greater than the latest transaction for account/instrument, including DIVIDEND; earlier/equal writes return 409. Moving weighted purchase average excludes BUY fees; SELL preserves remaining average, resets it at zero, rejects oversell. SELL realized P/L = quantity * (price - average) - fee; other types null. DIVIDEND quantity * price denotes gross entitlement and never changes units, including cash-null (no implicit reinvestment). Optional cash account must be distinct active accessible CASH IDR; BUY creates EXPENSE of quantity * price + fee; SELL/DIVIDEND create INCOME of quantity * price - fee. Cash rounds HALF_UP to cents and must be positive after rounding. Derived transaction category is null and manual edit/delete is forbidden. No cash account means no ledger row. All calculations use high-precision Decimal and bounded persisted values; overflow rolls back. Investment balance is not market value. Global instrument advisory lock precedes sorted actual-owner advisory locks, grant SHARE locks and sorted type/account locks. Revocation coordinates via group/grant locks; account metadata remains owner-only. Price upsert synchronously regenerates all users' as-of-day snapshots and later stored snapshots; investment POST regenerates impacted price dates and stored snapshots. Batches bound query memory, but total work can exceed the 60-second transaction timeout: all writes roll back, never partial success. Snapshot uses transactions before next UTC day and last price <= date; missing price produces null valuation, never zero. Zero holdings are retained. No Redis price cache, jobs, external APIs or sync publication yet.";
export function registerInvestmentOpenApi(registry: OpenAPIRegistry): void {
  registry.register('Instrument', InstrumentDtoSchema);
  registry.register('InstrumentPrice', PriceDtoSchema);
  registry.register('InvestmentTransaction', InvestmentDtoSchema);
  registry.register('InvestmentHolding', HoldingDtoSchema);
  registry.register('PortfolioSnapshot', SnapshotDtoSchema);
  const errors = Object.fromEntries(
    ([400, 401, 404, 409, 422, 429, 500, 503] as const).map((status) => [
      status,
      {
        description: {
          400: 'Malformed request',
          401: 'Invalid authentication or inactive session',
          404: 'Instrument/account missing or inaccessible',
          409: 'Duplicate code, chronology, oversell, numeric or persistence conflict',
          422: 'Invalid input, account category, currency or cash net amount',
          429: 'Rate limited',
          500: 'Unexpected error or synchronous regeneration timeout; rolled back',
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
  const success = (schema: z.ZodType, data: unknown, paginated = false) => ({
    description: 'Successful operation',
    content: {
      'application/json': {
        schema: paginated
          ? createSuccessResponseSchema(schema).extend({ pagination: PaginationSchema })
          : createSuccessResponseSchema(schema),
        example: {
          success: true,
          message: 'Data berhasil diambil.',
          timestamp: '2026-10-04 10:00:00',
          total_data: Array.isArray(data) ? data.length : 1,
          data,
          ...(paginated
            ? {
                pagination: {
                  total: 1,
                  per_page: 20,
                  current_page: 1,
                  last_page: 1,
                  from: 1,
                  to: 1,
                },
              }
            : {}),
        },
      },
    },
  });
  const common = {
    tags: ['Investments'],
    security: [{ bearerAuth: [] }],
    description: INVESTMENT_POLICY,
  };
  const body = (schema: z.ZodType, example: unknown) => ({
    required: true,
    content: { 'application/json': { schema, example } },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/v1/instruments',
    operationId: 'listInstruments',
    summary: 'Search global instruments by code or name',
    request: { query: ListInstrumentsSchema },
    responses: { 200: success(z.array(InstrumentDtoSchema), [instrument], true), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path: '/api/v1/instruments',
    operationId: 'createInstrument',
    summary: 'Create a globally unique instrument',
    request: {
      body: body(CreateInstrumentSchema, {
        code: 'BBCA',
        name: 'Bank Central Asia',
        type: 'STOCK',
        currency: 'IDR',
      }),
    },
    responses: { 201: success(InstrumentDtoSchema, instrument), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/v1/instrument-prices',
    operationId: 'listInstrumentPrices',
    summary: 'List global manual prices',
    request: { query: ListPricesSchema },
    responses: { 200: success(z.array(PriceDtoSchema), [price], true), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path: '/api/v1/instrument-prices',
    operationId: 'upsertInstrumentPrice',
    summary: 'Upsert price and atomically regenerate cross-user snapshots',
    request: {
      body: body(CreatePriceSchema, {
        instrument_id: id,
        price_date: '2026-10-04',
        close_price: '9000.00',
        source: 'MANUAL',
      }),
    },
    responses: { 200: success(PriceDtoSchema, price), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path: '/api/v1/investment-transactions',
    operationId: 'createInvestmentTransaction',
    summary: 'Append BUY, SELL or DIVIDEND with optional cash ledger entry',
    request: {
      body: body(CreateInvestmentSchema, {
        instrument_id: id,
        account_id: accountId,
        cash_account_id: null,
        type: 'BUY',
        quantity: '100',
        price_per_unit: '9000',
        fee: '0',
        transacted_at: timestamps.created_at,
      }),
    },
    responses: { 201: success(InvestmentDtoSchema, investment), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/v1/accounts/{id}/holdings',
    operationId: 'getInvestmentHoldings',
    summary: 'Read moving-average holdings in an owned investment account',
    request: { params: InvestmentAccountParamsSchema },
    responses: { 200: success(z.array(HoldingDtoSchema), [holding]), ...errors },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/v1/accounts/{id}/portfolio-snapshot',
    operationId: 'getPortfolioSnapshot',
    summary: 'Read as-of UTC day valuation with missing-price nulls',
    request: { params: InvestmentAccountParamsSchema, query: SnapshotQuerySchema },
    responses: {
      200: success(z.array(SnapshotDtoSchema), [
        {
          ...holding,
          account_id: accountId,
          snapshot_date: '2026-10-04',
          market_price: '9000.00000000',
          market_value: '900000.00',
          unrealized_pl: '0.00',
        },
      ]),
      ...errors,
    },
  });
}
