import { AppError } from '../../common/errors/app-error.js';
import { generateId } from '../../common/utils/id.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from '../transactions/ledger.js';
import type { CreateTransferInput } from './transfer.schema.js';
import type { TransferRecord } from './transfer.types.js';

export interface TransferRepository {
  create(userId: string, id: string, input: CreateTransferInput): Promise<TransferRecord>;
}
export class PrismaTransferRepository implements TransferRepository {
  constructor(private readonly client: PrismaClient) {}

  create(userId: string, id: string, input: CreateTransferInput): Promise<TransferRecord> {
    return this.client.$transaction(
      async (tx) => {
        if (input.from_account_id === input.to_account_id) {
          throw new AppError({
            statusCode: 422,
            code: 'TRANSFER_ACCOUNTS_DISTINCT',
            message: 'Akun asal dan tujuan harus berbeda.',
          });
        }
        const accounts = await lockLedgerAccounts(tx, userId, [
          input.from_account_id,
          input.to_account_id,
        ]);
        const from = accounts.find((account) => account.id === input.from_account_id);
        const to = accounts.find((account) => account.id === input.to_account_id);
        if (!from || !to || from.currency !== 'IDR' || to.currency !== 'IDR') {
          throw new AppError({
            statusCode: 422,
            code: 'TRANSFER_CURRENCY_MISMATCH',
            message: 'Akun asal dan tujuan harus memiliki mata uang yang sama.',
          });
        }
        const amount = new Prisma.Decimal(input.amount);
        if (
          !amount.isFinite() ||
          !amount.isPositive() ||
          amount.decimalPlaces() > 2 ||
          amount.greaterThan('999999999999999999.99')
        ) {
          throw new AppError({
            statusCode: 422,
            code: 'TRANSFER_AMOUNT_INVALID',
            message: 'Nominal transfer tidak valid.',
          });
        }
        const shared = {
          amount,
          transactedAt: new Date(input.transacted_at),
          description: input.description,
          createdBy: userId,
          updatedBy: userId,
          version: 1n,
        };
        const transfer = await tx.transfer.create({
          data: {
            id,
            fromAccountId: from.id,
            toAccountId: to.id,
            ...shared,
          },
        });
        const fromTransactionId = generateId();
        const toTransactionId = generateId();
        await tx.transaction.createMany({
          data: [
            {
              ...shared,
              id: fromTransactionId,
              accountId: from.id,
              categoryId: null,
              transferId: id,
              type: 'TRANSFER',
              amount: amount.negated(),
            },
            {
              ...shared,
              id: toTransactionId,
              accountId: to.id,
              categoryId: null,
              transferId: id,
              type: 'TRANSFER',
              amount,
            },
          ],
        });
        await recomputeLedgerBalances(tx, accounts);
        return { ...transfer, fromTransactionId, toTransactionId };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
