import { describe, expect, it } from 'vitest';
import { PullQuerySchema } from '../../src/modules/sync/sync.schema.js';

const query = {
  device_id: '019a0000-0000-7000-8000-000000000001',
  since_version: '9007199254740993',
  limit: '100',
};
describe('opt-in compact sync query', () => {
  it('preserves legacy defaults and exact string cursors', () => {
    expect(PullQuerySchema.parse(query)).toEqual({ ...query, limit: 100 });
    expect(PullQuerySchema.parse({ ...query, compact: 'true' }).compact).toBe('true');
    expect(PullQuerySchema.parse({ ...query, compact: 'false' }).compact).toBe('false');
  });
  it('rejects invalid modes, oversized pages and unknown fields', () => {
    for (const patch of [
      { compact: true },
      { compact: 'latest' },
      { limit: '101' },
      { bypass: 'true' },
    ]) {
      expect(PullQuerySchema.safeParse({ ...query, ...patch }).success).toBe(false);
    }
  });
});
