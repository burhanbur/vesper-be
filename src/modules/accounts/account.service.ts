import type { PaginatedData } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { AccountRepository } from './account.repository.js';
import type {
  AccountDto,
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from './account.schema.js';
import { toAccountDto } from './account.types.js';

export class AccountService {
  constructor(private readonly repository: AccountRepository) {}

  async list(userId: string, query: ListAccountsQuery): Promise<PaginatedData<AccountDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toAccountDto),
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
  async create(userId: string, input: CreateAccountInput): Promise<AccountDto> {
    return toAccountDto(await this.repository.create(userId, generateId(), input));
  }
  async update(userId: string, id: string, input: UpdateAccountInput): Promise<AccountDto> {
    return toAccountDto(await this.repository.update(userId, id, input));
  }
  delete(userId: string, id: string, version: string): Promise<void> {
    return this.repository.softDelete(userId, id, BigInt(version));
  }
}
