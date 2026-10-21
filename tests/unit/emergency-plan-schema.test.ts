import { describe, expect, it } from 'vitest';
import { EmergencyPlanInputSchema } from '../../src/modules/emergency-funds/emergency-plan.schema.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  currency: 'IDR',
  baseline_mode: 'MANUAL',
  manual_baseline: '300.00',
  coverage_months: 6,
  history_months: 3,
  account_ids: [id],
  category_ids: [],
  goal_id: null,
};
describe('emergency plan contract', () => {
  it('requires positive exact baseline and bounded month counts', () => {
    expect(EmergencyPlanInputSchema.parse(input)).toEqual(input);
    for (const patch of [
      { manual_baseline: null },
      { manual_baseline: '0.00' },
      { manual_baseline: '1.001' },
      { manual_baseline: '999999999999999999.99' },
      { coverage_months: 0 },
      { coverage_months: 1.5 },
      { coverage_months: 61 },
      { history_months: 4 },
      { currency: 'USD' },
      { user_id: id },
    ]) {
      expect(EmergencyPlanInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it('history mode keeps manual baseline null and IDs must be unique', () => {
    expect(
      EmergencyPlanInputSchema.safeParse({
        ...input,
        baseline_mode: 'HISTORY',
        manual_baseline: null,
      }).success,
    ).toBe(true);
    expect(EmergencyPlanInputSchema.safeParse({ ...input, baseline_mode: 'HISTORY' }).success).toBe(
      false,
    );
    expect(EmergencyPlanInputSchema.safeParse({ ...input, account_ids: [id, id] }).success).toBe(
      false,
    );
    expect(
      EmergencyPlanInputSchema.safeParse({ ...input, category_ids: ['not-a-uuid'] }).success,
    ).toBe(false);
  });
  it('uses versioned sync envelopes with soft deletion', () => {
    expect(
      PushItemSchema.parse({
        entity_type: 'emergency_plans',
        entity_id: id,
        operation: 'CREATE',
        client_version: '0',
        payload: input,
      }).entity_type,
    ).toBe('emergency_plans');
    expect(
      PushItemSchema.parse({
        entity_type: 'emergency_plans',
        entity_id: id,
        operation: 'DELETE',
        client_version: '1',
        payload: null,
      }).operation,
    ).toBe('DELETE');
  });
});
