import { z } from '../../common/openapi/zod.js';

export const NetWorthQuerySchema = z.strictObject({
  date: z.iso.date().optional().openapi({
    description:
      'UTC calendar date; defaults to today. Prior dates return first captured observation or unavailable; future dates rejected.',
  }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('IDR'),
});
export type NetWorthQuery = z.infer<typeof NetWorthQuerySchema>;
const Money = z.string().regex(/^-?\d+\.\d{2}$/);
export const NetWorthDtoSchema = z.strictObject({
  scope: z.literal('owner'),
  currency: z.string(),
  snapshot_date: z.iso.date(),
  observed_at: z.iso.datetime(),
  balance_basis: z.enum(['current_recorded_ledger', 'captured_recorded_ledger', 'unavailable']),
  status: z.enum(['complete', 'partial', 'unavailable']),
  obligation_liabilities: Money.nullable().optional(),
  receivables_value: Money.nullable().optional(),
  known_assets: Money.nullable(),
  known_balance_liabilities: Money.nullable(),
  known_net_worth: Money.nullable(),
  net_worth: Money.nullable(),
  cash_balance: Money.nullable(),
  investment_cash_balance: Money.nullable(),
  holdings_value: Money.nullable(),
  attribution: z.literal('unavailable'),
  missing_components: z.array(z.string()),
  excluded_account_count: z.number().int(),
  accounts: z.array(
    z.strictObject({
      account_id: z.uuid(),
      category: z.enum(['CASH', 'INVESTMENT']),
      balance: Money,
    }),
  ),
  holdings: z.array(
    z.strictObject({
      account_id: z.uuid(),
      instrument_id: z.uuid(),
      quantity: z.string(),
      market_value: Money.nullable(),
      price: z.string().nullable(),
      price_date: z.iso.date().nullable(),
      price_source: z.string().nullable(),
      stale: z.boolean().nullable(),
      unavailable_reason: z.string().nullable(),
    }),
  ),
});
export type NetWorthDto = z.infer<typeof NetWorthDtoSchema>;
