import { describe, expect, it } from 'vitest';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';

const command = {
  entity_type: 'investment_transactions',
  entity_id: '019a0000-0000-7000-8000-000000000001',
  operation: 'CREATE',
  client_version: '0',
  payload: {
    instrument_id: '019a0000-0000-7000-8000-000000000002',
    account_id: '019a0000-0000-7000-8000-000000000003',
    cash_account_id: '019a0000-0000-7000-8000-000000000004',
    linked_transaction_id: '019a0000-0000-7000-8000-000000000005',
    type: 'BUY',
    quantity: '2.00000001',
    price_per_unit: '10.25',
    fee: '0.50',
    transacted_at: '2026-10-15T10:00:00.000Z',
    description: null,
  },
};

describe('investment sync command validation', () => {
  it.each(['BUY', 'SELL'])('accepts exact decimal %s commands', (type) => {
    expect(
      PushItemSchema.safeParse({ ...command, payload: { ...command.payload, type } }).success,
    ).toBe(true);
  });
  it.each([
    { type: 'DIVIDEND' },
    { cash_account_id: null },
    { quantity: 2 },
    { quantity: '0' },
    { quantity: '1.000000001' },
    { fee: '0.001' },
    { linked_transaction_id: command.entity_id },
    { unexpected: true },
  ])('rejects invalid payload %j', (payload) => {
    expect(
      PushItemSchema.safeParse({ ...command, payload: { ...command.payload, ...payload } }).success,
    ).toBe(false);
  });
  it.each(['UPDATE', 'DELETE'])('rejects %s even with a positive version', (operation) => {
    expect(
      PushItemSchema.safeParse({
        ...command,
        operation,
        client_version: '1',
        payload: operation === 'DELETE' ? null : command.payload,
      }).success,
    ).toBe(false);
  });
  it('requires CREATE version zero', () => {
    expect(PushItemSchema.safeParse({ ...command, client_version: '1' }).success).toBe(false);
  });
});
