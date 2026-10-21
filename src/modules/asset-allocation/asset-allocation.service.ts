import { Prisma } from '../../generated/prisma/client.js';
import type { NetWorthRepository, NetWorthSource } from '../net-worth/net-worth.repository.js';
import { consolidateNetWorth } from '../net-worth/net-worth.service.js';
import {
  assetClasses,
  AllocationDtoSchema,
  type AllocationDto,
} from './asset-allocation.schema.js';

const Decimal = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
type AllocationClass = AllocationDto['classes'][number];
type AllocationInstrument = AllocationDto['instruments'][number];

export function consolidateAllocation(source: NetWorthSource, observed: Date): AllocationDto {
  const date = observed.toISOString().slice(0, 10);
  const net = consolidateNetWorth(source, 'IDR', date, observed);
  const classes = new Map<string, AllocationClass>(
    assetClasses.map((asset_class) => [
      asset_class,
      {
        asset_class,
        known_amount: '0.00',
        market_value: '0.00',
        weight_percent: null,
        unavailable_count: 0,
      },
    ]),
  );
  const instruments = new Map<string, AllocationInstrument>();
  const metadata = new Map(source.instruments.map((i) => [i.id, i]));
  const warnings: string[] = [];
  let complete = net.status === 'complete';
  function add(kind: AllocationClass['asset_class'], value: string | null): void {
    const group = classes.get(kind) ?? {
      asset_class: kind,
      known_amount: '0.00',
      market_value: '0.00',
      weight_percent: null,
      unavailable_count: 0,
    };
    if (value === null) {
      group.unavailable_count++;
      group.market_value = null;
    } else {
      group.known_amount = new Decimal(group.known_amount).plus(value).toFixed(2);
      if (group.market_value !== null) group.market_value = group.known_amount;
    }
    classes.set(kind, group);
  }
  for (const account of net.accounts) {
    if (new Decimal(account.balance).gt(0)) add('CASH', account.balance);
  }
  add('RECEIVABLE', net.receivables_value ?? null);
  for (const holding of net.holdings) {
    const info = metadata.get(holding.instrument_id);
    const kind = info?.type && assetClasses.includes(info.type) ? info.type : 'UNCLASSIFIED';
    const value = holding.market_value;
    if (value === null || kind === 'UNCLASSIFIED') complete = false;
    add(kind, value);
    const row = instruments.get(holding.instrument_id) ?? {
      instrument_id: holding.instrument_id,
      code: info?.code ?? null,
      name: info?.name ?? null,
      asset_class: kind,
      quantity: '0.00000000',
      account_count: 0,
      known_amount: '0.00',
      market_value: '0.00',
      weight_percent: null,
      price_date: holding.price_date,
      price_source: holding.price_source,
      stale: holding.stale,
      unavailable_reasons: [],
    };
    row.quantity = new Decimal(row.quantity).plus(holding.quantity).toFixed(8);
    row.account_count++;
    if (
      kind === 'UNCLASSIFIED' &&
      !row.unavailable_reasons.includes('instrument_class_unavailable')
    )
      row.unavailable_reasons.push('instrument_class_unavailable');
    if (value === null) {
      row.market_value = null;
      const reason =
        kind === 'UNCLASSIFIED'
          ? 'instrument_class_unavailable'
          : (holding.unavailable_reason ?? 'valuation_unavailable');
      if (!row.unavailable_reasons.includes(reason)) row.unavailable_reasons.push(reason);
    } else {
      row.known_amount = new Decimal(row.known_amount).plus(value).toFixed(2);
      if (row.market_value !== null) row.market_value = row.known_amount;
    }
    instruments.set(holding.instrument_id, row);
  }
  // Gross assets, never signed balances or net worth, define every displayed share.
  const known = [...classes.values()].reduce((sum, c) => sum.plus(c.known_amount), new Decimal(0));
  const percentage = (value: string | null) =>
    complete && known.gt(0) && value !== null
      ? new Decimal(value).mul(100).div(known).toFixed(2, Decimal.ROUND_DOWN)
      : null;
  for (const row of classes.values()) row.weight_percent = percentage(row.market_value);
  for (const row of instruments.values()) row.weight_percent = percentage(row.market_value);
  if (!complete) warnings.push('allocation_incomplete_percentages_unavailable');
  if (!known.gt(0)) warnings.push('no_positive_known_assets');
  if ([...instruments.values()].some((i) => i.stale)) warnings.push('stale_prices_provisional');
  warnings.push(...net.missing_components.filter((c) => c !== 'attribution_unavailable'));
  return AllocationDtoSchema.parse({
    scope: 'owner',
    currency: 'IDR',
    snapshot_date: date,
    observed_at: observed.toISOString(),
    balance_basis: 'current_recorded_ledger',
    status: complete ? 'complete' : 'partial',
    denominator: 'gross_positive_supported_assets',
    known_assets: known.toFixed(2),
    total_assets: complete ? known.toFixed(2) : null,
    excluded_liabilities: new Decimal(net.known_balance_liabilities ?? '0')
      .plus(net.obligation_liabilities ?? '0')
      .toFixed(2),
    excluded_account_count: net.excluded_account_count,
    warnings: [...new Set(warnings)],
    classes: [...classes.values()],
    instruments: [...instruments.values()].sort(
      (a, b) =>
        new Decimal(b.known_amount).comparedTo(a.known_amount) ||
        a.instrument_id.localeCompare(b.instrument_id),
    ),
  });
}

export class AssetAllocationService {
  constructor(
    private readonly repository: NetWorthRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async snapshot(userId: string): Promise<AllocationDto> {
    const at = this.now();
    return consolidateAllocation(
      await this.repository.read(userId, 'IDR', at.toISOString().slice(0, 10)),
      at,
    );
  }
}
