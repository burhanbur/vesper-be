import { describe, expect, it } from 'vitest';
import {
  billDue,
  billOccurrenceId,
  CreateBillSchema,
  UpdateBillSchema,
  BillCommandSchema,
} from '../../src/modules/bills/bill.schema.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('bill calendar/contracts', () => {
  it('clamps month/year anchor without drift and has deterministic occurrence keys', () => {
    const b = {
      frequency: 'MONTHLY',
      anchorDate: new Date('2026-01-31'),
      endDate: null,
      installments: [],
    };
    expect(billDue(b, '2026-02-28')).toBe('scheduled');
    expect(billDue(b, '2026-03-31')).toBe('scheduled');
    expect(billDue(b, '2026-03-28')).toBeNull();
    b.frequency = 'YEARLY';
    b.anchorDate = new Date('2024-02-29');
    expect(billDue(b, '2025-02-28')).toBe('scheduled');
    expect(billDue(b, '2028-02-29')).toBe('scheduled');
    expect(billOccurrenceId(id, '2026-02-28')).toBe(billOccurrenceId(id, '2026-02-28'));
  });
  it('enforces owned manual category shape, dates and immutable schedule terms', () => {
    const input = {
      title: 'Bill',
      transaction_type: 'EXPENSE',
      amount_type: 'FIXED',
      amount: '100.00',
      account_id: id,
      category_id: id,
      obligation_id: null,
      frequency: 'MONTHLY',
      anchor_date: '2026-01-31',
      end_date: null,
      utc_offset_minutes: 420,
      reminder_enabled: true,
      reminder_days: 3,
    };
    expect(CreateBillSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { amount: '0.00' },
      { anchor_date: '2026-02-30' },
      { end_date: '2025-01-01' },
      { utc_offset_minutes: 60 },
      { reminder_days: 31 },
      { category_id: null },
    ])
      expect(CreateBillSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    expect(
      UpdateBillSchema.safeParse({
        title: 'Edit',
        active: true,
        reminder_enabled: false,
        reminder_days: 0,
        amount: '200.00',
      }).success,
    ).toBe(false);
  });
  it('requires actual payment, link evidence and skip reason before a command can execute', () => {
    const base = {
      bill_id: id,
      due_date: '2026-02-28',
      action: 'PAY',
      expected_version: '0',
      amount: null,
      record_id: null,
      ledger_id: id,
      transacted_at: '2026-02-28T00:00:00.000Z',
      note: '',
    };
    expect(BillCommandSchema.safeParse(base).success).toBe(false);
    expect(BillCommandSchema.safeParse({ ...base, amount: '100.00' }).success).toBe(true);
    expect(BillCommandSchema.safeParse({ ...base, action: 'LINK_TRANSACTION' }).success).toBe(
      false,
    );
    expect(BillCommandSchema.safeParse({ ...base, action: 'SKIP' }).success).toBe(false);
  });
});
