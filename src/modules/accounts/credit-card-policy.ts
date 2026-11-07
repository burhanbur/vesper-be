import { AppError } from '../../common/errors/app-error.js';
import type { Account } from '../../generated/prisma/client.js';

/** Cards support expenses and incoming same-owner cash repayments, not cash advances/refunds. */
export function assertCardExpense(account: Pick<Account, 'isCreditCard'>, type: string): void {
    if (account.isCreditCard && type !== 'EXPENSE') invalid();
}
export function assertCardTransfer(
    userId: string,
    from: Pick<Account, 'isCreditCard' | 'userId'>,
    to: Pick<Account, 'isCreditCard' | 'userId'>,
    sourceCategory?: string,
): void {
    if (!from.isCreditCard && !to.isCreditCard) return;
    if (
        from.isCreditCard ||
        from.userId !== userId ||
        to.userId !== userId ||
        sourceCategory !== 'CASH'
    )
        invalid();
}
function invalid(): never {
    throw new AppError({
        statusCode: 422,
        code: 'CREDIT_CARD_USE_INVALID',
        message: 'Kartu kredit hanya mendukung pengeluaran dan pembayaran dari akun kas milik sendiri.',
    });
}
