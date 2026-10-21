import { z } from '../../common/openapi/zod.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  Prisma,
  type BillSchedule,
  type BillOccurrence,
  type Transaction,
  type ObligationEvent,
} from '../../generated/prisma/client.js';
import { publish } from '../../infrastructure/database/sync-publication.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from '../transactions/ledger.js';
import { GoalMoneySchema } from '../goals/goal.schema.js';
import {
  CreateBillSchema,
  UpdateBillSchema,
  BillCommandSchema,
  billDue,
  billOccurrenceId,
  billFingerprint,
  type BillCommandInput,
} from './bill.schema.js';

function fail(message: string, statusCode = 422): never {
  throw new AppError({ code: 'BILL_COMMAND_INVALID', statusCode, message });
}
export function toBillDto(b: BillSchedule) {
  return {
    id: b.id,
    user_id: b.userId,
    title: b.title,
    transaction_type: b.transactionType,
    amount_type: b.amountType,
    amount: b.amount.toFixed(2),
    account_id: b.accountId,
    category_id: b.categoryId,
    obligation_id: b.obligationId,
    frequency: b.frequency,
    anchor_date: b.anchorDate.toISOString().slice(0, 10),
    end_date: b.endDate?.toISOString().slice(0, 10) ?? null,
    utc_offset_minutes: b.utcOffsetMinutes,
    installments: b.installments,
    reminder_enabled: b.reminderEnabled,
    reminder_days: b.reminderDays,
    active: b.active,
    version: b.version.toString(),
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
    deleted_at: b.deletedAt?.toISOString() ?? null,
  };
}
type OccurrenceRecord = BillOccurrence & {
  bill: BillSchedule;
  transaction: Transaction | null;
  obligationEvent: ObligationEvent | null;
};
export function validBillPayment(o: OccurrenceRecord): boolean {
  if (o.status !== 'PAID') return false;
  if (o.transaction)
    return (
      !o.transaction.deletedAt &&
      o.transaction.accountId === o.bill.accountId &&
      o.transaction.categoryId === o.bill.categoryId &&
      o.transaction.type === o.bill.transactionType &&
      o.transaction.amount.equals(o.amount)
    );
  const e = o.obligationEvent;
  return (
    !!e &&
    e.operation === 'REPAY' &&
    !e.deletedAt &&
    !e.reversedAt &&
    e.obligationId === o.bill.obligationId &&
    e.cashAccountId === o.bill.accountId &&
    e.principal.gte(o.amount)
  );
}
export function toBillOccurrenceDto(o: OccurrenceRecord) {
  return {
    id: o.id,
    user_id: o.userId,
    bill_id: o.billId,
    due_date: o.dueDate.toISOString().slice(0, 10),
    status: o.status === 'PAID' && !validBillPayment(o) ? 'NEEDS_REVIEW' : o.status,
    amount: o.amount.toFixed(2),
    transaction_id: o.transactionId,
    obligation_event_id: o.obligationEventId,
    note: o.note,
    version: o.version.toString(),
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
  };
}
const occurrenceInclude = { bill: true, transaction: true, obligationEvent: true } as const;

