import { AppError } from '../../common/errors/app-error.js';
import {
  Prisma,
  type PrismaClient,
  type InvestmentRecovery,
} from '../../generated/prisma/client.js';
import { lockSync, publish } from '../../infrastructure/database/sync-publication.js';
import {
  commandFingerprint,
  type RecoveryRequest,
  type RecoveryReview,
} from './investment-recovery.schema.js';

function fail(statusCode: number, message: string): never {
  throw new AppError({ statusCode, code: 'INVESTMENT_RECOVERY_DENIED', message });
}
function receipt(row: InvestmentRecovery) {
  return {
    user_id: row.userId,
    trade_id: row.tradeId,
    linked_transaction_id: row.linkedTransactionId,
    command_sha256: row.commandSha256,
    status: row.status,
    requested_at: row.createdAt.toISOString(),
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
  };
}
export class InvestmentRecoveryRepository {
  constructor(private readonly recoveryClient: PrismaClient) {}
  private async owner(tx: Prisma.TransactionClient, userId: string, accountIds: string[]) {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM accounts WHERE id IN (${Prisma.join([...new Set(accountIds)].sort().map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
    const active = await tx.user.findFirst({
      where: { id: userId, status: 'ACTIVE', deletedAt: null },
    });
    const count = await tx.account.count({
      where: { id: { in: [...new Set(accountIds)] }, userId, deletedAt: null },
    });
    if (!active || count !== new Set(accountIds).size)
      fail(404, 'Akun pemilik tidak tersedia untuk pemulihan.');
  }
  async requestRecovery(userId: string, input: RecoveryRequest) {
    return this.recoveryClient.$transaction(
      async (tx) => {
        await lockSync(tx);
        const device = await tx.device.findFirst({ where: { id: input.device_id, userId } });
        if (!device) fail(404, 'Perangkat tidak ditemukan.');
        const p = input.command.payload;
        await this.owner(tx, userId, [p.account_id, p.cash_account_id]);
        if (commandFingerprint(input.command) !== input.command_sha256)
          fail(422, 'Sidik jari perintah tidak cocok.');
        const existing = await tx.investmentRecovery.findUnique({
          where: { tradeId: input.command.entity_id },
        });
        if (existing) {
          if (existing.userId !== userId) fail(404, 'Pemulihan tidak ditemukan.');
          if (existing.commandSha256 !== input.command_sha256)
            fail(409, 'Isi perintah pemulihan berbeda.');
          return receipt(existing);
        }
        await this.absent(tx, input.command.entity_id, p.linked_transaction_id);
        return receipt(
          await tx.investmentRecovery.create({
            data: {
              tradeId: input.command.entity_id,
              linkedTransactionId: p.linked_transaction_id,
              userId,
              deviceId: input.device_id,
              accountId: p.account_id,
              cashAccountId: p.cash_account_id,
              commandSha256: input.command_sha256,
              command: input.command,
            },
          }),
        );
      },
      { isolationLevel: 'ReadCommitted', timeout: 30000 },
    );
  }
  async recoveryReceipt(userId: string, tradeId: string) {
    const row = await this.recoveryClient.investmentRecovery.findFirst({
      where: { tradeId, userId, user: { status: 'ACTIVE', deletedAt: null } },
    });
    if (!row) fail(404, 'Pemulihan tidak ditemukan.');
    return receipt(row);
  }
  private async absent(tx: Prisma.TransactionClient, tradeId: string, ledgerId: string) {
    const ids = [tradeId, ledgerId];
    // Include soft-deleted records and collisions across all financial namespaces.
    if (
      (await tx.investmentTransaction.count({
        where: { OR: [{ id: { in: ids } }, { linkedTransactionId: { in: ids } }] },
      })) ||
      (await tx.transaction.count({ where: { id: { in: ids } } })) ||
      (await tx.transfer.count({ where: { id: { in: ids } } })) ||
      (await tx.investmentCancellationId.count({ where: { id: { in: ids } } }))
    ) {
      fail(409, 'Perintah sudah diproses atau identitas tidak tersedia. Pembatalan ditolak.');
    }
  }
  async reviewRecovery(operatorId: string, tradeId: string, input: RecoveryReview) {
    return this.recoveryClient.$transaction(
      async (tx) => {
        await lockSync(tx);
        // Lock current grants through commit; principal/JWT roles never authorize a decision.
        const grants = await tx.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id
        JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id
        JOIN routes rt ON rt.id=rp.route_id
        WHERE u.id=${operatorId}::uuid AND u.status='ACTIVE' AND u.deleted_at IS NULL
          AND r.deleted_at IS NULL AND rt.deleted_at IS NULL
          AND rt.name='sync.investment-recoveries.review'
        FOR SHARE OF u,ur,r,rp,rt`;
        if (!grants.length) fail(403, 'Izin peninjauan pemulihan diperlukan.');
        const row = await tx.investmentRecovery.findUnique({ where: { tradeId } });
        if (!row) fail(404, 'Pemulihan tidak ditemukan.');
        if (row.status !== 'PENDING') {
          if (
            row.status !== input.decision ||
            row.reviewReason !== input.reason ||
            row.reviewedBy !== operatorId
          )
            fail(409, 'Keputusan pemulihan sudah final.');
          return receipt(row);
        }
        await this.owner(tx, row.userId, [row.accountId, row.cashAccountId]);
        if (input.decision === 'CANCELLED') {
          await this.absent(tx, row.tradeId, row.linkedTransactionId);
          await tx.investmentCancellationId.createMany({
            data: [row.tradeId, row.linkedTransactionId].map((id) => ({ id, tradeId })),
          });
          // Publish explicit absence plus current accounts so a complete mobile replay
          // can replace optimistic values without applying an inverse local delta.
          for (const id of [row.accountId, row.cashAccountId])
            await publish(tx, 'accounts', id, [row.userId], 'UPDATE', null);
          await publish(tx, 'investment_transactions', row.tradeId, [row.userId], 'DELETE', null);
          await publish(tx, 'transactions', row.linkedTransactionId, [row.userId], 'DELETE', null);
        }
        return receipt(
          await tx.investmentRecovery.update({
            where: { tradeId },
            data: {
              status: input.decision,
              reviewedBy: operatorId,
              reviewedAt: new Date(),
              reviewReason: input.reason,
            },
          }),
        );
      },
      { isolationLevel: 'ReadCommitted', timeout: 30000 },
    );
  }
}
