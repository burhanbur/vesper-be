import { AppError } from '../../common/errors/app-error.js';
import type { PaginatedData } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { CategoryRepository } from './category.repository.js';
import type {
  CategoryDto,
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './category.schema.js';
import { toCategoryDto, type CategoryMutationResult } from './category.types.js';

function mutationDto(result: CategoryMutationResult): CategoryDto {
  if (result.status === 'missing') {
    throw new AppError({
      statusCode: 404,
      code: 'CATEGORY_NOT_FOUND',
      message: 'Kategori tidak ditemukan.',
    });
  }
  if (result.status === 'version_conflict') {
    throw new AppError({
      statusCode: 409,
      code: 'CATEGORY_VERSION_CONFLICT',
      message: 'Versi kategori tidak sesuai atau telah mencapai batas maksimum.',
      errors: { server_data: toCategoryDto(result.record) },
    });
  }
  return toCategoryDto(result.record);
}

export class CategoryService {
  constructor(private readonly repository: CategoryRepository) {}

  async list(userId: string, query: ListCategoriesQuery): Promise<PaginatedData<CategoryDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toCategoryDto),
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

  async create(userId: string, input: CreateCategoryInput): Promise<CategoryDto> {
    return toCategoryDto(await this.repository.create(userId, generateId(), input));
  }

  async update(userId: string, id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
    return mutationDto(await this.repository.update(userId, id, input));
  }

  async delete(userId: string, id: string, version: string): Promise<void> {
    mutationDto(await this.repository.softDelete(userId, id, BigInt(version)));
  }
}
