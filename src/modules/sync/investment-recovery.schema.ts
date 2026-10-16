import { createHash } from 'node:crypto';
import { z } from '../../common/openapi/zod.js';
import { OfflineInvestmentPayloadSchema } from './sync.schema.js';

export const RecoveryCommandSchema = z
  .strictObject({
    entity_type: z.literal('investment_transactions'),
    entity_id: z.uuid(),
    operation: z.literal('CREATE'),
    client_version: z.literal('0'),
    payload: OfflineInvestmentPayloadSchema,
  })
  .refine(
    (v) =>
      v.entity_id !== v.payload.linked_transaction_id &&
      v.payload.account_id !== v.payload.cash_account_id,
  );
export const RecoveryRequestSchema = z.strictObject({
  device_id: z.uuid(),
  command: RecoveryCommandSchema,
  command_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const RecoveryParamsSchema = z.strictObject({ tradeId: z.uuid() });
export const RecoveryReviewSchema = z.strictObject({
  decision: z.enum(['CANCELLED', 'DENIED']),
  reason: z.string().trim().min(1).max(1000),
});
export const RecoveryReceiptSchema = z.strictObject({
  user_id: z.uuid(),
  trade_id: z.uuid(),
  linked_transaction_id: z.uuid(),
  command_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['PENDING', 'CANCELLED', 'DENIED']),
  requested_at: z.iso.datetime(),
  reviewed_at: z.iso.datetime().nullable(),
});
export type RecoveryRequest = z.infer<typeof RecoveryRequestSchema>;
export type RecoveryReview = z.infer<typeof RecoveryReviewSchema>;
export function commandFingerprint(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, field]) => [key, canonical(field)]),
      );
    }
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('hex');
}
