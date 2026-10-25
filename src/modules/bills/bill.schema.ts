import { createHash } from 'node:crypto';
import { v5 } from 'uuid';
import { z } from '../../common/openapi/zod.js';
import { GoalMoneySchema } from '../goals/goal.schema.js';

export const CreateBillSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120),
    transaction_type: z.enum(['INCOME', 'EXPENSE']),
    amount_type: z.enum(['FIXED', 'ESTIMATED']),
    amount: GoalMoneySchema.refine((v) => /[1-9]/.test(v)),
    account_id: z.uuid(),
    category_id: z.uuid().nullable(),
    obligation_id: z.uuid().nullable(),
    frequency: z.enum(['ONCE', 'WEEKLY', 'MONTHLY', 'YEARLY', 'INSTALLMENTS']),
    anchor_date: z.iso.date(),
    end_date: z.iso.date().nullable(),
    utc_offset_minutes: z.union([z.literal(0), z.literal(420), z.literal(480), z.literal(540)]),
    reminder_enabled: z.boolean(),
    reminder_days: z.number().int().min(0).max(30),
  })
  .superRefine((v, ctx) => {
    if (v.end_date && v.end_date < v.anchor_date)
      ctx.addIssue({ code: 'custom', message: 'Tanggal akhir tidak valid.' });
    if (
      v.obligation_id
        ? v.frequency !== 'INSTALLMENTS' || v.category_id !== null || v.amount_type !== 'FIXED'
        : v.frequency === 'INSTALLMENTS' || v.category_id === null
    )
      ctx.addIssue({ code: 'custom', message: 'Periksa kategori dan jadwal cicilan.' });
  });
export const UpdateBillSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  active: z.boolean(),
  reminder_enabled: z.boolean(),
  reminder_days: z.number().int().min(0).max(30),
});
export const BillCommandSchema = z
  .strictObject({
    bill_id: z.uuid(),
    due_date: z.iso.date(),
    action: z.enum(['PAY', 'SKIP', 'REOPEN', 'LINK_TRANSACTION', 'LINK_OBLIGATION']),
    expected_version: z.string().regex(/^(0|[1-9]\d{0,18})$/),
    amount: GoalMoneySchema.nullable(),
    record_id: z.uuid().nullable(),
    ledger_id: z.uuid(),
    transacted_at: z.iso.datetime({ offset: true }),
    note: z.string().trim().max(500),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'PAY' && (v.amount === null || !/[1-9]/.test(v.amount)))
      ctx.addIssue({ code: 'custom', message: 'Isi nominal aktual.' });
    if (v.action.startsWith('LINK_') && !v.record_id)
      ctx.addIssue({ code: 'custom', message: 'Pilih pembayaran yang sudah dicatat.' });
    if (v.action === 'SKIP' && !v.note)
      ctx.addIssue({ code: 'custom', message: 'Isi alasan dilewati.' });
  });
export type BillCommandInput = z.infer<typeof BillCommandSchema>;
export const BillScheduleDtoSchema = CreateBillSchema.safeExtend({
  id: z.uuid(),
  user_id: z.uuid(),
  installments: z.array(z.strictObject({ due_date: z.iso.date(), principal: GoalMoneySchema })),
  active: z.boolean(),
  version: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
export const BillOccurrenceDtoSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  bill_id: z.uuid(),
  due_date: z.iso.date(),
  status: z.enum(['PENDING', 'PAID', 'SKIPPED', 'NEEDS_REVIEW']),
  amount: GoalMoneySchema,
  transaction_id: z.uuid().nullable(),
  obligation_event_id: z.uuid().nullable(),
  note: z.string(),
  version: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const billOccurrenceId = (bill: string, date: string) => v5(date, bill);
export const billFingerprint = (input: BillCommandInput) =>
  createHash('sha256')
    .update(JSON.stringify(BillCommandSchema.parse(input)))
    .digest('hex');
export function billDue(
  bill: { frequency: string; anchorDate: Date; endDate: Date | null; installments: unknown },
  date: string,
): string | null {
  const at = new Date(`${date}T00:00:00Z`),
    anchor = bill.anchorDate;
  if (at < anchor || (bill.endDate && at > bill.endDate)) return null;
  if (bill.frequency === 'INSTALLMENTS') {
    if (!Array.isArray(bill.installments)) return null;
    const row: unknown = bill.installments.find(
      (v: unknown) => v && typeof v === 'object' && Reflect.get(v, 'due_date') === date,
    );
    return row && typeof row === 'object' ? String(Reflect.get(row, 'principal')) : null;
  }
  if (bill.frequency === 'ONCE') return at.getTime() === anchor.getTime() ? 'scheduled' : null;
  if (bill.frequency === 'WEEKLY')
    return ((at.getTime() - anchor.getTime()) / 86400000) % 7 === 0 ? 'scheduled' : null;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  if (at.getUTCDate() !== Math.min(anchor.getUTCDate(), lastDay)) return null;
  if (bill.frequency === 'YEARLY' && at.getUTCMonth() !== anchor.getUTCMonth()) return null;
  return 'scheduled';
}
