import { AppError } from '../../common/errors/app-error.js';
import { Prisma, type PrismaClient, type ObligationEvent } from '../../generated/prisma/client.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from '../transactions/ledger.js';
import {
  ObligationCommandSchema,
  obligationFingerprint,
  type ObligationCommand,
} from './obligation.schema.js';
import { toObligationDto, toObligationEventDto } from './obligation.types.js';
import { publish } from '../../infrastructure/database/sync-publication.js';

const Decimal = Prisma.Decimal.clone({ precision: 60 });
const max = '999999999999999999.99';
function fail(message: string, statusCode = 422): never {
  throw new AppError({ code: 'OBLIGATION_COMMAND_INVALID', message, statusCode });
}
export class ObligationRepository {
  constructor(private readonly client: PrismaClient) {}

  cancel(userId: string, id: string, raw: ObligationCommand) {
    const command = ObligationCommandSchema.parse(raw);
    return this.client.$transaction(async (tx) => {
      const fingerprint = obligationFingerprint(command);
      const previous = await tx.obligationEvent.findUnique({ where: { id } });
      if (previous && (previous.userId !== userId || previous.fingerprint !== fingerprint))
        fail('Perintah tidak tersedia.', 409);
      if (previous && previous.operation !== 'CANCEL')
        return { cancelled: false, event: toObligationEventDto(previous) };
      const obligation = await tx.obligation.findUnique({ where: { id: command.obligation_id } });
      if (obligation && obligation.userId !== userId) fail('Pinjaman tidak ditemukan.', 404);
      const referencedAccounts = [
        obligation?.linkedAccountId,
        ...(command.action === 'OPEN'
          ? [command.cash_account_id, command.linked_account_id]
          : command.action === 'REPAY'
            ? [command.cash_account_id]
            : []),
      ].filter((value): value is string => !!value);
      for (const accountId of referencedAccounts) {
        if (
          !(await tx.account.findFirst({ where: { id: accountId, userId }, select: { id: true } }))
        )
          fail('Akun milik Anda tidak ditemukan untuk pembatalan.', 404);
      }
      const target =
        command.action === 'REVERSE'
          ? await tx.obligationEvent.findFirst({
              where: { id: command.target_event_id, userId, obligationId: command.obligation_id },
            })
          : null;
      if (!previous) {
        const ids = [id, ...Object.values(command.ledger_ids)];
        if (
          new Set([command.obligation_id, ...ids]).size !== 6 ||
          (await tx.transaction.count({ where: { id: { in: ids } } }))
        )
          fail('ID perintah sudah digunakan.', 409);
        await tx.obligationEvent.create({
          data: {
            id,
            userId,
            obligationId: obligation?.id ?? null,
            operation: 'CANCEL',
            principal: '0',
            interest: '0',
            fee: '0',
            command,
            fingerprint,
            transactedAt: new Date(command.transacted_at),
          },
        });
        await tx.obligationCommandId.createMany({
          data: ids.map((reserved) => ({ id: reserved, eventId: id })),
        });
      }
      // Publish authoritative existence/absence, including an OPEN that never existed.
      await publish(
        tx,
        'obligations',
        command.obligation_id,
        [userId],
        obligation ? 'UPDATE' : 'DELETE',
        null,
      );
      for (const ledgerId of Object.values(command.ledger_ids))
        await publish(tx, 'transactions', ledgerId, [userId], 'DELETE', null);
      const events = obligation
        ? await tx.obligationEvent.findMany({ where: { obligationId: obligation.id, userId } })
        : [];
      const accountIds = new Set(
        [
          obligation?.linkedAccountId,
          target?.cashAccountId,
          ...(command.action === 'OPEN' || command.action === 'REPAY'
            ? [command.cash_account_id]
            : []),
          ...events.map((e) => e.cashAccountId),
        ].filter((a): a is string => !!a),
      );
      for (const accountId of accountIds) {
        if (await tx.account.findFirst({ where: { id: accountId, userId } }))
          await publish(tx, 'accounts', accountId, [userId], 'UPDATE', null);
      }
      for (const event of events) {
        await publish(tx, 'obligation_events', event.id, [userId], 'UPDATE', null);
        for (const ledgerId of [
          event.cashPrincipalId,
          event.mappedPrincipalId,
          event.interestId,
          event.feeId,
        ].filter((v): v is string => !!v))
          await publish(tx, 'transactions', ledgerId, [userId], 'UPDATE', null);
      }
      return { cancelled: true };
    });
  }

