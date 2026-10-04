export type BudgetPeriodType = 'MONTHLY' | 'WEEKLY' | 'DAILY' | 'ANNUAL';
export const UTC_DAY_MS = 86_400_000;

export function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCFullYear() >= 1
  );
}

function clampedDate(year: number, month: number, day: number): Date {
  return utcDate(year, month, Math.min(day, utcDate(year, month + 1, 0).getUTCDate()));
}

/** Monthly/annual labels identify the start's month/year; weekly labels identify a containing day. */
export function budgetPeriodRange(
  anchor: Date,
  type: BudgetPeriodType,
  period: string,
): { start: Date; end: Date } {
  if (type === 'MONTHLY') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period.startsWith('0000'))
      throw new RangeError('Invalid monthly period');
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5)) - 1;
    return {
      start: clampedDate(year, month, anchor.getUTCDate()),
      end: clampedDate(year, month + 1, anchor.getUTCDate()),
    };
  }
  if (type === 'ANNUAL') {
    if (!/^\d{4}$/.test(period) || period === '0000') throw new RangeError('Invalid annual period');
    const year = Number(period);
    return {
      start: clampedDate(year, anchor.getUTCMonth(), anchor.getUTCDate()),
      end: clampedDate(year + 1, anchor.getUTCMonth(), anchor.getUTCDate()),
    };
  }
  if (!isCalendarDate(period)) throw new RangeError('Invalid daily or weekly period');
  const start = new Date(`${period}T00:00:00.000Z`);
  if (type === 'WEEKLY')
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() - anchor.getUTCDay() + 7) % 7));
  return { start, end: new Date(start.getTime() + UTC_DAY_MS * (type === 'WEEKLY' ? 7 : 1)) };
}
