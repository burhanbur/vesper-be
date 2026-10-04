import { z } from '../../common/openapi/zod.js';
import { isCalendarDate } from '../../common/utils/budget-period.js';

export const InvestmentDateSchema = z
  .string()
  .refine(isCalendarDate, 'Tanggal harus YYYY-MM-DD yang valid.');
const precise = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,8})?$/)
  .refine((v) => /[1-9]/.test(v), 'Nilai harus positif.');
const fee = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/);
export const InstrumentTypeSchema = z.enum([
  'STOCK',
  'MUTUAL_FUND',
  'CRYPTO',
  'BOND',
  'GOLD',
  'OTHER',
]);
export const InvestmentTypeSchema = z.enum(['BUY', 'SELL', 'DIVIDEND']);
export const CreateInstrumentSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/),
  name: z.string().trim().min(1).max(255),
  type: InstrumentTypeSchema,
  currency: z.literal('IDR'),
});
const page = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const ListInstrumentsSchema = z.strictObject({
  ...page,
  search: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(['code', '-code']).default('code'),
});
export const ListPricesSchema = z.strictObject({
  ...page,
  instrument_id: z.uuid().optional(),
  price_date: InvestmentDateSchema.optional(),
  sort: z.enum(['price_date', '-price_date']).default('-price_date'),
});
export const CreatePriceSchema = z.strictObject({
  instrument_id: z.uuid(),
  price_date: InvestmentDateSchema,
  close_price: precise,
  source: z.literal('MANUAL').default('MANUAL'),
});
export const CreateInvestmentSchema = z.strictObject({
  instrument_id: z.uuid(),
  account_id: z.uuid(),
  cash_account_id: z.uuid().nullable().default(null),
  type: InvestmentTypeSchema,
  quantity: precise,
  price_per_unit: precise,
  fee: fee.default('0'),
  transacted_at: z.iso
    .datetime({ offset: true })
    .regex(/T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/)
    .refine((v) => Number.isFinite(Date.parse(v)), 'Timestamp tidak valid.'),
  description: z.string().trim().min(1).max(5000).nullable().optional(),
});
export const InvestmentAccountParamsSchema = z.strictObject({ id: z.uuid() });
export const EmptyInvestmentQuerySchema = z.strictObject({});
export const SnapshotQuerySchema = z.strictObject({ date: InvestmentDateSchema });
const timestamps = { created_at: z.iso.datetime(), updated_at: z.iso.datetime() };
export const InstrumentDtoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: InstrumentTypeSchema,
  currency: z.literal('IDR'),
  ...timestamps,
  deleted_at: z.iso.datetime().nullable(),
});
export const PriceDtoSchema = z.object({
  id: z.uuid(),
  instrument_id: z.uuid(),
  price_date: InvestmentDateSchema,
  close_price: z.string(),
  source: z.literal('MANUAL'),
  updated_by: z.uuid(),
  ...timestamps,
});
export const InvestmentDtoSchema = z.object({
  id: z.uuid(),
  instrument_id: z.uuid(),
  account_id: z.uuid(),
  cash_account_id: z.uuid().nullable(),
  linked_transaction_id: z.uuid().nullable(),
  type: InvestmentTypeSchema,
  quantity: z.string(),
  price_per_unit: z.string(),
  fee: z.string(),
  realized_pl: z.string().nullable(),
  transacted_at: z.iso.datetime(),
  description: z.string().nullable(),
  version: z.string(),
  created_by: z.uuid(),
  updated_by: z.uuid(),
  ...timestamps,
  deleted_at: z.iso.datetime().nullable(),
});
export const HoldingDtoSchema = z.object({
  instrument: InstrumentDtoSchema,
  quantity_held: z.string(),
  avg_cost_price: z.string(),
});
export const SnapshotDtoSchema = HoldingDtoSchema.extend({
  account_id: z.uuid(),
  snapshot_date: InvestmentDateSchema,
  market_price: z.string().nullable(),
  market_value: z.string().nullable(),
  unrealized_pl: z.string().nullable(),
});
export type CreateInstrumentInput = z.infer<typeof CreateInstrumentSchema>;
export type ListInstrumentsQuery = z.infer<typeof ListInstrumentsSchema>;
export type ListPricesQuery = z.infer<typeof ListPricesSchema>;
export type CreatePriceInput = z.infer<typeof CreatePriceSchema>;
export type CreateInvestmentInput = z.infer<typeof CreateInvestmentSchema>;
export type HoldingDto = z.infer<typeof HoldingDtoSchema>;
export type SnapshotDto = z.infer<typeof SnapshotDtoSchema>;
