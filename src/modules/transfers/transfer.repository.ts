import { AppError } from '../../common/errors/app-error.js';
import { assertCardTransfer } from '../accounts/credit-card-policy.js';
import { generateId } from '../../common/utils/id.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from '../transactions/ledger.js';
import type { CreateTransferInput } from './transfer.schema.js';
import { toTransferDto, type TransferRecord } from './transfer.types.js';

export type OfflineTransferInput = CreateTransferInput & {
  from_transaction_id?: string;
  to_transaction_id?: string;
};

export type UpdateTransferRepoInput = {
  from_account_id?: string | undefined;
  to_account_id?: string | undefined;
  from_transaction_id?: string | undefined;
  to_transaction_id?: string | undefined;
  amount?: string | undefined;
  transacted_at?: string | undefined;
  description?: string | null | undefined;
};

export interface TransferRepository {
  create(userId: string, id: string, input: CreateTransferInput): Promise<TransferRecord>;
  createOffline(userId: string, id: string, input: OfflineTransferInput): Promise<TransferRecord>;
  updateOffline(
    userId: string,
    id: string,
    clientVersion: string,
    input: UpdateTransferRepoInput,
  ): Promise<TransferRecord>;
  deleteOffline(userId: string, id: string, clientVersion?: string): Promise<TransferRecord>;
}
export class PrismaTransferRepository implements TransferRepository {
  constructor(private readonly client: PrismaClient) { }

  create(userId: string, id: string, input: CreateTransferInput): Promise<TransferRecord> {
    return this.persist(userId, id, input);
  }

  createOffline(userId: string, id: string, input: OfflineTransferInput): Promise<TransferRecord> {
    return this.persist(userId, id, input, input);
  }