  apply(userId: string, id: string, raw: ObligationCommand) {
    const command = ObligationCommandSchema.parse(raw);
    return this.client.$transaction(async (tx) => {
      const fingerprint = obligationFingerprint(command);
      const identities = [id, command.obligation_id, ...Object.values(command.ledger_ids)];
      if (new Set(identities).size !== identities.length)
        fail('ID perintah, pinjaman, dan ledger harus berbeda.');
      // Caller holds the sync writer lock. Every command keeps its original UUID.
      const previous = await tx.obligationEvent.findUnique({ where: { id } });
      if (previous) {
        if (
          previous.userId !== userId ||
          previous.fingerprint !== fingerprint ||
          previous.operation === 'CANCEL'
        )
          fail('Perintah berbeda atau sudah dibatalkan.', 409);
        return {
          event: toObligationEventDto(previous),
          obligation: previous.obligationId
            ? toObligationDto(
                await tx.obligation.findFirstOrThrow({
                  where: { id: previous.obligationId, userId },
                }),
              )
            : null,
        };
      }
      let obligation = await tx.obligation.findFirst({
        where: { id: command.obligation_id, userId, deletedAt: null },
      });
      if (command.action === 'OPEN') {
        if (
          await tx.obligation.findUnique({
            where: { id: command.obligation_id },
            select: { id: true },
          })
        )
          fail('ID pinjaman sudah digunakan.', 409);
        if (command.installments.length) {
          const sum = command.installments.reduce(
            (n, row) => n.plus(row.principal),
            new Decimal(0),
          );
          const dates = command.installments.map((r) => r.due_date);
          if (
            !sum.equals(command.principal) ||
            dates.some((d, i) => i > 0 && d <= (dates[i - 1] ?? '')) ||
            (command.due_date !== null && dates.at(-1) !== command.due_date)
          )
            fail(
              'Jadwal harus berurutan dan jumlah pokok sama dengan pinjaman; jatuh tempo adalah cicilan terakhir.',
            );
        }
      } else {
        if (!obligation) fail('Pinjaman aktif milik Anda tidak ditemukan.', 404);
        if (
          obligation.version.toString() !== command.expected_version ||
          obligation.version === 9223372036854775807n
        )
          fail('Versi pinjaman berubah. Muat ulang sebelum mencatat ulang.', 409);
      }
      const target =
        command.action === 'REVERSE'
          ? await tx.obligationEvent.findFirst({
              where: {
                id: command.target_event_id,
                userId,
                obligationId: command.obligation_id,
                operation: 'REPAY',
                reversedAt: null,
              },
            })
          : null;
      if (command.action === 'REVERSE' && !target)
        fail('Pembayaran tidak tersedia untuk dikoreksi.', 409);
      const cashId =
        command.action === 'OPEN' || command.action === 'REPAY'
          ? command.cash_account_id
          : (target?.cashAccountId ?? null);
      const mappedId =
        command.action === 'OPEN'
          ? command.linked_account_id
          : (obligation?.linkedAccountId ?? null);
      let deletedOpening: ObligationEvent | null = null;
      if (command.action === 'DELETE' && obligation && !obligation.outstanding.isZero()) {
        const paid = await tx.obligationEvent.count({
          where: { obligationId: obligation.id, operation: 'REPAY', reversedAt: null },
        });
        if (paid || !obligation.outstanding.equals(obligation.principal))
          fail('Balikkan pembayaran dahulu atau lunasi sebelum mengarsipkan.', 409);
        deletedOpening = await tx.obligationEvent.findFirstOrThrow({
          where: { obligationId: obligation.id, operation: 'OPEN' },
        });
      }
      const accountIds = [
        ...new Set(
          [cashId, mappedId, deletedOpening?.cashAccountId].filter((v): v is string => !!v),
        ),
      ];
      const accounts = await lockLedgerAccounts(tx, userId, accountIds, 422, true);
      for (const account of accounts) {
        const type = await tx.accountType.findFirst({
          where: { id: account.accountTypeId, userId, category: 'CASH', deletedAt: null },
        });
        if (
          account.userId !== userId ||
          account.currency !== 'IDR' ||
          !type ||
          (await tx.account.count({ where: { parentAccountId: account.id, deletedAt: null } }))
        )
          fail('Pilih akun kas IDR milik sendiri tanpa pocket.');
        const mapped = await tx.obligation.findFirst({
          where: { linkedAccountId: account.id, deletedAt: null },
        });
        if (mapped && mapped.id !== obligation?.id) fail('Akun terikat pinjaman lain.', 409);
      }
      if (cashId && cashId === mappedId)
        fail('Kas pembayaran harus berbeda dari akun pinjaman lama.');
      if (command.action === 'OPEN' && mappedId) {
        const account = accounts.find((a) => a.id === mappedId);
        const expected = new Decimal(command.principal).mul(command.kind === 'PAYABLE' ? -1 : 1);
        if (!account?.balance.equals(expected))
          fail('Saldo akun lama harus sama dengan pokok bertanda: utang negatif, piutang positif.');
      }
      if (
        command.action === 'REPAY' &&
        obligation &&
        new Decimal(command.principal).gt(obligation.outstanding)
      )
        fail('Pokok pembayaran melebihi sisa pinjaman.', 409);
      const interest = command.action === 'REPAY' ? command.interest : '0.00';
      const fee = command.action === 'REPAY' ? command.fee : '0.00';
      if (command.action === 'REPAY' && obligation) {
        for (const [amount, category, type] of [
          [
            interest,
            command.interest_category_id,
            obligation.kind === 'PAYABLE' ? 'EXPENSE' : 'INCOME',
          ],
          [fee, command.fee_category_id, 'EXPENSE'],
        ] as const) {
          if (
            !new Decimal(amount).isZero() &&
            (!category ||
              !(await tx.category.findFirst({
                where: { id: category, userId, type, deletedAt: null },
              })))
          )
            fail('Kategori bunga/biaya aktif dengan jenis yang sesuai diperlukan.');
        }
      }
      if (command.action === 'OPEN') {
        obligation = await tx.obligation.create({
          data: {
            id: command.obligation_id,
            userId,
            kind: command.kind,
            counterparty: command.counterparty,
            currency: 'IDR',
            principal: command.principal,
            outstanding: command.principal,
            dueDate: command.due_date ? new Date(command.due_date) : null,
            installments: command.installments,
            linkedAccountId: mappedId,
          },
        });
      }
      if (!obligation) fail('Pinjaman tidak tersedia.', 404);
      const principal =
        command.action === 'OPEN' || command.action === 'REPAY'
          ? command.principal
          : (target?.principal.toFixed(2) ?? '0.00');
      const event = await tx.obligationEvent.create({
        data: {
          id,
          userId,
          obligationId: obligation.id,
          operation: command.action,
          principal,
          interest,
          fee,
          cashAccountId: cashId,
          cashPrincipalId:
            cashId && ['OPEN', 'REPAY'].includes(command.action)
              ? command.ledger_ids.cash_principal
              : null,
          mappedPrincipalId:
            mappedId && command.action === 'REPAY' ? command.ledger_ids.mapped_principal : null,
          interestId: new Decimal(interest).gt(0) ? command.ledger_ids.interest : null,
          feeId: new Decimal(fee).gt(0) ? command.ledger_ids.fee : null,
          targetEventId: target?.id ?? null,
          fingerprint,
          command,
          transactedAt: new Date(command.transacted_at),
        },
      });
      await tx.obligationCommandId.createMany({
        data: [id, ...Object.values(command.ledger_ids)].map((reserved) => ({
          id: reserved,
          eventId: id,
        })),
      });
      const ledger = async (
        ledgerId: string,
        accountId: string,
        type: 'TRANSFER' | 'INCOME' | 'EXPENSE',
        amount: string,
        categoryId: string | null = null,
      ) => {
        await tx.transaction.create({
          data: {
            id: ledgerId,
            accountId,
            categoryId,
            type,
            amount,
            obligationEventId: id,
            createdBy: userId,
            updatedBy: userId,
            description: 'Penyelesaian pinjaman',
            transactedAt: event.transactedAt,
          },
        });
      };
      const sign = obligation.kind === 'PAYABLE' ? 1 : -1;
      if (cashId && command.action === 'OPEN')
        await ledger(
          command.ledger_ids.cash_principal,
          cashId,
          'TRANSFER',
          new Decimal(principal).mul(sign).toFixed(2),
        );
      if (command.action === 'REPAY' && cashId) {
        await ledger(
          command.ledger_ids.cash_principal,
          cashId,
          'TRANSFER',
          new Decimal(principal).mul(-sign).toFixed(2),
        );
        if (mappedId)
          await ledger(
            command.ledger_ids.mapped_principal,
            mappedId,
            'TRANSFER',
            new Decimal(principal).mul(sign).toFixed(2),
          );
        if (event.interestId)
          await ledger(
            event.interestId,
            cashId,
            obligation.kind === 'PAYABLE' ? 'EXPENSE' : 'INCOME',
            interest,
            command.interest_category_id,
          );
        if (event.feeId) await ledger(event.feeId, cashId, 'EXPENSE', fee, command.fee_category_id);
        const outstanding = obligation.outstanding.minus(principal);
        obligation = await tx.obligation.update({
          where: { id: obligation.id },
          data: { outstanding, version: { increment: 1n } },
        });
      }
      const reverse = target ?? deletedOpening;
      if (reverse) {
        if (
          await tx.transaction.findFirst({
            where: {
              obligationEventId: reverse.id,
              deletedAt: null,
              version: 9223372036854775807n,
            },
            select: { id: true },
          })
        )
          fail('Batas versi ledger pembayaran tercapai.', 409);
        if (reverse.version === 9223372036854775807n) fail('Batas versi pembayaran tercapai.', 409);
        await tx.transaction.updateMany({
          where: { obligationEventId: reverse.id, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedBy: userId,
            updatedBy: userId,
            version: { increment: 1n },
          },
        });
        await tx.obligationEvent.update({
          where: { id: reverse.id },
          data: { reversedAt: new Date(), version: { increment: 1n } },
        });
        if (target)
          obligation = await tx.obligation.update({
            where: { id: obligation.id },
            data: {
              outstanding: obligation.outstanding.plus(target.principal),
              version: { increment: 1n },
            },
          });
      }
      if (command.action === 'DELETE')
        obligation = await tx.obligation.update({
          where: { id: obligation.id },
          data: { deletedAt: new Date(), version: { increment: 1n } },
        });
      await recomputeLedgerBalances(tx, accounts);
      for (const account of await tx.account.findMany({ where: { id: { in: accountIds } } }))
        if (new Decimal(account.balance.toString()).abs().gt(max))
          fail('Saldo melampaui batas.', 409);
      return { event: toObligationEventDto(event), obligation: toObligationDto(obligation) };
    });
  }
}
