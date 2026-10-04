import { AppError } from '../../common/errors/app-error.js';
import { Prisma, type InvestmentTransaction } from '../../generated/prisma/client.js';

// Products need up to 40 significant digits; divisions use ample guard precision.
export const InvestmentDecimal = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
export function investmentError(
  code: string,
  message: string,
  statusCode: 409 | 422 | 404 = 422,
): never {
  throw new AppError({ code, message, statusCode });
}
export function bounded(value: Prisma.Decimal, scale: 2 | 8): string {
  const rounded = value.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
  const max = scale === 2 ? '999999999999999999.99' : '999999999999.99999999';
  if (!rounded.isFinite() || rounded.abs().greaterThan(max))
    investmentError('INVESTMENT_NUMERIC_LIMIT', 'Nilai investasi melebihi batas maksimum.', 409);
  return rounded.toFixed(scale);
}
export type Position = { quantity: Prisma.Decimal; average: Prisma.Decimal };
export function emptyPosition(): Position {
  return { quantity: new InvestmentDecimal(0), average: new InvestmentDecimal(0) };
}
export function advance(
  position: Position,
  row: Pick<InvestmentTransaction, 'type' | 'quantity' | 'pricePerUnit'>,
): Position {
  const quantity = new InvestmentDecimal(row.quantity.toString());
  if (row.type === 'DIVIDEND') return position;
  if (row.type === 'SELL') {
    if (quantity.greaterThan(position.quantity))
      investmentError('INVESTMENT_OVERSELL', 'Quantity jual melebihi holding tersedia.', 409);
    const remaining = position.quantity.minus(quantity);
    return {
      quantity: remaining,
      average: remaining.isZero() ? new InvestmentDecimal(0) : position.average,
    };
  }
  const next = position.quantity.plus(quantity);
  bounded(next, 8);
  // Moving weighted purchase price, excluding fees. Partial SELL retains the average.
  return {
    quantity: next,
    average: position.quantity
      .mul(position.average)
      .plus(quantity.mul(row.pricePerUnit.toString()))
      .div(next),
  };
}
export function replay(
  rows: Pick<InvestmentTransaction, 'type' | 'quantity' | 'pricePerUnit'>[],
): Position {
  return rows.reduce(advance, emptyPosition());
}
export function valuation(position: Position, price: Prisma.Decimal) {
  const marketPrice = new InvestmentDecimal(price.toString());
  return {
    quantityHeld: bounded(position.quantity, 8),
    avgCostPrice: bounded(position.average, 8),
    marketPrice: bounded(marketPrice, 8),
    marketValue: bounded(position.quantity.mul(marketPrice), 2),
    unrealizedPl: bounded(position.quantity.mul(marketPrice.minus(position.average)), 2),
  };
}
export function nextDay(date: string): Date {
  return new Date(new Date(date + 'T00:00:00.000Z').getTime() + 86400000);
}
