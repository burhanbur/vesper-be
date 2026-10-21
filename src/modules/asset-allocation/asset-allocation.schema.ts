import { z } from '../../common/openapi/zod.js';

export const assetClasses = [
  'CASH',
  'RECEIVABLE',
  'STOCK',
  'MUTUAL_FUND',
  'CRYPTO',
  'BOND',
  'GOLD',
  'OTHER',
] as const;
export const AllocationQuerySchema = z.strictObject({ currency: z.literal('IDR').default('IDR') });
const amount = z.string().regex(/^\d+\.\d{2}$/);
const weight = z
  .string()
  .regex(/^\d+\.\d{2}$/)
  .nullable();
export const AllocationClassSchema = z.object({
  asset_class: z.enum([...assetClasses, 'UNCLASSIFIED']),
  known_amount: amount,
  market_value: amount.nullable(),
  weight_percent: weight,
  unavailable_count: z.number().int().nonnegative(),
});
export const AllocationInstrumentSchema = z.object({
  instrument_id: z.uuid(),
  code: z.string().nullable(),
  name: z.string().nullable(),
  asset_class: z.enum([...assetClasses, 'UNCLASSIFIED']),
  quantity: z.string().regex(/^-?\d+\.\d{8}$/),
  account_count: z.number().int().positive(),
  known_amount: amount,
  market_value: amount.nullable(),
  weight_percent: weight,
  price_date: z.iso.date().nullable(),
  price_source: z.string().nullable(),
  stale: z.boolean().nullable(),
  unavailable_reasons: z.array(z.string()),
});
export const AllocationDtoSchema = z.object({
  scope: z.literal('owner'),
  currency: z.literal('IDR'),
  snapshot_date: z.iso.date(),
  observed_at: z.iso.datetime(),
  balance_basis: z.literal('current_recorded_ledger'),
  status: z.enum(['complete', 'partial']),
  denominator: z.literal('gross_positive_supported_assets'),
  known_assets: amount,
  total_assets: amount.nullable(),
  excluded_liabilities: amount,
  excluded_account_count: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  classes: z.array(AllocationClassSchema),
  instruments: z.array(AllocationInstrumentSchema),
});
export type AllocationDto = z.infer<typeof AllocationDtoSchema>;