export class BillRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  async schedule(
    userId: string,
    id: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    payload: unknown,
  ) {
    const tx = this.tx;
    if (operation !== 'CREATE') {
      const old = await tx.billSchedule.findFirst({ where: { id, userId, deletedAt: null } });
      if (!old) fail('Jadwal tidak ditemukan.', 404);
      const data =
        operation === 'DELETE'
          ? { deletedAt: new Date(), active: false }
          : UpdateBillSchema.parse(payload);
      return tx.billSchedule.update({
        where: { id },
        data:
          operation === 'DELETE'
            ? { ...data, version: { increment: 1 } }
            : {
                title: UpdateBillSchema.parse(payload).title,
                active: UpdateBillSchema.parse(payload).active,
                reminderEnabled: UpdateBillSchema.parse(payload).reminder_enabled,
                reminderDays: UpdateBillSchema.parse(payload).reminder_days,
                version: { increment: 1 },
              },
      });
    }
    const input = CreateBillSchema.parse(payload);
    if ((await tx.billSchedule.count({ where: { userId, deletedAt: null } })) >= 200)
      fail('Maksimal 200 jadwal aktif.');
    if (
      !(await tx.account.findFirst({
        where: {
          id: input.account_id,
          userId,
          currency: 'IDR',
          deletedAt: null,
          accountType: { userId, category: 'CASH', deletedAt: null },
          children: { none: { deletedAt: null } },
          mappedObligations: { none: { deletedAt: null } },
        },
      }))
    )
      fail('Pilih akun kas IDR milik sendiri yang aktif.');
    let installments: Prisma.InputJsonValue = [];
    if (input.obligation_id) {
      const debt = await tx.obligation.findFirst({
        where: { id: input.obligation_id, userId, deletedAt: null },
      });
      if (!debt) fail('Pinjaman tidak ditemukan.', 404);
      const rows = z
        .array(
          z.strictObject({
            due_date: z.iso.date(),
            principal: GoalMoneySchema.refine((v) => /[1-9]/.test(v)),
          }),
        )
        .min(1)
        .max(360)
        .parse(debt.installments);
      if (
        rows[0]?.due_date !== input.anchor_date ||
        rows[0]?.principal !== input.amount ||
        input.transaction_type !== (debt.kind === 'PAYABLE' ? 'EXPENSE' : 'INCOME')
      )
        fail('Gunakan tanggal/pokok cicilan pertama dan jenis pinjaman yang sesuai.');
      installments = rows;
    } else if (
      !(await tx.category.findFirst({
        where: {
          id: input.category_id ?? '',
          userId,
          type: input.transaction_type,
          deletedAt: null,
        },
      }))
    )
      fail('Pilih kategori milik sendiri dengan jenis yang sesuai.');
    return tx.billSchedule.create({
      data: {
        id,
        userId,
        title: input.title,
        transactionType: input.transaction_type,
        amountType: input.amount_type,
        amount: input.amount,
        accountId: input.account_id,
        categoryId: input.category_id,
        obligationId: input.obligation_id,
        frequency: input.frequency,
        anchorDate: new Date(input.anchor_date),
        endDate: input.end_date ? new Date(input.end_date) : null,
        utcOffsetMinutes: input.utc_offset_minutes,
        installments,
        reminderEnabled: input.reminder_enabled,
        reminderDays: input.reminder_days,
      },
    });
  }
  private async snapshots(
    userId: string,
    bill: BillSchedule,
    occurrenceId: string,
    ledgerId: string,
  ) {
    await publish(
      this.tx,
      'bill_occurrences',
      occurrenceId,
      [userId],
      (await this.tx.billOccurrence.count({ where: { id: occurrenceId } })) ? 'UPDATE' : 'DELETE',
      null,
    );
    await publish(this.tx, 'accounts', bill.accountId, [userId], 'UPDATE', null);
    await publish(
      this.tx,
      'transactions',
      ledgerId,
      [userId],
      (await this.tx.transaction.count({ where: { id: ledgerId, deletedAt: null } }))
        ? 'UPDATE'
        : 'DELETE',
      null,
    );
  }
  async command(userId: string, id: string, raw: BillCommandInput, cancel = false) {
    const tx = this.tx,
      input = BillCommandSchema.parse(raw),
      fingerprint = billFingerprint(input);
    const bill = await tx.billSchedule.findFirst({ where: { id: input.bill_id, userId } });
    if (!bill) fail('Jadwal tidak ditemukan.', 404);
    const occurrenceId = billOccurrenceId(bill.id, input.due_date);
    if (new Set([id, input.ledger_id, bill.id, occurrenceId]).size !== 4)
      fail('ID perintah harus berbeda.');
    const prior = await tx.billCommand.findUnique({ where: { id } });
    if (prior && (prior.userId !== userId || prior.fingerprint !== fingerprint))
      fail('Identitas perintah sudah digunakan.', 409);
    const existing = await tx.billOccurrence.findFirst({
      where: { id: occurrenceId, userId },
      include: occurrenceInclude,
    });
    if (prior) {
      await this.snapshots(userId, bill, occurrenceId, input.ledger_id);
      if (prior.outcome === 'CANCELLED' && !cancel)
        return {
          status: 'conflict' as const,
          server_data: existing ? toBillOccurrenceDto(existing) : null,
          message: 'Perintah sudah dibatalkan.',
        };
      return {
        status: 'applied' as const,
        server_data: existing ? toBillOccurrenceDto(existing) : null,
      };
    }
    if (
      (await tx.transaction.count({ where: { id: { in: [id, input.ledger_id] } } })) ||
      (await tx.billCommand.count({
        where: { OR: [{ ledgerId: { in: [id, input.ledger_id] } }, { id: input.ledger_id }] },
      })) ||
      (await tx.obligationCommandId.count({ where: { id: { in: [id, input.ledger_id] } } }))
    )
      fail('ID keuangan tidak tersedia.', 409);
    if (cancel) {
      await tx.billCommand.create({
        data: {
          id,
          userId,
          billId: bill.id,
          ledgerId: input.ledger_id,
          fingerprint,
          payload: input,
          outcome: 'CANCELLED',
        },
      });
      await this.snapshots(userId, bill, occurrenceId, input.ledger_id);
      return {
        status: 'applied' as const,
        server_data: existing ? toBillOccurrenceDto(existing) : null,
      };
    }
    if (bill.deletedAt || !bill.active) fail('Jadwal tidak aktif.');
    const due = billDue(bill, input.due_date);
    if (!due) fail('Tanggal bukan bagian dari jadwal.');
    if (
      input.expected_version !== (existing?.version.toString() ?? '0') ||
      (existing && validBillPayment(existing)) ||
      (existing?.status === 'SKIPPED' && input.action !== 'REOPEN') ||
      (existing?.status === 'PAID' &&
        input.action !== 'REOPEN' &&
        !input.action.startsWith('LINK_'))
    ) {
      await this.snapshots(userId, bill, occurrenceId, input.ledger_id);
      return {
        status: 'conflict' as const,
        server_data: existing ? toBillOccurrenceDto(existing) : null,
        message: 'Kejadian sudah dibayar/dilewati atau versinya berubah.',
      };
    }
    const expected = due === 'scheduled' ? bill.amount : new Prisma.Decimal(due);
    let amount = new Prisma.Decimal(0),
      transactionId: string | null = null,
      obligationEventId: string | null = null;
    if (input.action === 'REOPEN' && !existing) fail('Kejadian belum dicatat.');
    if (input.action === 'PAY' || input.action === 'LINK_TRANSACTION') {
      if (bill.obligationId || !bill.categoryId)
        fail('Tautkan pembayaran melalui modul Utang / Piutang.');
      if (input.action === 'LINK_TRANSACTION') {
        const record = await tx.transaction.findFirst({
          where: {
            id: input.record_id ?? '',
            accountId: bill.accountId,
            categoryId: bill.categoryId,
            type: bill.transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
            deletedAt: null,
            account: { userId, deletedAt: null },
            obligationEventId: null,
            transferId: null,
          },
        });
        if (!record) fail('Transaksi pembayaran tidak sesuai.');
        if (
          await tx.billOccurrence.count({
            where: { transactionId: record.id, id: { not: occurrenceId } },
          })
        )
          fail('Transaksi sudah dipakai tagihan lain.', 409);
        amount = record.amount;
        transactionId = record.id;
      } else {
        amount = new Prisma.Decimal(input.amount ?? '0');
        transactionId = input.ledger_id;
      }
      if (amount.lte(0) || (bill.amountType === 'FIXED' && !amount.equals(expected)))
        fail('Nominal aktual harus sesuai nilai tetap.');
    } else if (input.action === 'LINK_OBLIGATION') {
      if (!bill.obligationId) fail('Jadwal bukan cicilan pinjaman.');
      const event = await tx.obligationEvent.findFirst({
        where: {
          id: input.record_id ?? '',
          userId,
          obligationId: bill.obligationId,
          operation: 'REPAY',
          reversedAt: null,
          deletedAt: null,
          cashAccountId: bill.accountId,
        },
      });
      if (!event) fail('Pembayaran pinjaman tidak sesuai.');
      const used = await tx.billOccurrence.aggregate({
        where: { obligationEventId: event.id, status: 'PAID', id: { not: occurrenceId } },
        _sum: { amount: true },
      });
      if (expected.plus(used._sum.amount ?? 0).gt(event.principal))
        fail('Pokok pembayaran sudah dipakai atau kurang untuk cicilan ini.', 409);
      amount = expected;
      obligationEventId = event.id;
    }
    await tx.billCommand.create({
      data: {
        id,
        userId,
        billId: bill.id,
        ledgerId: input.ledger_id,
        fingerprint,
        payload: input,
        outcome: 'RESERVED',
      },
    });
    if (input.action === 'PAY') {
      const accounts = await lockLedgerAccounts(tx, userId, [bill.accountId]);
      if (
        !(await tx.account.findFirst({
          where: {
            id: bill.accountId,
            userId,
            currency: 'IDR',
            deletedAt: null,
            accountType: { category: 'CASH', deletedAt: null },
            children: { none: { deletedAt: null } },
          },
        }))
      )
        fail('Akun pembayaran tidak tersedia.');
      if (
        !(await tx.category.findFirst({
          where: {
            id: bill.categoryId ?? '',
            userId,
            type: bill.transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
            deletedAt: null,
          },
        }))
      )
        fail('Kategori pembayaran tidak tersedia.');
      await tx.transaction.create({
        data: {
          id: input.ledger_id,
          billCommandId: id,
          accountId: bill.accountId,
          categoryId: bill.categoryId,
          type: bill.transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
          amount,
          transactedAt: new Date(input.transacted_at),
          description: `${bill.title}${input.note ? `: ${input.note}` : ''}`,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await recomputeLedgerBalances(tx, accounts);
    }
    const status =
      input.action === 'SKIP' ? 'SKIPPED' : input.action === 'REOPEN' ? 'PENDING' : 'PAID';
    const data = { status, amount, transactionId, obligationEventId, note: input.note };
    const occurrence = existing
      ? await tx.billOccurrence.update({
          where: { id: occurrenceId },
          data: { ...data, version: { increment: 1 } },
          include: occurrenceInclude,
        })
      : await tx.billOccurrence.create({
          data: {
            id: occurrenceId,
            userId,
            billId: bill.id,
            dueDate: new Date(input.due_date),
            ...data,
          },
          include: occurrenceInclude,
        });
    await tx.billCommand.update({ where: { id }, data: { outcome: 'APPLIED', occurrenceId } });
    await this.snapshots(userId, bill, occurrenceId, input.ledger_id);
    return { status: 'applied' as const, server_data: toBillOccurrenceDto(occurrence) };
  }
}
