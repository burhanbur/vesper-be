import { AppError } from '../../common/errors/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { NetWorthRepository, NetWorthSource } from './net-worth.repository.js';
import { NetWorthQuerySchema, type NetWorthDto, type NetWorthQuery } from './net-worth.schema.js';

const Decimal = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
const limitations = ['liabilities_unmodeled', 'receivables_unmodeled', 'attribution_unavailable'];

export function consolidateNetWorth(
  source: NetWorthSource,
  currency: string,
  date: string,
  observed: Date,
): NetWorthDto {
  const result: NetWorthDto = {
    scope: 'owner',
    currency,
    snapshot_date: date,
    observed_at: observed.toISOString(),
    balance_basis: 'current_recorded_ledger',
    status: 'partial',
    known_assets: '0.00',
    known_balance_liabilities: '0.00',
    known_net_worth: '0.00',
    net_worth: null,
    cash_balance: '0.00',
    investment_cash_balance: '0.00',
    holdings_value: '0.00',
    attribution: 'unavailable',
    missing_components: [...limitations],
    excluded_account_count: 0,
    accounts: [],
    holdings: [],
  };
  let assets = new Decimal(0);
  let liabilities = new Decimal(0);
  let cash = new Decimal(0);
  let investmentCash = new Decimal(0);
  let holdings = new Decimal(0);
  const eligible = new Set<string>();
  const mappedIds = new Set(
    source.obligations?.flatMap((o) => (o.linkedAccountId ? [o.linkedAccountId] : [])) ?? [],
  );
  let obligationLiabilities = new Decimal(0),
    receivables = new Decimal(0),
    obligationsIncomplete = false;
  if (source.obligations !== undefined) {
    result.missing_components = ['attribution_unavailable'];
    for (const debt of source.obligations) {
      const linked = debt.linkedAccount;
      if (
        debt.linkedAccountId &&
        (!linked ||
          linked.deletedAt ||
          !source.accounts.some((a) => a.id === linked.id) ||
          linked.currency !== currency ||
          !new Decimal(linked.balance.toString()).equals(
            new Decimal(debt.outstanding.toString()).mul(debt.kind === 'PAYABLE' ? -1 : 1),
          ))
      ) {
        obligationsIncomplete = true;
        continue;
      }
      if (linked && (!linked.isIncludeTotal || linked.children.length)) continue;
      const amount = new Decimal(debt.outstanding.toString());
      if (debt.kind === 'PAYABLE') obligationLiabilities = obligationLiabilities.plus(amount);
      else receivables = receivables.plus(amount);
    }
    result.obligation_liabilities = obligationLiabilities.toFixed(2);
    result.receivables_value = receivables.toFixed(2);
    if (obligationsIncomplete)
      result.missing_components.push('mapped_obligation_account_unavailable');
  }
  for (const account of source.accounts) {
    if (mappedIds.has(account.id)) continue;
    if (!account.isIncludeTotal || account.children.length > 0) {
      result.excluded_account_count++;
      continue;
    }
    eligible.add(account.id);
    const balance = new Decimal(account.balance.toString());
    result.accounts.push({
      account_id: account.id,
      category: account.accountType.category,
      balance: balance.toFixed(2),
    });
    if (balance.isNegative()) liabilities = liabilities.plus(balance.abs());
    else assets = assets.plus(balance);
    if (account.accountType.category === 'CASH') cash = cash.plus(balance);
    else investmentCash = investmentCash.plus(balance);
  }
  const quantities = new Map<
    string,
    { accountId: string; instrumentId: string; quantity: Prisma.Decimal }
  >();
  for (const row of source.positions) {
    if (!eligible.has(row.accountId)) continue;
    const key = row.accountId + ':' + row.instrumentId;
    const position = quantities.get(key) ?? {
      accountId: row.accountId,
      instrumentId: row.instrumentId,
      quantity: new Decimal(0),
    };
    const quantity = new Decimal(row._sum.quantity?.toString() ?? '0');
    position.quantity = position.quantity.plus(row.type === 'BUY' ? quantity : quantity.negated());
    quantities.set(key, position);
  }
  const instruments = new Map(source.instruments.map((instrument) => [instrument.id, instrument]));
  let incomplete = false;
  for (const position of quantities.values()) {
    if (position.quantity.isZero()) continue;
    const instrument = instruments.get(position.instrumentId);
    const price = instrument?.prices[0];
    const reason = position.quantity.isNegative()
      ? 'invalid_position'
      : !instrument || instrument.deletedAt
        ? 'instrument_unavailable'
        : instrument.currency !== currency
          ? 'currency_mismatch'
          : !price
            ? 'price_missing'
            : null;
    const priceDate = price?.priceDate.toISOString().slice(0, 10) ?? null;
    // Each position is rounded once to cents, matching the existing portfolio valuation boundary.
    const value =
      reason || !price
        ? null
        : new Decimal(position.quantity.toString())
            .mul(price.closePrice.toString())
            .toDecimalPlaces(2);
    if (value) holdings = holdings.plus(value);
    else incomplete = true;
    result.holdings.push({
      account_id: position.accountId,
      instrument_id: position.instrumentId,
      quantity: position.quantity.toFixed(8),
      market_value: value?.toFixed(2) ?? null,
      price: reason || !price ? null : price.closePrice.toFixed(8),
      price_date: reason ? null : priceDate,
      price_source: reason ? null : (price?.source ?? null),
      stale: reason || !priceDate ? null : priceDate < date,
      unavailable_reason: reason,
    });
  }
  if (incomplete) result.missing_components.push('holdings_valuation_incomplete');
  result.cash_balance = cash.toFixed(2);
  result.investment_cash_balance = investmentCash.toFixed(2);
  result.holdings_value = incomplete ? null : holdings.toFixed(2);
  // Known subtotal excludes unknown positions; never label it complete net worth.
  result.known_assets = assets.plus(holdings).plus(receivables).toFixed(2);
  result.known_balance_liabilities = liabilities.toFixed(2);
  result.known_net_worth = assets
    .plus(holdings)
    .plus(receivables)
    .minus(liabilities)
    .minus(obligationLiabilities)
    .toFixed(2);
  if (source.obligations !== undefined && !incomplete && !obligationsIncomplete) {
    result.status = 'complete';
    result.net_worth = result.known_net_worth;
  }
  return result;
}

