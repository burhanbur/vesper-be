import { describe, expect, it } from 'vitest';
import {
    budgetPeriodRange,
    isCalendarDate,
    utcDate,
} from '../../src/common/utils/budget-period.js';

describe('budget-period utility', () => {
    describe('isCalendarDate', () => {
        it('validates proper YYYY-MM-DD calendar dates', () => {
            expect(isCalendarDate('2026-10-04')).toBe(true);
            expect(isCalendarDate('2024-02-29')).toBe(true); // leap year
            expect(isCalendarDate('2023-02-29')).toBe(false); // not leap year
            expect(isCalendarDate('2026-13-01')).toBe(false);
            expect(isCalendarDate('invalid-date')).toBe(false);
            expect(isCalendarDate('0000-01-01')).toBe(false);
        });
    });

    describe('budgetPeriodRange - MONTHLY', () => {
        it('calculates monthly period starting from anchor day', () => {
            const anchor = utcDate(2026, 0, 15); // 15th of the month
            const range = budgetPeriodRange(anchor, 'MONTHLY', '2026-03');

            expect(range.start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
            expect(range.end.toISOString()).toBe('2026-04-15T00:00:00.000Z');
        });

        it('clamps anchor day when month has fewer days (e.g. 31st in Feb)', () => {
            const anchor = utcDate(2026, 0, 31); // 31st
            // 2026 is non-leap year, Feb has 28 days
            const range = budgetPeriodRange(anchor, 'MONTHLY', '2026-02');

            expect(range.start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
            expect(range.end.toISOString()).toBe('2026-03-31T00:00:00.000Z');
        });

        it('throws RangeError on malformed monthly format', () => {
            const anchor = utcDate(2026, 0, 1);
            expect(() => budgetPeriodRange(anchor, 'MONTHLY', '2026-13')).toThrow(RangeError);
            expect(() => budgetPeriodRange(anchor, 'MONTHLY', '2026')).toThrow(RangeError);
            expect(() => budgetPeriodRange(anchor, 'MONTHLY', '0000-01')).toThrow(RangeError);
        });
    });

    describe('budgetPeriodRange - ANNUAL', () => {
        it('calculates annual period from anchor month and day', () => {
            const anchor = utcDate(2026, 3, 10); // April 10
            const range = budgetPeriodRange(anchor, 'ANNUAL', '2026');

            expect(range.start.toISOString()).toBe('2026-04-10T00:00:00.000Z');
            expect(range.end.toISOString()).toBe('2027-04-10T00:00:00.000Z');
        });

        it('throws RangeError on malformed annual format', () => {
            const anchor = utcDate(2026, 0, 1);
            expect(() => budgetPeriodRange(anchor, 'ANNUAL', '26')).toThrow(RangeError);
            expect(() => budgetPeriodRange(anchor, 'ANNUAL', '0000')).toThrow(RangeError);
        });
    });

    describe('budgetPeriodRange - WEEKLY', () => {
        it('aligns to anchor day of week and covers 7 days', () => {
            // Anchor is a Wednesday: 2026-10-07 is Wednesday (getUTCDay() === 3)
            const anchor = utcDate(2026, 9, 7);
            // Query date: 2026-10-09 (Friday)
            const range = budgetPeriodRange(anchor, 'WEEKLY', '2026-10-09');

            expect(range.start.toISOString()).toBe('2026-10-07T00:00:00.000Z');
            expect(range.end.toISOString()).toBe('2026-10-14T00:00:00.000Z');
        });
    });

    describe('budgetPeriodRange - DAILY', () => {
        it('covers exactly 1 day for specified calendar date', () => {
            const anchor = utcDate(2026, 0, 1);
            const range = budgetPeriodRange(anchor, 'DAILY', '2026-10-04');

            expect(range.start.toISOString()).toBe('2026-10-04T00:00:00.000Z');
            expect(range.end.toISOString()).toBe('2026-10-05T00:00:00.000Z');
        });

        it('throws RangeError on invalid calendar date for daily', () => {
            const anchor = utcDate(2026, 0, 1);
            expect(() => budgetPeriodRange(anchor, 'DAILY', '2026-02-30')).toThrow(RangeError);
        });
    });
});
