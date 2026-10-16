import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { SyncService } from '../../src/modules/sync/sync.service.js';
import {
  RecoveryRequestSchema,
  commandFingerprint,
} from '../../src/modules/sync/investment-recovery.schema.js';
import { PrismaTransactionRepository } from '../../src/modules/transactions/transaction.repository.js';
import { PrismaTransferRepository } from '../../src/modules/transfers/transfer.repository.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const repo = new SyncRepository(client);
const service = new SyncService(repo);
afterAll(async () => {
  await client.$disconnect();
});
async function fixture() {
  const userId = generateId(),
    operator = generateId(),
    deviceId = generateId(),
    cash = generateId(),
    portfolio = generateId(),
    instrument = generateId(),
    category = generateId(),
    role = generateId();
  for (const id of [userId, operator])
    await client.user.create({
      data: { id, name: 'Recovery test', email: `${id}@example.invalid`, passwordHash: 'unused' },
    });
  const cashType = generateId(),
    investType = generateId();
  await client.accountType.createMany({
    data: [
      { id: cashType, userId, name: 'Cash', category: 'CASH' },
      { id: investType, userId, name: 'Portfolio', category: 'INVESTMENT' },
    ],
  });
  await client.account.createMany({
    data: [
      { id: cash, userId, accountTypeId: cashType, name: 'Cash', balance: '100.00' },
      { id: portfolio, userId, accountTypeId: investType, name: 'Portfolio' },
    ],
  });
  await client.category.create({
    data: { id: category, userId, name: 'Expense', type: 'EXPENSE' },
  });
  await client.instrument.create({
    data: { id: instrument, code: `REC-${instrument.toUpperCase()}`, name: 'Test', type: 'STOCK' },
  });
  await client.device.create({
    data: { id: deviceId, userId, name: 'Test', platform: 'Android', appVersion: '1' },
  });
  await client.role.create({
    data: { id: role, code: `R${role.slice(0, 30)}`, name: 'Recovery reviewer' },
  });
  await client.userRole.create({ data: { userId: operator, roleId: role } });
  const permission = await client.authorizationRoute.findUniqueOrThrow({
    where: { name: 'sync.investment-recoveries.review' },
  });
  await client.rolePermission.create({ data: { roleId: role, routeId: permission.id } });
  const command = RecoveryRequestSchema.shape.command.parse({
    entity_type: 'investment_transactions',
    entity_id: generateId(),
    operation: 'CREATE',
    client_version: '0',
    payload: {
      account_id: portfolio,
      cash_account_id: cash,
      instrument_id: instrument,
      linked_transaction_id: generateId(),
      type: 'BUY',
      quantity: '1',
      price_per_unit: '10.005',
      fee: '0',
      description: null,
      transacted_at: '2026-10-16T00:00:00.000Z',
    },
  });
  const body = { device_id: deviceId, command, command_sha256: commandFingerprint(command) };
  return { userId, operator, deviceId, cash, portfolio, category, role, body, command };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cancel = (f: Fixture) =>
  repo.reviewRecovery(f.operator, f.command.entity_id, {
    decision: 'CANCELLED',
    reason: 'Verified never applied',
  });
const push = (f: Fixture) => service.push(f.userId, { device_id: f.deviceId, items: [f.command] });

describe('durable never-applied investment cancellation', () => {
  it('binds owner/device/fingerprint, replays requests and denies current revoked operator grants', async () => {
    const f = await fixture();
    const first = await repo.requestRecovery(f.userId, f.body);
    expect(await repo.requestRecovery(f.userId, f.body)).toEqual(first);
    expect(first.status).toBe('PENDING');
    expect(
      await client.investmentCancellationId.count({ where: { tradeId: f.command.entity_id } }),
    ).toBe(0);
    await expect(repo.recoveryReceipt(f.operator, f.command.entity_id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(repo.requestRecovery(f.operator, f.body)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      repo.requestRecovery(f.userId, { ...f.body, command_sha256: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ statusCode: 422 });
    const changed = { ...f.command, payload: { ...f.command.payload, quantity: '2' } };
    await expect(
      repo.requestRecovery(f.userId, {
        ...f.body,
        command: changed,
        command_sha256: commandFingerprint(changed),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      repo.reviewRecovery(f.userId, f.command.entity_id, {
        decision: 'CANCELLED',
        reason: 'No permission',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await client.role.update({ where: { id: f.role }, data: { deletedAt: new Date() } });
    await expect(cancel(f)).rejects.toMatchObject({ statusCode: 403 });
    expect((await repo.recoveryReceipt(f.userId, f.command.entity_id)).status).toBe('PENDING');
  });
  it('approves once, publishes authoritative rows and rejects all reserved UUID reuse without money movement', async () => {
    const f = await fixture();
    await repo.requestRecovery(f.userId, f.body);
    const approved = await cancel(f);
    expect(approved.status).toBe('CANCELLED');
    expect(await cancel(f)).toEqual(approved);
    expect(await repo.requestRecovery(f.userId, f.body)).toEqual(approved);
    expect(
      await client.investmentCancellationId.count({ where: { tradeId: f.command.entity_id } }),
    ).toBe(2);
    expect((await push(f)).results[0]?.status).toBe('conflict');
    const ledgerId = f.command.payload.linked_transaction_id;
    await expect(
      new PrismaTransactionRepository(syncClient(client)).create(f.userId, ledgerId, {
        account_id: f.cash,
        category_id: f.category,
        type: 'EXPENSE',
        amount: '1.00',
        transacted_at: '2026-10-16T00:00:00.000Z',
        description: null,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      new PrismaTransferRepository(syncClient(client)).createOffline(f.userId, generateId(), {
        from_account_id: f.cash,
        to_account_id: f.portfolio,
        from_transaction_id: ledgerId,
        to_transaction_id: generateId(),
        amount: '1.00',
        transacted_at: '2026-10-16T00:00:00.000Z',
        description: null,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: f.cash } })).balance.toFixed(2),
    ).toBe('100.00');
    expect(await client.transaction.count({ where: { accountId: f.cash } })).toBe(0);
    expect(await client.investmentTransaction.count({ where: { accountId: f.portfolio } })).toBe(0);
    const feed = await repo.pull(f.userId, {
      device_id: f.deviceId,
      since_version: '0',
      limit: 100,
      compact: 'true',
    });
    expect(
      feed.changes
        .filter((c) => c.payload === null)
        .map((c) => c.entity_id)
        .sort(),
    ).toEqual([f.command.entity_id, ledgerId].sort());
    expect(feed.changes.filter((c) => c.entity_type === 'accounts')).toHaveLength(2);
    await expect(
      repo.reviewRecovery(f.operator, f.command.entity_id, {
        decision: 'DENIED',
        reason: 'Changed',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('normal execution winning after review request prevents cancellation and keeps the exact settlement', async () => {
    const f = await fixture();
    await repo.requestRecovery(f.userId, f.body);
    expect((await push(f)).results[0]?.status).toBe('applied');
    await expect(cancel(f)).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await client.transaction.findUniqueOrThrow({
          where: { id: f.command.payload.linked_transaction_id },
        })
      ).amount.toFixed(2),
    ).toBe('10.01');
    expect(
      await client.investmentCancellationId.count({ where: { tradeId: f.command.entity_id } }),
    ).toBe(0);
  });
  it.each([false, true])(
    'refuses partial or tombstoned ledger identity (deleted=%s)',
    async (deleted) => {
      const f = await fixture();
      await client.transaction.create({
        data: {
          id: f.command.payload.linked_transaction_id,
          accountId: f.cash,
          categoryId: f.category,
          type: 'EXPENSE',
          amount: '1.00',
          transactedAt: new Date(),
          createdBy: f.userId,
          updatedBy: f.userId,
          deletedAt: deleted ? new Date() : null,
        },
      });
      await expect(repo.requestRecovery(f.userId, f.body)).rejects.toMatchObject({
        statusCode: 409,
      });
    },
  );
  it('serializes cancellation against execution in a real concurrent race', async () => {
    const f = await fixture();
    await repo.requestRecovery(f.userId, f.body);
    const outcomes = await Promise.allSettled([cancel(f), push(f)]);
    const state = await repo.recoveryReceipt(f.userId, f.command.entity_id);
    const trade = await client.investmentTransaction.findUnique({
      where: { id: f.command.entity_id },
    });
    const leg = await client.transaction.findUnique({
      where: { id: f.command.payload.linked_transaction_id },
    });
    expect(Boolean(trade)).toBe(Boolean(leg));
    if (state.status === 'CANCELLED') {
      expect(trade).toBeNull();
      expect(outcomes[1]).toMatchObject({
        status: 'fulfilled',
        value: { results: [{ status: 'conflict' }] },
      });
    } else {
      expect(trade).not.toBeNull();
      expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } });
    }
  });
  it('denial is durable and does not reserve IDs or prevent unchanged retry', async () => {
    const f = await fixture();
    await repo.requestRecovery(f.userId, f.body);
    const result = await repo.reviewRecovery(f.operator, f.command.entity_id, {
      decision: 'DENIED',
      reason: 'Repair underlying issue',
    });
    expect(result.status).toBe('DENIED');
    expect((await push(f)).results[0]?.status).toBe('applied');
  });
});
