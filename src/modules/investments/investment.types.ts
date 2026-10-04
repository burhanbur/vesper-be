import type {
  Instrument,
  InstrumentPrice,
  InvestmentTransaction,
} from '../../generated/prisma/client.js';
export function toInstrumentDto(row: Instrument) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    currency: 'IDR' as const,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
  };
}
export function toPriceDto(row: InstrumentPrice) {
  return {
    id: row.id,
    instrument_id: row.instrumentId,
    price_date: row.priceDate.toISOString().slice(0, 10),
    close_price: row.closePrice.toFixed(8),
    source: 'MANUAL' as const,
    updated_by: row.updatedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
export function toInvestmentDto(row: InvestmentTransaction) {
  return {
    id: row.id,
    instrument_id: row.instrumentId,
    account_id: row.accountId,
    cash_account_id: row.cashAccountId,
    linked_transaction_id: row.linkedTransactionId,
    type: row.type,
    quantity: row.quantity.toFixed(8),
    price_per_unit: row.pricePerUnit.toFixed(8),
    fee: row.fee.toFixed(2),
    realized_pl: row.realizedPl?.toFixed(2) ?? null,
    transacted_at: row.transactedAt.toISOString(),
    description: row.description,
    version: row.version.toString(),
    created_by: row.createdBy,
    updated_by: row.updatedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
  };
}
