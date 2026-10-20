import { createHash } from 'node:crypto';
import { z } from '../../common/openapi/zod.js';

const money = z.string().regex(/^(0|[1-9]\d{0,17})\.\d{2}$/);
const positive = money.refine((v) => /[1-9]/.test(v), 'Pokok harus positif.');
const version = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const ids = z.strictObject({
  cash_principal: z.uuid(),
  mapped_principal: z.uuid(),
  interest: z.uuid(),
  fee: z.uuid(),
});
const base = { obligation_id: z.uuid(), ledger_ids: ids, transacted_at: z.iso.datetime() };
const installment = z.strictObject({ due_date: z.iso.date(), principal: positive });
export const ObligationCommandSchema = z
  .discriminatedUnion('action', [
    z.strictObject({
      ...base,
      action: z.literal('OPEN'),
      kind: z.enum(['PAYABLE', 'RECEIVABLE']),
      counterparty: z.string().trim().min(1).max(255),
      currency: z.literal('IDR'),
      principal: positive,
      due_date: z.iso.date().nullable(),
      installments: z.array(installment).max(360),
      cash_account_id: z.uuid().nullable(),
      linked_account_id: z.uuid().nullable(),
    }),
    z.strictObject({
      ...base,
      action: z.literal('REPAY'),
      expected_version: version,
      cash_account_id: z.uuid(),
      principal: positive,
      interest: money,
      fee: money,
      interest_category_id: z.uuid().nullable(),
      fee_category_id: z.uuid().nullable(),
    }),
    z.strictObject({
      ...base,
      action: z.literal('REVERSE'),
      expected_version: version,
      target_event_id: z.uuid(),
    }),
    z.strictObject({ ...base, action: z.literal('DELETE'), expected_version: version }),
  ])
  .refine((v) => new Set(Object.values(v.ledger_ids)).size === 4, 'ID ledger harus berbeda.')
  .refine(
    (v) => v.action !== 'OPEN' || !v.cash_account_id || !v.linked_account_id,
    'Pilih pendanaan baru atau akun lama.',
  );
export type ObligationCommand = z.infer<typeof ObligationCommandSchema>;

// Canonical keys; identical persisted commands fingerprint equally across devices.
export function obligationFingerprint(command: ObligationCommand): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify(canonical(command)))
    .digest('hex');
}
export const ObligationDtoSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  kind: z.enum(['PAYABLE', 'RECEIVABLE']),
  counterparty: z.string(),
  currency: z.literal('IDR'),
  principal: money,
  outstanding: money,
  due_date: z.iso.date().nullable(),
  installments: z.array(installment),
  linked_account_id: z.uuid().nullable(),
  version: version,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
export const ObligationEventDtoSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  obligation_id: z.uuid().nullable(),
  operation: z.string(),
  principal: money,
  interest: money,
  fee: money,
  cash_account_id: z.uuid().nullable(),
  cash_principal_id: z.uuid().nullable(),
  mapped_principal_id: z.uuid().nullable(),
  interest_id: z.uuid().nullable(),
  fee_id: z.uuid().nullable(),
  target_event_id: z.uuid().nullable(),
  transacted_at: z.iso.datetime(),
  reversed_at: z.iso.datetime().nullable(),
  version: version,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
