import type { PaginatedData } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { TransactionRepository } from './transaction.repository.js';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  TransactionDto,
  UpdateTransactionInput,
} from './transaction.schema.js';
import { toTransactionDto } from './transaction.types.js';

export class TransactionService {
  constructor(private readonly repository: TransactionRepository) {}
  async list(userId: string, query: ListTransactionsQuery): Promise<PaginatedData<TransactionDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toTransactionDto),
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
  async create(userId: string, input: CreateTransactionInput): Promise<TransactionDto> {
    return toTransactionDto(await this.repository.create(userId, generateId(), input));
  }
  async update(userId: string, id: string, input: UpdateTransactionInput): Promise<TransactionDto> {
    return toTransactionDto(await this.repository.update(userId, id, input));
  }
  async delete(userId: string, id: string, version: string): Promise<void> {
    await this.repository.softDelete(userId, id, BigInt(version));
  }
}