export class NetWorthService {
  constructor(
    private readonly repository: NetWorthRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async snapshot(userId: string, query: NetWorthQuery): Promise<NetWorthDto> {
    const input = NetWorthQuerySchema.parse(query);
    const observed = this.now();
    const today = observed.toISOString().slice(0, 10);
    const date = input.date ?? today;
    if (date > today)
      throw new AppError({
        statusCode: 422,
        code: 'NET_WORTH_FUTURE_DATE',
        message: 'Tanggal snapshot tidak boleh di masa depan.',
      });
    if (date < today) {
      const captured = await this.repository.findCapture(userId, input.currency, date);
      if (captured) return captured;
      return {
        scope: 'owner',
        currency: input.currency,
        snapshot_date: date,
        observed_at: observed.toISOString(),
        balance_basis: 'unavailable',
        status: 'unavailable',
        known_assets: null,
        known_balance_liabilities: null,
        known_net_worth: null,
        net_worth: null,
        cash_balance: null,
        investment_cash_balance: null,
        holdings_value: null,
        attribution: 'unavailable',
        missing_components: ['historical_balance_evidence_unavailable', ...limitations],
        excluded_account_count: 0,
        accounts: [],
        holdings: [],
      };
    }
    const snapshot = consolidateNetWorth(
      await this.repository.read(userId, input.currency, date),
      input.currency,
      date,
      observed,
    );
    await this.repository.capture(userId, snapshot);
    return snapshot;
  }
}
