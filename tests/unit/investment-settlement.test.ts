import { describe, expect, it } from 'vitest';
import { investmentSettlement } from '../../src/modules/investments/investment.settlement.js';

const trade = { type: 'BUY' as const, quantity: '0.1', price_per_unit: '0.15', fee: '0' };
describe('exact investment cash settlement', () => {
    it('rounds HALF_UP once after multiplication and fee', () => {
        expect(investmentSettlement(trade)).toEqual({ amount: '0.02', type: 'EXPENSE' });
        expect(investmentSettlement({ ...trade, fee: '0.01' }).amount).toBe('0.03');
    });
    it('subtracts sell/dividend fees and uses income cash direction', () => {
        for (const type of ['SELL', 'DIVIDEND'] as const)
            expect(investmentSettlement({ ...trade, type, quantity: '2', price_per_unit: '10.25', fee: '0.50' }))
                .toEqual({ amount: '20.00', type: 'INCOME' });
    });
    it('retains cents above the binary floating point safe integer range', () => {
        expect(investmentSettlement({ ...trade, quantity: '1000000', price_per_unit: '9007199254.740991', fee: '0.01' }).amount)
            .toBe('9007199254740991.01');
    });
    it('rejects zero-rounded and negative linked cash amounts', () => {
        expect(() => investmentSettlement({ ...trade, price_per_unit: '0.01' })).toThrow(/positif/);
        expect(() => investmentSettlement({ ...trade, type: 'SELL', fee: '1' })).toThrow(/positif/);
    });
    it('rejects cash overflow rather than truncating it', () => {
        expect(() => investmentSettlement({ ...trade, quantity: '999999999999', price_per_unit: '999999999999' }))
            .toThrow(/maksimum/);
    });
});
