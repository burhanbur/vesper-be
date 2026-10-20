import { describe, expect, it } from 'vitest';
import {
  ObligationCommandSchema,
  obligationFingerprint,
} from '../../src/modules/obligations/obligation.schema.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
const uuid = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const payload = {
  action: 'OPEN',
  obligation_id: uuid(1),
  ledger_ids: {
    cash_principal: uuid(2),
    mapped_principal: uuid(3),
    interest: uuid(4),
    fee: uuid(5),
  },
  kind: 'PAYABLE',
  counterparty: 'Person',
  currency: 'IDR',
  principal: '100.00',
  due_date: '2026-11-20',
  installments: [],
  cash_account_id: uuid(6),
  linked_account_id: null,
  transacted_at: '2026-10-20T10:00:00.000Z',
};
describe('obligation sync boundary', () => {
  it('accepts commands and cancellations, fingerprints canonical field ordering', () => {
    const parsed = ObligationCommandSchema.parse(payload);
    const reordered = ObligationCommandSchema.parse(
      Object.fromEntries(Object.entries(payload).reverse()),
    );
    expect(obligationFingerprint(parsed)).toBe(obligationFingerprint(reordered));
    for (const entity of ['obligation_commands', 'obligation_cancellations'])
      expect(
        PushItemSchema.safeParse({
          entity_type: entity,
          entity_id: uuid(7),
          client_version: '0',
          operation: 'CREATE',
          payload,
        }).success,
      ).toBe(true);
  });
  it.each([
    { principal: 100 },
    { principal: '0.00' },
    { principal: '0.001' },
    { principal: '1e2' },
    { principal: '1000000000000000000.00' },
    { currency: 'USD' },
    { due_date: '2026-02-30' },
    { user_id: uuid(8) },
    { counterparty: '' },
    { linked_account_id: uuid(8) },
    { ledger_ids: { ...payload.ledger_ids, fee: uuid(2) } },
  ])('rejects malformed or unsafe fields %j', (fields) => {
    expect(ObligationCommandSchema.safeParse({ ...payload, ...fields }).success).toBe(false);
  });
  it('forbids generic record mutations and nonzero create versions', () => {
    for (const entity of ['obligations', 'obligation_events'])
      expect(
        PushItemSchema.safeParse({
          entity_type: entity,
          entity_id: uuid(7),
          client_version: '1',
          operation: 'DELETE',
          payload: null,
        }).success,
      ).toBe(false);
    expect(
      PushItemSchema.safeParse({
        entity_type: 'obligation_commands',
        entity_id: uuid(7),
        client_version: '1',
        operation: 'CREATE',
        payload,
      }).success,
    ).toBe(false);
  });
});
