import type { InvestmentRepository } from './investment.repository.js';
import type {
  CreateInstrumentInput,
  CreatePriceInput,
  CreateInvestmentInput,
  ListInstrumentsQuery,
  ListPricesQuery,
} from './investment.schema.js';
import { toInstrumentDto, toPriceDto, toInvestmentDto } from './investment.types.js';
function paginate<T>(items: T[], total: number, query: { page: number; limit: number }) {
  const offset = (query.page - 1) * query.limit;
  return {
    items,
    pagination: {
      total,
      per_page: query.limit,
      current_page: query.page,
      last_page: Math.max(1, Math.ceil(total / query.limit)),
      from: items.length ? offset + 1 : null,
      to: items.length ? offset + items.length : null,
    },
  };
}
export class InvestmentService {
  constructor(private readonly repository: InvestmentRepository) {}
  async instruments(query: ListInstrumentsQuery) {
    const result = await this.repository.listInstruments(query);
    return paginate(result.items.map(toInstrumentDto), result.total, query);
  }
  async createInstrument(input: CreateInstrumentInput) {
    return toInstrumentDto(await this.repository.createInstrument(input));
  }
  async prices(query: ListPricesQuery) {
    const result = await this.repository.listPrices(query);
    return paginate(result.items.map(toPriceDto), result.total, query);
  }
  async upsertPrice(userId: string, input: CreatePriceInput) {
    return toPriceDto(await this.repository.upsertPrice(userId, input));
  }
  async createTransaction(userId: string, input: CreateInvestmentInput) {
    return toInvestmentDto(await this.repository.createTransaction(userId, input));
  }
  holdings(userId: string, id: string) {
    return this.repository.holdings(userId, id);
  }
  snapshot(userId: string, id: string, date: string) {
    return this.repository.snapshot(userId, id, date);
  }
}
