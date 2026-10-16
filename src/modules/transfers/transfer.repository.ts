import { AppError } from '../../common/errors/app-error.js';
import { generateId } from '../../common/utils/id.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from '../transactions/ledger.js';
import type { CreateTransferInput } from './transfer.schema.js';
import type { TransferRecord } from './transfer.types.js';

type OfflineTransferInput = CreateTransferInput & {
  from_transaction_id: string;
  to_transaction_id: string;
};

export interface TransferRepository {
  create(userId: string, id: string, input: CreateTransferInput): Promise<TransferRecord>;
}
export class PrismaTransferRepository implements TransferRepository {
  constructor(private readonly client: PrismaClient) {}

  create(userId: string, id: string, input: CreateTransferInput): Promise<TransferRecord> {
    return this.persist(userId, id, input);
  }

  createOffline(userId: string, id: string, input: OfflineTransferInput): Promise<TransferRecord> {
    return this.persist(userId, id, input, input);
  }

  private persist(
    userId: string,
    id: string,
    input: CreateTransferInput,
    ledgerIds?: OfflineTransferInput,
  ): Promise<TransferRecord> {
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
        if (ledgerIds) {
          const existing = await tx.transfer.findUnique({
            where: { id },
            include: { transactions: true },
          });
          if (existing) {
            // Never disclose a colliding command belonging to another actor. Replay
            // is durable across devices and does not rely on sync event retention.
            const fromLeg = existing.transactions.find(
              (row) => row.id === ledgerIds.from_transaction_id,
            );
            const toLeg = existing.transactions.find(
              (row) => row.id === ledgerIds.to_transaction_id,
            );
            const matches =
              existing.createdBy === userId &&
              existing.deletedAt === null &&
              existing.version === 1n &&
              existing.fromAccountId === input.from_account_id &&
              existing.toAccountId === input.to_account_id &&
              existing.amount.equals(amount) &&
              existing.transactedAt.getTime() === new Date(input.transacted_at).getTime() &&
              existing.description === input.description &&
              existing.transactions.length === 2 &&
              fromLeg?.accountId === from.id &&
              toLeg?.accountId === to.id &&
              fromLeg.id !== toLeg.id &&
              [fromLeg, toLeg].every(
                (row) =>
                  row.type === 'TRANSFER' &&
                  row.categoryId === null &&
                  row.deletedAt === null &&
                  row.transferId === id &&
                  row.transactedAt.getTime() === existing.transactedAt.getTime() &&
                  row.description === existing.description &&
                  row.createdBy === userId &&
                  row.amount.equals(row.id === fromLeg.id ? amount.negated() : amount),
              );
            if (!matches)
              throw new AppError({
                statusCode: 409,
                code: 'TRANSFER_COMMAND_CONFLICT',
                message: 'ID perintah transfer tidak tersedia atau data berbeda.',
              });
            return { ...existing, fromTransactionId: fromLeg.id, toTransactionId: toLeg.id };
          }
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
        const fromTransactionId = ledgerIds?.from_transaction_id ?? generateId();
        const toTransactionId = ledgerIds?.to_transaction_id ?? generateId();
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
