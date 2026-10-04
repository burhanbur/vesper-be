import { AppError } from '../../common/errors/app-error.js';
import type { PaginatedData } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { AccountTypeRepository } from './account-type.repository.js';
import type {
  AccountTypeDto,
  CreateAccountTypeInput,
  ListAccountTypesQuery,
  UpdateAccountTypeInput,
} from './account-type.schema.js';
import { toAccountTypeDto, type AccountTypeMutationResult } from './account-type.types.js';

function mutationDto(result: AccountTypeMutationResult): AccountTypeDto {
  if (result.status === 'missing') {
    throw new AppError({
      statusCode: 404,
      code: 'ACCOUNT_TYPE_NOT_FOUND',
      message: 'Tipe akun tidak ditemukan.',
    });
  }
  if (result.status !== 'applied') {
    const categoryInUse = result.status === 'category_in_use';
    throw new AppError({
      statusCode: 409,
      code: categoryInUse ? 'ACCOUNT_TYPE_CATEGORY_IN_USE' : 'ACCOUNT_TYPE_VERSION_CONFLICT',
      message: categoryInUse
        ? 'Kategori tidak dapat diubah karena tipe akun sudah digunakan.'
        : 'Versi tipe akun tidak sesuai atau telah mencapai batas maksimum.',
      errors: { server_data: toAccountTypeDto(result.record) },
    });
  }
  return toAccountTypeDto(result.record);
}

export class AccountTypeService {
  constructor(private readonly repository: AccountTypeRepository) {}

  async list(userId: string, query: ListAccountTypesQuery): Promise<PaginatedData<AccountTypeDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toAccountTypeDto),
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

  async create(userId: string, input: CreateAccountTypeInput): Promise<AccountTypeDto> {
    return toAccountTypeDto(await this.repository.create(userId, generateId(), input));
  }

  async update(userId: string, id: string, input: UpdateAccountTypeInput): Promise<AccountTypeDto> {
    return mutationDto(await this.repository.update(userId, id, input));
  }

  async delete(userId: string, id: string, version: string): Promise<void> {
    mutationDto(await this.repository.softDelete(userId, id, BigInt(version)));
  }
}
