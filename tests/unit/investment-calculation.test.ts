import { describe, expect, it } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
    advance,
    emptyPosition,
    replay,
    valuation,
} from '../../src/modules/investments/investment.calculation.js';

describe('investment calculations', () => {
    it('starts with an empty position', () => {
        const pos = emptyPosition();
        expect(pos.quantity.toString()).toBe('0');
        expect(pos.average.toString()).toBe('0');
    });

    it('updates position correctly on a single BUY', () => {
        const pos = advance(emptyPosition(), {
            type: 'BUY',
            quantity: new Prisma.Decimal('100'),
            pricePerUnit: new Prisma.Decimal('5000'),
        });

        expect(pos.quantity.toString()).toBe('100');
        expect(pos.average.toString()).toBe('5000');
    });

    it('calculates weighted average cost on multiple BUYs', () => {
        // Buy 100 @ 5000 = 500,000
        // Buy 100 @ 6000 = 600,000
        // Total = 200 units, 1,100,000 total cost => avg = 5500
        const pos = replay([
            {
                type: 'BUY',
                quantity: new Prisma.Decimal('100'),
                pricePerUnit: new Prisma.Decimal('5000'),
            },
            {
                type: 'BUY',
                quantity: new Prisma.Decimal('100'),
                pricePerUnit: new Prisma.Decimal('6000'),
            },
        ]);

        expect(pos.quantity.toString()).toBe('200');
        expect(pos.average.toString()).toBe('5500');
    });

    it('retains average cost price on partial SELL', () => {
        // Buy 200 @ 5500
        // Sell 50 @ 7000
        // Remaining = 150 units @ 5500 avg
        const pos = replay([
            {
                type: 'BUY',
                quantity: new Prisma.Decimal('200'),
                pricePerUnit: new Prisma.Decimal('5500'),
            },
            {
                type: 'SELL',
                quantity: new Prisma.Decimal('50'),
                pricePerUnit: new Prisma.Decimal('7000'),
            },
        ]);

        expect(pos.quantity.toString()).toBe('150');
        expect(pos.average.toString()).toBe('5500');
    });

    it('resets average to 0 when selling all units', () => {
        const pos = replay([
            {
                type: 'BUY',
                quantity: new Prisma.Decimal('100'),
                pricePerUnit: new Prisma.Decimal('5000'),
            },
            {
                type: 'SELL',
                quantity: new Prisma.Decimal('100'),
                pricePerUnit: new Prisma.Decimal('6000'),
            },
        ]);

        expect(pos.quantity.toString()).toBe('0');
        expect(pos.average.toString()).toBe('0');
    });

    it('ignores DIVIDEND in holding quantity and average calculation', () => {
        const pos = replay([
            {
                type: 'BUY',
                quantity: new Prisma.Decimal('100'),
                pricePerUnit: new Prisma.Decimal('5000'),
            },
            {
                type: 'DIVIDEND',
                quantity: new Prisma.Decimal('0'),
                pricePerUnit: new Prisma.Decimal('200'),
            },
        ]);

        expect(pos.quantity.toString()).toBe('100');
        expect(pos.average.toString()).toBe('5000');
    });

    it('throws 409 on oversell', () => {
        expect(() =>
            replay([
                {
                    type: 'BUY',
                    quantity: new Prisma.Decimal('100'),
                    pricePerUnit: new Prisma.Decimal('5000'),
                },
                {
                    type: 'SELL',
                    quantity: new Prisma.Decimal('101'),
                    pricePerUnit: new Prisma.Decimal('5500'),
                },
            ]),
        ).toThrowError(/melebihi/);
    });

    it('computes accurate valuation and unrealized P/L', () => {
        // 100 units held @ avg 5000. Market price 6500.
        // Market value = 100 * 6500 = 650,000.00
        // Unrealized PL = 100 * (6500 - 5000) = 150,000.00
        const position = {
            quantity: new Prisma.Decimal('100'),
            average: new Prisma.Decimal('5000'),
        };
        const val = valuation(position, new Prisma.Decimal('6500'));

        expect(val.quantityHeld).toBe('100.00000000');
        expect(val.avgCostPrice).toBe('5000.00000000');
        expect(val.marketPrice).toBe('6500.00000000');
        expect(val.marketValue).toBe('650000.00');
        expect(val.unrealizedPl).toBe('150000.00');
    });
});
