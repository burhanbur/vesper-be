import type { PaginatedData } from '../../common/http/api-response.js';
import type { ReferencePage, ReferenceRepository } from './reference.repository.js';
import type {
    ListRefAccountTypesQuery,
    ListRefCategoriesQuery,
    RefAccountTypeDto,
    RefCategoryDto,
} from './reference.schema.js';

function paginate<T, D>(
    result: ReferencePage<T>,
    query: ListRefAccountTypesQuery,
    toDto: (record: T) => D,
): PaginatedData<D> {
    const offset = (query.page - 1) * query.limit;
    return {
        items: result.items.map(toDto),
        pagination: {
            total: result.total,
            per_page: query.limit,
            current_page: query.page,
            last_page: Math.max(1, Math.ceil(result.total / query.limit)),
            from: result.items.length ? offset + 1 : null,
            to: result.items.length ? offset + result.items.length : null,
        },
    };
}

function toDto(record: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}): RefAccountTypeDto {
    return {
        id: record.id,
        name: record.name,
        created_at: record.createdAt.toISOString(),
        updated_at: record.updatedAt.toISOString(),
    };
}

export class ReferenceService {
    constructor(private readonly repository: ReferenceRepository) { }

    async listAccountTypes(
        query: ListRefAccountTypesQuery,
    ): Promise<PaginatedData<RefAccountTypeDto>> {
        return paginate(await this.repository.listAccountTypes(query), query, toDto);
    }

    async listCategories(query: ListRefCategoriesQuery): Promise<PaginatedData<RefCategoryDto>> {
        return paginate(await this.repository.listCategories(query), query, (record) => ({
            ...toDto(record),
            type: record.type,
        }));
    }
}
