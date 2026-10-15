import { InvestmentDecimal, bounded, investmentError } from './investment.calculation.js';
import type { CreateInvestmentInput } from './investment.schema.js';

/** One rounding boundary for the linked cash ledger. Never convert through Number. */
export function investmentSettlement(
    input: Pick<CreateInvestmentInput, 'type' | 'quantity' | 'price_per_unit' | 'fee'>,
) {
    const gross = new InvestmentDecimal(input.quantity).mul(input.price_per_unit);
    const fee = new InvestmentDecimal(input.fee);
    const net = input.type === 'BUY' ? gross.plus(fee) : gross.minus(fee);
    const amount = bounded(net, 2);
    if (new InvestmentDecimal(amount).lte(0))
        investmentError(
            'INVESTMENT_NET_AMOUNT_INVALID',
            'Nominal cash setelah fee dan pembulatan harus positif.',
        );
    return { amount, type: input.type === 'BUY' ? ('EXPENSE' as const) : ('INCOME' as const) };
}
