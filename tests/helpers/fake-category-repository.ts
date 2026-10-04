import type { CategoryRepository } from '../../src/modules/categories/category.repository.js';
import type {
    CreateCategoryInput,
    ListCategoriesQuery,
    UpdateCategoryInput,
} from '../../src/modules/categories/category.schema.js';
import type {
    CategoryMutationResult,
    CategoryRecord,
} from '../../src/modules/categories/category.types.js';

export class FakeCategoryRepository implements CategoryRepository {
    public records = new Map<string, CategoryRecord>();

    async list(
        userId: string,
        query: ListCategoriesQuery,
    ): Promise<{ items: CategoryRecord[]; total: number }> {
        let items = Array.from(this.records.values()).filter(
            (r) => r.userId === userId && r.deletedAt === null,
        );

        if (query.type) {
            items = items.filter((r) => r.type === query.type);
        }
        if (query.name) {
            const q = query.name.toLowerCase();
            items = items.filter((r) => r.name.toLowerCase().includes(q));
        }

        const total = items.length;
        const offset = (query.page - 1) * query.limit;
        return { items: items.slice(offset, offset + query.limit), total };
    }

    async create(userId: string, id: string, input: CreateCategoryInput): Promise<CategoryRecord> {
        const now = new Date();
        const record: CategoryRecord = {
            id,
            userId,
            name: input.name,
            type: input.type,
            version: 1n,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
        };
        this.records.set(id, record);
        return { ...record };
    }

    async update(
        userId: string,
        id: string,
        input: UpdateCategoryInput,
    ): Promise<CategoryMutationResult> {
        const existing = this.records.get(id);
        if (existing?.userId !== userId || existing?.deletedAt !== null) {
            return { status: 'missing' };
        }
        if (existing.version !== BigInt(input.version)) {
            return { status: 'version_conflict', record: { ...existing } };
        }

        const updated: CategoryRecord = {
            ...existing,
            name: input.name ?? existing.name,
            type: input.type ?? existing.type,
            version: existing.version + 1n,
            updatedAt: new Date(),
        };
        this.records.set(id, updated);
        return { status: 'applied', record: { ...updated } };
    }

    async softDelete(userId: string, id: string, version: bigint): Promise<CategoryMutationResult> {
        const existing = this.records.get(id);
        if (existing?.userId !== userId || existing?.deletedAt !== null) {
            return { status: 'missing' };
        }
        if (existing.version !== version) {
            return { status: 'version_conflict', record: { ...existing } };
        }

        const updated: CategoryRecord = {
            ...existing,
            version: existing.version + 1n,
            deletedAt: new Date(),
            updatedAt: new Date(),
        };
        this.records.set(id, updated);
        return { status: 'applied', record: { ...updated } };
    }
}
