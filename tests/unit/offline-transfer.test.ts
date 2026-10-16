import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaTransferRepository } from '../../src/modules/transfers/transfer.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
import { registerSyncOpenApi } from '../../src/modules/sync/sync.openapi.js';

const ledger = vi.hoisted(() => ({ lock: vi.fn(), recompute: vi.fn() }));
vi.mock('../../src/modules/transactions/ledger.js', () => ({
  lockLedgerAccounts: ledger.lock,
  recomputeLedgerBalances: ledger.recompute,
}));
const uuid = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const actor = uuid(1);
const id = uuid(2);
const payload = {
  from_account_id: uuid(3),
  to_account_id: uuid(4),
  from_transaction_id: uuid(5),
  to_transaction_id: uuid(6),
  amount: '12.30',
  transacted_at: '2026-10-15T10:00:00.000Z',
  description: null,
};
const command = {
  entity_type: 'transfers',
  entity_id: id,
  client_version: '0',
  operation: 'CREATE',
  payload,
};
function harness() {
  const tx = {
    transfer: {
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: { data: Prisma.TransferUncheckedCreateInput }) => data),
    },
    transaction: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  // Database-free boundary; the real repository still owns a single transaction callback.
  const transaction = vi.fn(async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    fn(tx as unknown as Prisma.TransactionClient),
  );
  const repository = new PrismaTransferRepository({
    $transaction: transaction,
  } as unknown as PrismaClient);
  ledger.lock.mockResolvedValue([
    { id: payload.from_account_id, currency: 'IDR' },
    { id: payload.to_account_id, currency: 'IDR' },
  ]);
  ledger.recompute.mockResolvedValue(undefined);
  return { tx, transaction, repository };
}
function persisted() {
  return {
    id,
    createdBy: actor,
    deletedAt: null,
    version: 1n,
    fromAccountId: payload.from_account_id,
    toAccountId: payload.to_account_id,
    amount: new Prisma.Decimal(payload.amount),
    transactedAt: new Date(payload.transacted_at),
    description: null,
    transactions: [
      {
        id: payload.from_transaction_id,
        accountId: payload.from_account_id,
        amount: new Prisma.Decimal('-12.30'),
      },
      {
        id: payload.to_transaction_id,
        accountId: payload.to_account_id,
        amount: new Prisma.Decimal('12.30'),
      },
    ].map((row) => ({
      ...row,
      type: 'TRANSFER',
      categoryId: null,
      deletedAt: null,
      transferId: id,
      transactedAt: new Date(payload.transacted_at),
      description: null,
      createdBy: actor,
    })),
  };
}
beforeEach(() => vi.resetAllMocks());
describe('offline atomic transfer commands', () => {
  it('accepts create-only commands and rejects invalid identities, versions and manual ledger writes', () => {
    expect(PushItemSchema.safeParse(command).success).toBe(true);
    for (const change of [
      { operation: 'UPDATE' },
      { operation: 'DELETE', payload: null },
      { client_version: '1' },
      { payload: { ...payload, to_account_id: payload.from_account_id } },
      { payload: { ...payload, to_transaction_id: payload.from_transaction_id } },
      { payload: { ...payload, from_transaction_id: id } },
      { payload: { ...payload, amount: '0' } },
    ])
      expect(PushItemSchema.safeParse({ ...command, ...change }).success).toBe(false);
    expect(PushItemSchema.safeParse({ ...command, entity_type: 'transactions' }).success).toBe(
      false,
    );
  });
  it('writes one parent and exactly two signed client-ID legs, then recomputes balances in one transaction', async () => {
    const { tx, transaction, repository } = harness();
    await repository.createOffline(actor, id, payload);
    expect(transaction).toHaveBeenCalledOnce();
    expect(ledger.lock).toHaveBeenCalledWith(expect.anything(), actor, [
      payload.from_account_id,
      payload.to_account_id,
    ]);
    expect(tx.transfer.create).toHaveBeenCalledOnce();
    const data = tx.transaction.createMany.mock.calls[0]?.[0] as {
      data: Prisma.TransactionCreateManyInput[];
    };
    expect(
      data.data.map((row) => [
        row.id,
        row.accountId,
        new Prisma.Decimal(row.amount as Prisma.Decimal).toString(),
      ]),
    ).toEqual([
      [payload.from_transaction_id, payload.from_account_id, '-12.3'],
      [payload.to_transaction_id, payload.to_account_id, '12.3'],
    ]);
    expect(
      data.data.every(
        (row) => row.transferId === id && row.type === 'TRANSFER' && row.categoryId === null,
      ),
    ).toBe(true);
    expect(ledger.recompute).toHaveBeenCalledOnce();
  });
  it('replays persisted commands without writes or balance/version bumps, including equivalent decimals', async () => {
    const { tx, repository } = harness();
    tx.transfer.findUnique.mockResolvedValue(persisted());
    await expect(
      repository.createOffline(actor, id, { ...payload, amount: '12.3' }),
    ).resolves.toMatchObject({
      id,
      fromTransactionId: payload.from_transaction_id,
      toTransactionId: payload.to_transaction_id,
    });
    expect(tx.transfer.create).not.toHaveBeenCalled();
    expect(tx.transaction.createMany).not.toHaveBeenCalled();
    expect(ledger.recompute).not.toHaveBeenCalled();
  });
  it.each(['actor', 'amount', 'deleted', 'missing leg', 'wrong sign', 'different leg ID'])(
    'rejects %s collisions without returning foreign data',
    async (scenario) => {
      const { tx, repository } = harness();
      const record = persisted();
      if (scenario === 'actor') record.createdBy = uuid(9);
      if (scenario === 'amount') record.amount = new Prisma.Decimal('99');
      if (scenario === 'deleted') Object.assign(record, { deletedAt: new Date() });
      if (scenario === 'missing leg') record.transactions.pop();
      if (scenario === 'wrong sign')
        Object.assign(record.transactions[0] ?? {}, { amount: new Prisma.Decimal('12.30') });
      if (scenario === 'different leg ID')
        Object.assign(record.transactions[0] ?? {}, { id: uuid(9) });
      tx.transfer.findUnique.mockResolvedValue(record);
      await expect(repository.createOffline(actor, id, payload)).rejects.toMatchObject({
        statusCode: 409,
        code: 'TRANSFER_COMMAND_CONFLICT',
      });
      expect(tx.transfer.create).not.toHaveBeenCalled();
      expect(ledger.recompute).not.toHaveBeenCalled();
    },
  );
  it('requires current account access even for replay', async () => {
    const { tx, repository } = harness();
    ledger.lock.mockRejectedValue(new Error('Access revoked'));
    await expect(repository.createOffline(actor, id, payload)).rejects.toThrow('Access revoked');
    expect(tx.transfer.findUnique).not.toHaveBeenCalled();
    expect(tx.transfer.create).not.toHaveBeenCalled();
  });
  it('propagates ledger insert and balance failures through the transaction for rollback', async () => {
    for (const stage of ['insert', 'balance']) {
      const { tx, repository } = harness();
      if (stage === 'insert') tx.transaction.createMany.mockRejectedValue(new Error(stage));
      else ledger.recompute.mockRejectedValue(new Error(stage));
      await expect(repository.createOffline(actor, id, payload)).rejects.toThrow(stage);
      if (stage === 'insert') expect(ledger.recompute).not.toHaveBeenCalled();
      vi.resetAllMocks();
    }
  });
  it('generates OpenAPI for the additive command contract', () => {
    const registry = new OpenAPIRegistry();
    registerSyncOpenApi(registry);
    const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1' },
    });
    expect(JSON.stringify(document.components?.schemas?.SyncPushItem)).toContain(
      'from_transaction_id',
    );
  });
});