  updateOffline(
    userId: string,
    id: string,
    clientVersion: string,
    input: UpdateTransferRepoInput,
  ): Promise<TransferRecord> {
    return this.client.$transaction(
      async (tx) => {
        const existing = await tx.transfer.findUnique({
          where: { id },
          include: { transactions: true },
        });
        if (!existing) {
          throw new AppError({
            statusCode: 404,
            code: 'TRANSFER_NOT_FOUND',
            message: 'Transfer tidak ditemukan.',
          });
        }
        if (existing.createdBy !== userId) {
          throw new AppError({
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'Anda tidak memiliki akses ke transfer ini.',
          });
        }
        if (existing.deletedAt !== null) {
          throw new AppError({
            statusCode: 409,
            code: 'TRANSFER_ALREADY_DELETED',
            message: 'Transfer sudah dihapus.',
          });
        }

        const fromAccountId = input.from_account_id ?? existing.fromAccountId;
        const toAccountId = input.to_account_id ?? existing.toAccountId;
        if (fromAccountId === toAccountId) {
          throw new AppError({
            statusCode: 422,
            code: 'TRANSFER_ACCOUNTS_DISTINCT',
            message: 'Akun asal dan tujuan harus berbeda.',
          });
        }

        const amount = input.amount !== undefined ? new Prisma.Decimal(input.amount) : existing.amount;
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

        const fromLeg =
          existing.transactions.find((row) => row.id === input.from_transaction_id) ??
          existing.transactions.find((row) => row.amount.isNegative());
        const toLeg =
          existing.transactions.find((row) => row.id === input.to_transaction_id) ??
          existing.transactions.find((row) => row.amount.isPositive());

        if (!fromLeg || !toLeg || fromLeg.id === toLeg.id) {
          throw new AppError({
            statusCode: 422,
            code: 'TRANSFER_LEGS_INVALID',
            message: 'Baris transaksi transfer tidak lengkap.',
          });
        }

        const transactedAt = input.transacted_at ? new Date(input.transacted_at) : existing.transactedAt;
        const description = input.description !== undefined ? input.description : existing.description;

        // Idempotency replay check
        const isReplay =
          existing.fromAccountId === fromAccountId &&
          existing.toAccountId === toAccountId &&
          existing.amount.equals(amount) &&
          existing.transactedAt.getTime() === transactedAt.getTime() &&
          existing.description === description &&
          fromLeg.accountId === fromAccountId &&
          toLeg.accountId === toAccountId &&
          fromLeg.amount.equals(amount.negated()) &&
          toLeg.amount.equals(amount);

        if (isReplay) {
          return { ...existing, fromTransactionId: fromLeg.id, toTransactionId: toLeg.id };
        }

        // Version check
        if (BigInt(clientVersion) < existing.version) {
          throw new AppError({
            statusCode: 409,
            code: 'TRANSFER_VERSION_CONFLICT',
            message: 'Versi transfer tidak sesuai.',
            errors: {
              server_data: toTransferDto({
                ...existing,
                fromTransactionId: fromLeg.id,
                toTransactionId: toLeg.id,
              }),
            },
          });
        }

        const affectedAccountIds = Array.from(
          new Set([
            existing.fromAccountId,
            existing.toAccountId,
            fromAccountId,
            toAccountId,
          ]),
        );
        const accounts = await lockLedgerAccounts(tx, userId, affectedAccountIds);
        const from = accounts.find((a) => a.id === fromAccountId);
        const to = accounts.find((a) => a.id === toAccountId);
        if (!from || !to || from.currency !== 'IDR' || to.currency !== 'IDR') {
          throw new AppError({
            statusCode: 422,
            code: 'TRANSFER_CURRENCY_MISMATCH',
            message: 'Akun asal dan tujuan harus memiliki mata uang yang sama.',
          });
        }
        if (from.isCreditCard || to.isCreditCard) {
          const sourceType = await tx.accountType.findFirst({
            where: { id: from.accountTypeId, deletedAt: null },
          });
          assertCardTransfer(userId, from, to, sourceType?.category);
        }

        const now = new Date();

        const updatedTransfer = await tx.transfer.update({
          where: { id },
          data: {
            fromAccountId,
            toAccountId,
            amount,
            transactedAt,
            description,
            version: { increment: 1n },
            updatedBy: userId,
            updatedAt: now,
          },
        });

        await tx.transaction.update({
          where: { id: fromLeg.id },
          data: {
            accountId: fromAccountId,
            amount: amount.negated(),
            transactedAt,
            description,
            version: { increment: 1n },
            updatedBy: userId,
            updatedAt: now,
          },
        });

        await tx.transaction.update({
          where: { id: toLeg.id },
          data: {
            accountId: toAccountId,
            amount,
            transactedAt,
            description,
            version: { increment: 1n },
            updatedBy: userId,
            updatedAt: now,
          },
        });

        await recomputeLedgerBalances(tx, accounts);

        return {
          ...updatedTransfer,
          fromTransactionId: fromLeg.id,
          toTransactionId: toLeg.id,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  deleteOffline(userId: string, id: string, clientVersion?: string): Promise<TransferRecord> {
    return this.client.$transaction(
      async (tx) => {
        const existing = await tx.transfer.findUnique({
          where: { id },
          include: { transactions: true },
        });
        if (!existing) {
          throw new AppError({
            statusCode: 404,
            code: 'TRANSFER_NOT_FOUND',
            message: 'Transfer tidak ditemukan.',
          });
        }
        if (existing.createdBy !== userId) {
          throw new AppError({
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'Anda tidak memiliki akses ke transfer ini.',
          });
        }
        const fromLeg =
          existing.transactions.find((row) => row.amount.isNegative()) ?? existing.transactions[0];
        const toLeg =
          existing.transactions.find((row) => row.amount.isPositive()) ?? existing.transactions[1];

        // Idempotent delete
        if (existing.deletedAt !== null) {
          return {
            ...existing,
            fromTransactionId: fromLeg?.id ?? '',
            toTransactionId: toLeg?.id ?? '',
          };
        }

        if (clientVersion && BigInt(clientVersion) < existing.version) {
          throw new AppError({
            statusCode: 409,
            code: 'TRANSFER_VERSION_CONFLICT',
            message: 'Versi transfer tidak sesuai.',
            errors: {
              server_data: toTransferDto({
                ...existing,
                fromTransactionId: fromLeg?.id ?? '',
                toTransactionId: toLeg?.id ?? '',
              }),
            },
          });
        }

        const accounts = await lockLedgerAccounts(tx, userId, [
          existing.fromAccountId,
          existing.toAccountId,
        ]);

        const now = new Date();
        const deletedTransfer = await tx.transfer.update({
          where: { id },
          data: {
            deletedAt: now,
            deletedBy: userId,
            version: { increment: 1n },
            updatedAt: now,
          },
        });

        for (const leg of existing.transactions.filter((row) => row.deletedAt === null)) {
          await tx.transaction.update({
            where: { id: leg.id },
            data: {
              deletedAt: now,
              deletedBy: userId,
              version: { increment: 1n },
              updatedAt: now,
            },
          });
        }

        await recomputeLedgerBalances(tx, accounts);

        return {
          ...deletedTransfer,
          fromTransactionId: fromLeg?.id ?? '',
          toTransactionId: toLeg?.id ?? '',
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
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
        if (from.isCreditCard || to.isCreditCard) {
          const sourceType = await tx.accountType.findFirst({
            where: { id: from.accountTypeId, deletedAt: null },
          });
          assertCardTransfer(userId, from, to, sourceType?.category);
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
