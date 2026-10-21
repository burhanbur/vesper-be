import { z } from '../../common/openapi/zod.js';
import { GoalMoneySchema } from '../goals/goal.schema.js';

const identities = (maximum: number) =>
  z
    .array(z.uuid())
    .max(maximum)
    .refine((ids) => new Set(ids).size === ids.length, 'Pilihan tidak boleh duplikat.');
export const EmergencyPlanInputSchema = z
  .strictObject({
    currency: z.literal('IDR'),
    baseline_mode: z.enum(['MANUAL', 'HISTORY']),
    manual_baseline: GoalMoneySchema.nullable(),
    coverage_months: z.number().int().min(1).max(60),
    history_months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    account_ids: identities(100),
    category_ids: identities(200),
    goal_id: z.uuid().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.baseline_mode === 'MANUAL') {
      const amount = value.manual_baseline;
      if (amount === null || !/[1-9]/.test(amount)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Baseline manual harus positif.',
          path: ['manual_baseline'],
        });
      } else if (
        /^(0|[1-9]\d{0,17})\.\d{2}$/.test(amount) &&
        BigInt(amount.replace('.', '')) * BigInt(value.coverage_months) > 99999999999999999999n
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Target melampaui batas nominal.',
          path: ['manual_baseline'],
        });
      }
    } else if (value.manual_baseline !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Mode histori tidak memakai baseline manual.',
        path: ['manual_baseline'],
      });
    }
  });
export const EmergencyPlanDtoSchema = EmergencyPlanInputSchema.safeExtend({
  id: z.uuid(),
  user_id: z.uuid(),
  version: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
