import { generateId } from '../../common/utils/id.js';
import { accessibleAccount } from '../../common/authorization/account-access.js';
import type {
  Prisma,
  PrismaClient,
  Instrument,
  InstrumentPrice,
  InvestmentTransaction,
} from '../../generated/prisma/client.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from '../transactions/ledger.js';
import {
  InvestmentDecimal,
  advance,
  bounded,
  investmentError,
  nextDay,
  valuation,
} from './investment.calculation.js';
import {
  positionAt,
  refreshInvestmentSnapshots,
  refreshPriceSnapshots,
} from './investment.snapshot.js';
import type {
  CreateInstrumentInput,
  ListInstrumentsQuery,
  ListPricesQuery,
  CreatePriceInput,
  CreateInvestmentInput,
  HoldingDto,
  SnapshotDto,
} from './investment.schema.js';
import { toInstrumentDto } from './investment.types.js';
import { investmentSettlement } from './investment.settlement.js';

export interface InvestmentRepository {
  listInstruments(query: ListInstrumentsQuery): Promise<{ items: Instrument[]; total: number }>;
  createInstrument(input: CreateInstrumentInput): Promise<Instrument>;
  listPrices(query: ListPricesQuery): Promise<{ items: InstrumentPrice[]; total: number }>;
  upsertPrice(userId: string, input: CreatePriceInput): Promise<InstrumentPrice>;
  createTransaction(userId: string, input: CreateInvestmentInput): Promise<InvestmentTransaction>;
  holdings(userId: string, accountId: string): Promise<HoldingDto[]>;
  snapshot(userId: string, accountId: string, date: string): Promise<SnapshotDto[]>;
}
async function lockInstrument(tx: Prisma.TransactionClient, id: string) {
  // FIRST for every investment/price writer, before owner/type/account/ledger locks.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'investment:instrument:' + id}::text, 0))::text`;
  const instrument = await tx.instrument.findFirst({
    where: { id, deletedAt: null, currency: 'IDR' },
  });
  if (!instrument) investmentError('INSTRUMENT_NOT_FOUND', 'Instrumen aktif tidak ditemukan.', 404);
  return instrument;
}
async function requireInvestmentAccount(tx: Prisma.TransactionClient, userId: string, id: string) {
  const account = await tx.account.findFirst({
    where: {
      id,
      ...accessibleAccount(userId),
      currency: 'IDR',
      accountType: {
        deletedAt: null,
        user: { status: 'ACTIVE', deletedAt: null },
        category: 'INVESTMENT',
      },
    },
  });
  if (!account)
    investmentError(
      'INVESTMENT_ACCOUNT_NOT_FOUND',
      'Akun investasi aktif yang dapat diakses tidak ditemukan.',
      404,
    );
  return account;
}
export class PrismaInvestmentRepository implements InvestmentRepository {
  constructor(private readonly client: PrismaClient) { }
  async listInstruments(query: ListInstrumentsQuery) {
    const where: Prisma.InstrumentWhereInput = {
      deletedAt: null,
      ...(query.search
        ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
        : {}),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const [items, total] = await this.client.$transaction(
      [
        this.client.instrument.findMany({
          where,
          orderBy: [{ code: direction }, { id: direction }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.client.instrument.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }
  createInstrument(input: CreateInstrumentInput) {
    // DB unique(code) arbitrates concurrent global inserts; centralized P2002 -> 409.
    return this.client.instrument.create({ data: { id: generateId(), ...input } });
  }
  async listPrices(query: ListPricesQuery) {
    const where: Prisma.InstrumentPriceWhereInput = {
      instrument: { deletedAt: null },
      ...(query.instrument_id ? { instrumentId: query.instrument_id } : {}),
      ...(query.price_date ? { priceDate: new Date(query.price_date) } : {}),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const [items, total] = await this.client.$transaction(
      [
        this.client.instrumentPrice.findMany({
          where,
          orderBy: [{ priceDate: direction }, { id: direction }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.client.instrumentPrice.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }
  upsertPrice(userId: string, input: CreatePriceInput) {
    return this.client.$transaction(
      async (tx) => {
        await lockInstrument(tx, input.instrument_id);
        const data = { closePrice: input.close_price, source: 'MANUAL', updatedBy: userId };
        const priceDate = new Date(input.price_date);
        const record = await tx.instrumentPrice.upsert({
          where: { instrumentId_priceDate: { instrumentId: input.instrument_id, priceDate } },
          create: { id: generateId(), instrumentId: input.instrument_id, priceDate, ...data },
          update: data,
        });
        await refreshPriceSnapshots(tx, input.instrument_id, priceDate);
        return record;
      },
      { isolationLevel: 'ReadCommitted', timeout: 60000, maxWait: 10000 },
    );
  }
  createOffline(userId: string, id: string, linkedTransactionId: string, input: CreateInvestmentInput) {
    if (!input.cash_account_id || id === linkedTransactionId || input.type === 'DIVIDEND')
      investmentError('INVESTMENT_COMMAND_INVALID', 'Command investasi BUY/SELL memerlukan akun kas dan ID berbeda.');
    return this.createTransaction(userId, input, { id, linkedTransactionId });
  }
  createTransaction(
    userId: string,
    input: CreateInvestmentInput,
    command?: { id: string; linkedTransactionId: string },
  ) {
    return this.client.$transaction(
      async (tx) => {
        // Serialize an ID independently of its payload to reject altered retries safely.
        if (command)
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'investment:command:' + command.id}::text, 0))::text`;
        const instrument = await lockInstrument(tx, input.instrument_id);
        const accounts = await lockLedgerAccounts(tx, userId, [
          input.account_id,
          ...(input.cash_account_id ? [input.cash_account_id] : []),
        ]);
        const account = await requireInvestmentAccount(tx, userId, input.account_id);
        if (account.currency !== instrument.currency)
          investmentError(
            'INVESTMENT_CURRENCY_MISMATCH',
            'Mata uang akun dan instrumen harus IDR.',
          );
        if (input.cash_account_id) {
          if (input.cash_account_id === input.account_id)
            investmentError(
              'INVESTMENT_CASH_ACCOUNT_INVALID',
              'Akun cash harus berbeda dari akun investasi.',
            );
          const cash = await tx.account.findFirst({
            where: {
              id: input.cash_account_id,
              ...accessibleAccount(userId),
              currency: instrument.currency,
              accountType: {
                deletedAt: null,
                user: { status: 'ACTIVE', deletedAt: null },
                category: 'CASH',
              },
            },
          });
          if (!cash)
            investmentError(
              'INVESTMENT_CASH_ACCOUNT_INVALID',
              'Akun cash aktif yang dapat diakses dengan mata uang IDR diperlukan.',
            );
        }
        const transactedAt = new Date(input.transacted_at);
        if (command) {
          const previous = await tx.investmentTransaction.findUnique({ where: { id: command.id } });
          if (previous) {
            const same = previous.createdBy === userId && !previous.deletedAt && previous.version === 1n &&
              previous.accountId === input.account_id && previous.instrumentId === input.instrument_id &&
              previous.cashAccountId === input.cash_account_id && previous.type === input.type &&
              previous.linkedTransactionId === command.linkedTransactionId &&
              previous.quantity.equals(input.quantity) && previous.pricePerUnit.equals(input.price_per_unit) &&
              previous.fee.equals(input.fee) && previous.transactedAt.getTime() === transactedAt.getTime() &&
              previous.description === (input.description ?? null);
            const leg = same ? await tx.transaction.findUnique({ where: { id: command.linkedTransactionId } }) : null;
            const settlement = investmentSettlement(input);
            if (!same || !leg || leg.deletedAt || leg.version !== 1n || leg.createdBy !== userId ||
              leg.accountId !== input.cash_account_id || leg.categoryId !== null || leg.transferId !== null ||
              leg.type !== settlement.type || !leg.amount.equals(settlement.amount) ||
              leg.transactedAt.getTime() !== transactedAt.getTime() || leg.description !== (input.description ?? null))
              investmentError('INVESTMENT_COMMAND_CONFLICT', 'Command investasi berbeda atau tidak dapat diputar ulang.', 409);
            return previous;
          }
        }
        const latest = await tx.investmentTransaction.findFirst({
          where: { accountId: account.id, instrumentId: instrument.id },
          orderBy: [{ transactedAt: 'desc' }, { id: 'desc' }],
        });
        if (latest && transactedAt <= latest.transactedAt)
          investmentError(
            'INVESTMENT_CHRONOLOGY_CONFLICT',
            'Transaksi harus setelah timestamp transaksi terakhir untuk akun dan instrumen ini.',
            409,
          );
        const position = await positionAt(tx, account.id, instrument.id);
        const quantity = new InvestmentDecimal(input.quantity);
        const price = new InvestmentDecimal(input.price_per_unit);
        const fee = new InvestmentDecimal(input.fee);
        advance(position, { type: input.type, quantity, pricePerUnit: price });
        const realizedPl =
          input.type === 'SELL'
            ? bounded(quantity.mul(price.minus(position.average)).minus(fee), 2)
            : null;
        const gross = quantity.mul(price);
        const net = input.type === 'BUY' ? gross.plus(fee) : gross.minus(fee);
        bounded(net, 2);
        let linkedTransactionId: string | null = null;
        if (input.cash_account_id) {
          const settlement = investmentSettlement(input);
          linkedTransactionId = command?.linkedTransactionId ?? generateId();
          await tx.transaction.create({
            data: {
              id: linkedTransactionId,
              accountId: input.cash_account_id,
              categoryId: null,
              type: settlement.type,
              amount: settlement.amount,
              transactedAt,
              description: input.description ?? null,
              version: 1n,
              createdBy: userId,
              updatedBy: userId,
            },
          });
        }
        const record = await tx.investmentTransaction.create({
          data: {
            id: command?.id ?? generateId(),
            instrumentId: instrument.id,
            accountId: account.id,
            cashAccountId: input.cash_account_id,
            linkedTransactionId,
            type: input.type,
            quantity: input.quantity,
            pricePerUnit: input.price_per_unit,
            fee: input.fee,
            realizedPl,
            transactedAt,
            description: input.description ?? null,
            version: 1n,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        // Never set investment account balance to market value; only cash ledger changes.
        if (input.cash_account_id)
          await recomputeLedgerBalances(
            tx,
            accounts.filter((a) => a.id === input.cash_account_id),
          );
        await refreshInvestmentSnapshots(tx, account.id, instrument.id, transactedAt);
        return record;
      },
      { isolationLevel: 'ReadCommitted', timeout: 60000, maxWait: 10000 },
    );
  }
  private async readPositions(
    tx: Prisma.TransactionClient,
    userId: string,
    accountId: string,
    date?: string,
  ) {
    await requireInvestmentAccount(tx, userId, accountId);
    const instruments = await tx.instrument.findMany({
      where: {
        transactions: {
          some: {
            accountId,
            deletedAt: null,
            ...(date ? { transactedAt: { lt: nextDay(date) } } : {}),
          },
        },
      },
      orderBy: { code: 'asc' },
    });
    const items = [];
    for (const instrument of instruments) {
      const position = await positionAt(
        tx,
        accountId,
        instrument.id,
        date ? nextDay(date) : undefined,
      );
      items.push({ instrument, position });
    }
    return items;
  }
  holdings(userId: string, accountId: string) {
    return this.client.$transaction(
      async (tx) =>
        (await this.readPositions(tx, userId, accountId)).map(({ instrument, position }) => ({
          instrument: toInstrumentDto(instrument),
          quantity_held: bounded(position.quantity, 8),
          avg_cost_price: bounded(position.average, 8),
        })),
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    );
  }
  snapshot(userId: string, accountId: string, date: string) {
    return this.client.$transaction(
      async (tx) => {
        const items: SnapshotDto[] = [];
        for (const { instrument, position } of await this.readPositions(
          tx,
          userId,
          accountId,
          date,
        )) {
          const snapshotDate = new Date(date);
          const stored = await tx.portfolioDailySnapshot.findUnique({
            where: {
              accountId_instrumentId_snapshotDate: {
                accountId,
                instrumentId: instrument.id,
                snapshotDate,
              },
            },
          });
          const price = stored
            ? null
            : await tx.instrumentPrice.findFirst({
              where: { instrumentId: instrument.id, priceDate: { lte: snapshotDate } },
              orderBy: { priceDate: 'desc' },
            });
          const values = stored ?? (price ? valuation(position, price.closePrice) : null);
          items.push({
            account_id: accountId,
            snapshot_date: date,
            instrument: toInstrumentDto(instrument),
            quantity_held: bounded(position.quantity, 8),
            avg_cost_price: bounded(position.average, 8),
            market_price: values
              ? new InvestmentDecimal(values.marketPrice.toString()).toFixed(8)
              : null,
            market_value: values
              ? new InvestmentDecimal(values.marketValue.toString()).toFixed(2)
              : null,
            unrealized_pl: values
              ? new InvestmentDecimal(values.unrealizedPl.toString()).toFixed(2)
              : null,
          });
        }
        return items;
      },
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    );
  }
}
