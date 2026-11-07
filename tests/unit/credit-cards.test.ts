import { describe, expect, it } from 'vitest';
import {
    CreateAccountSchema,
    UpdateAccountSchema,
    CreditLimitSchema,
    AccountDtoSchema,
} from '../../src/modules/accounts/account.schema.js';
import {
    assertCardExpense,
    assertCardTransfer,
} from '../../src/modules/accounts/credit-card-policy.js';
import { accessibleAccount } from '../../src/common/authorization/account-access.js';
import { consolidateNetWorth } from '../../src/modules/net-worth/net-worth.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { consolidateAllocation } from '../../src/modules/asset-allocation/asset-allocation.service.js';

const typeId = '019a4fff-7000-7000-8000-000000000003';
describe('simplified card contracts and policies', () => {
    it('defaults old creates, preserves omitted patch metadata and accepts exact limits', () => {
        expect(CreateAccountSchema.parse({ account_type_id: typeId, name: 'Card' })).toMatchObject({
            is_credit_card: false,
            credit_limit: null,
        });
        expect(
            UpdateAccountSchema.parse({ version: '9007199254740993', name: 'Renamed' }),
        ).not.toHaveProperty('credit_limit');
        for (const value of [null, '0.01', '1000000.23', '999999999999999999.99'])
            expect(CreditLimitSchema.parse(value)).toBe(value);
        for (const value of ['0', '0.00', '-1', '1.001', '1e2', '1000000000000000000', 100])
            expect(CreditLimitSchema.safeParse(value).success).toBe(false);
        expect(
            CreateAccountSchema.safeParse({ account_type_id: typeId, name: 'Card', balance: '-1.00' })
                .success,
        ).toBe(false);
        expect(AccountDtoSchema.shape.version.parse('9007199254740993')).toBe('9007199254740993');
    });
    it('allows only expenses and own cash-to-card payments without limit/balance gates', () => {
        const card = { isCreditCard: true, userId: 'owner' };
        const bank = { isCreditCard: false, userId: 'owner' };
        expect(() => assertCardExpense(card, 'EXPENSE')).not.toThrow();
        expect(() => assertCardExpense(card, 'INCOME')).toThrow();
        expect(() => assertCardTransfer('owner', bank, card, 'CASH')).not.toThrow();
        expect(() => assertCardTransfer('owner', card, bank, 'CASH')).toThrow();
        expect(() => assertCardTransfer('other', bank, card, 'CASH')).toThrow();
        expect(() => assertCardTransfer('owner', bank, card, 'INVESTMENT')).toThrow();
        expect(accessibleAccount('owner').OR?.[1]).toMatchObject({ isCreditCard: false });
    });
    it.each([
        ['-1200000.00', '1000000.00', '-200000.00'],
        ['500000.00', '1000000.00', '1000000.00'],
    ])('preserves exact advisory remaining limit for balance %s', (balance, limit, remaining) => {
        const debt = Prisma.Decimal.max(new Prisma.Decimal(balance).negated(), 0);
        expect(new Prisma.Decimal(CreditLimitSchema.parse(limit) ?? '0').minus(debt).toFixed(2)).toBe(
            remaining,
        );
    });
    it('keeps overpayment credits in gross assets without calling them cash', () => {
        const result = consolidateAllocation(
            {
                accounts: [
                    {
                        id: 'card',
                        balance: new Prisma.Decimal('500000.23'),
                        isCreditCard: true,
                        isIncludeTotal: true,
                        children: [],
                        accountType: { category: 'CASH' },
                    },
                ],
                positions: [],
                instruments: [],
                obligations: [],
            },
            new Date('2026-11-06T00:00:00Z'),
        );
        expect(result.known_assets).toBe('500000.23');
        expect(result.classes.find((entry) => entry.asset_class === 'CASH')?.known_amount).toBe('0.00');
        expect(result.classes.find((entry) => entry.asset_class === 'UNCLASSIFIED')?.known_amount).toBe(
            '500000.23',
        );
    });
    it.each(['-1200000.23', '500000.23'])(
        'counts signed card balance %s once but never as cash',
        (balance) => {
            const result = consolidateNetWorth(
                {
                    accounts: [
                        {
                            id: 'card',
                            balance: new Prisma.Decimal(balance),
                            isCreditCard: true,
                            isIncludeTotal: true,
                            children: [],
                            accountType: { category: 'CASH' },
                        },
                    ],
                    positions: [],
                    instruments: [],
                    obligations: [],
                },
                'IDR',
                '2026-11-06',
                new Date('2026-11-06T00:00:00Z'),
            );
            expect(result.known_net_worth).toBe(balance);
            expect(result.cash_balance).toBe('0.00');
            expect(result.accounts).toHaveLength(1);
        },
    );
});
