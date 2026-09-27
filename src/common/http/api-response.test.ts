import { describe, expect, it } from 'vitest';
import { toDateTimeString } from '../utils/date.js';

describe('toDateTimeString', () => {
  it('matches Laravel toDateTimeString format in UTC', () => {
    expect(toDateTimeString(new Date('2026-09-20T10:11:12.999Z'))).toBe('2026-09-20 10:11:12');
  });
});
