import { z } from '../../common/openapi/zod.js';
import { isCalendarDate } from '../../common/utils/budget-period.js';

export const PeriodTypeSchema = z.enum(['MONTHLY', 'WEEKLY', 'DAILY', 'ANNUAL']);
const DateSchema = z.string().refine(isCalendarDate, 'Tanggal harus YYYY-MM-DD yang valid.');
const AmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/)
  .refine((value) => /[1-9]/.test(value), 'Nominal harus positif.');
const SequenceSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,18})$/)
  .refine(
    (value) =>
      /^-?(0|[1-9]\d{0,18})$/.test(value) &&
      BigInt(value) >= -9223372036854775808n &&
      BigInt(value) <= 9223372036854775807n,
  );
const fields = {
  category_id: z.uuid(),
  anchor_date: DateSchema,
  period_type: PeriodTypeSchema,
  base_currency: z.literal('IDR'),
  icon: z.string().trim().min(1).max(120).nullable(),
  description: z.string().trim().min(1).max(5000).nullable(),
  sequence_order: SequenceSchema,
  amount: AmountSchema,
};
export const CreateBudgetSchema = z.strictObject({
  ...fields,
  base_currency: fields.base_currency.default('IDR'),
  icon: fields.icon.optional(),
  description: fields.description.optional(),
  sequence_order: fields.sequence_order.default('0'),
});
export const UpdateBudgetSchema = z
  .strictObject(fields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Minimal satu field diperlukan.');
export const BudgetIdParamsSchema = z.strictObject({ id: z.uuid() });
export const EmptyBudgetQuerySchema = z.strictObject({});
export const ListBudgetsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['created_at', '-created_at', 'sequence_order', '-sequence_order'])
    .default('-created_at'),
  category_id: z.uuid().optional(),
  period_type: PeriodTypeSchema.optional(),
});
export const BudgetProgressQuerySchema = z.strictObject({
  period: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
});
export const BudgetDtoSchema = z.object({
  id: z.uuid(),
  category_id: z.uuid(),
  anchor_date: DateSchema,
  period_type: PeriodTypeSchema,
  base_currency: z.literal('IDR'),
  icon: fields.icon,
  description: fields.description,
  sequence_order: z.string(),
  current_amount: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
export const BudgetAmountSegmentSchema = z.object({
  id: z.uuid(),
  amount: z.string(),
  effective_from: DateSchema,
  effective_to: DateSchema.nullable(),
  start: DateSchema,
  end: DateSchema,
  active_days: z.number().int(),
  allowance: z.string(),
});
export const BudgetProgressDtoSchema = z.object({
  budget: BudgetDtoSchema,
  period: z.string(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  period_days: z.number().int(),
  total_amount: z.string(),
  allowance: z.string(),
  remaining_amount: z.string(),
  progress_percent: z.string().nullable(),
  budget_amounts: z.array(BudgetAmountSegmentSchema),
});
export type CreateBudgetInput = z.infer<typeof CreateBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof UpdateBudgetSchema>;
export type ListBudgetsQuery = z.infer<typeof ListBudgetsQuerySchema>;
export type BudgetDto = z.infer<typeof BudgetDtoSchema>;
export type BudgetProgressDto = z.infer<typeof BudgetProgressDtoSchema>;
