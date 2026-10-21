import { z } from '../../common/openapi/zod.js';

export const GoalMoneySchema = z.string().regex(/^(0|[1-9]\d{0,17})\.\d{2}$/);
export const CreateGoalSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    currency: z.string().regex(/^[A-Z]{3}$/),
    target_amount: GoalMoneySchema.refine((value) => /[1-9]/.test(value), 'Target harus positif.'),
    start_date: z.iso.date(),
    target_date: z.iso.date(),
    group_id: z.uuid().nullable(),
  })
  .refine((value) => value.target_date >= value.start_date, 'Tanggal target mendahului awal.');
export const UpdateGoalSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  target_amount: GoalMoneySchema.refine((value) => /[1-9]/.test(value)),
  target_date: z.iso.date(),
  status: z.enum(['ACTIVE', 'COMPLETED']),
});
export const CreateGoalAllocationSchema = z.strictObject({
  goal_id: z.uuid(),
  account_id: z.uuid(),
  amount: GoalMoneySchema,
});
export const UpdateGoalAllocationSchema = z.strictObject({ amount: GoalMoneySchema });
const audit = {
  id: z.uuid(),
  user_id: z.uuid(),
  version: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
};
export const GoalDtoSchema = z.strictObject({
  ...audit,
  name: z.string(),
  currency: z.string(),
  target_amount: GoalMoneySchema,
  start_date: z.iso.date(),
  target_date: z.iso.date(),
  group_id: z.uuid().nullable(),
  status: z.enum(['ACTIVE', 'COMPLETED']),
});
export const GoalAllocationDtoSchema = z.strictObject({
  ...audit,
  goal_id: z.uuid(),
  account_id: z.uuid().nullable(),
  amount: GoalMoneySchema,
  backed_amount: GoalMoneySchema,
  backing_checked_at: z.iso.datetime(),
});
