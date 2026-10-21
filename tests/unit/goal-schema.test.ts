import { describe, expect, it } from 'vitest';
import {
  CreateGoalSchema,
  CreateGoalAllocationSchema,
  UpdateGoalAllocationSchema,
} from '../../src/modules/goals/goal.schema.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';

const goal = {
  name: 'Goal',
  currency: 'IDR',
  target_amount: '1000.00',
  start_date: '2026-10-21',
  target_date: '2027-10-21',
  group_id: null,
};
describe('goal contracts', () => {
  it('requires positive exact decimal target, real dates and explicit scope', () => {
    expect(CreateGoalSchema.parse(goal)).toEqual(goal);
    for (const patch of [
      { target_amount: '0.00' },
      { target_amount: '1.001' },
      { target_amount: '1e3' },
      { target_amount: 10 },
      { target_date: '2026-02-30' },
      { target_date: '2026-10-20' },
      { currency: 'idr' },
      { user_id: 'foreign' },
    ]) {
      expect(CreateGoalSchema.safeParse({ ...goal, ...patch }).success).toBe(false);
    }
  });
  it('withdraws via zero allocation and prevents retargeting an existing allocation', () => {
    expect(UpdateGoalAllocationSchema.parse({ amount: '0.00' })).toEqual({ amount: '0.00' });
    expect(UpdateGoalAllocationSchema.safeParse({ amount: '-1.00' }).success).toBe(false);
    expect(
      UpdateGoalAllocationSchema.safeParse({ amount: '10.00', account_id: 'foreign' }).success,
    ).toBe(false);
    expect(
      CreateGoalAllocationSchema.safeParse({ goal_id: 'bad', account_id: 'bad', amount: '10.00' })
        .success,
    ).toBe(false);
  });
  it('uses the existing versioned sync envelope for goals and soft deletions', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      PushItemSchema.parse({
        entity_type: 'goals',
        entity_id: id,
        operation: 'CREATE',
        client_version: '0',
        payload: goal,
      }).entity_type,
    ).toBe('goals');
    expect(
      PushItemSchema.parse({
        entity_type: 'goal_allocations',
        entity_id: id,
        operation: 'DELETE',
        client_version: '1',
        payload: null,
      }).operation,
    ).toBe('DELETE');
  });
});
