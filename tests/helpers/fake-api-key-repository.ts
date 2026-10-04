import type {
    ApiKeyRepository,
    CreateApiKeyData,
    UpdateApiKeyData,
} from '../../src/modules/api-keys/api-key.repository.js';
import type { ListApiKeysQuery } from '../../src/modules/api-keys/api-key.schema.js';
import type { ApiKeyRecord } from '../../src/modules/api-keys/api-key.types.js';

export class FakeApiKeyRepository implements ApiKeyRepository {
    public records = new Map<string, ApiKeyRecord>();

    async findByKey(key: string): Promise<ApiKeyRecord | null> {
        for (const record of this.records.values()) {
            if (record.key === key) return { ...record };
        }
        return null;
    }

    async findById(id: string): Promise<ApiKeyRecord | null> {
        const record = this.records.get(id);
        return record ? { ...record } : null;
    }

    async findMany(query: ListApiKeysQuery): Promise<{ items: ApiKeyRecord[]; total: number }> {
        let items = Array.from(this.records.values());

        if (query.is_active !== undefined) {
            items = items.filter((r) => r.isActive === query.is_active);
        }
        if (query.search) {
            const search = query.search.toLowerCase();
            items = items.filter(
                (r) =>
                    r.name.toLowerCase().includes(search) ||
                    (r.description?.toLowerCase().includes(search) ?? false),
            );
        }

        const total = items.length;
        const offset = (query.page - 1) * query.limit;
        const paginated = items.slice(offset, offset + query.limit);

        return { items: paginated, total };
    }

    async create(data: CreateApiKeyData): Promise<ApiKeyRecord> {
        const now = new Date();
        const record: ApiKeyRecord = {
            id: data.id,
            name: data.name,
            key: data.key,
            description: data.description ?? null,
            application: data.application ?? null,
            ipWhitelist: data.ipWhitelist ?? null,
            permissions: data.permissions ?? null,
            isActive: true,
            rateLimit: data.rateLimit,
            lastUsedAt: null,
            expiresAt: data.expiresAt ?? null,
            createdBy: data.createdBy ?? null,
            createdAt: now,
            updatedBy: null,
            updatedAt: now,
        };
        this.records.set(data.id, record);
        return { ...record };
    }

    async update(id: string, data: UpdateApiKeyData): Promise<ApiKeyRecord | null> {
        const existing = this.records.get(id);
        if (!existing) return null;

        const updated: ApiKeyRecord = {
            ...existing,
            name: data.name ?? existing.name,
            description: data.description !== undefined ? data.description : existing.description,
            application: data.application !== undefined ? data.application : existing.application,
            ipWhitelist: data.ipWhitelist !== undefined ? data.ipWhitelist : existing.ipWhitelist,
            permissions: data.permissions !== undefined ? data.permissions : existing.permissions,
            isActive: data.isActive ?? existing.isActive,
            rateLimit: data.rateLimit ?? existing.rateLimit,
            expiresAt: data.expiresAt !== undefined ? data.expiresAt : existing.expiresAt,
            updatedBy: data.updatedBy !== undefined ? data.updatedBy : existing.updatedBy,
            updatedAt: new Date(),
        };
        this.records.set(id, updated);
        return { ...updated };
    }

    async delete(id: string): Promise<boolean> {
        return this.records.delete(id);
    }

    async touchLastUsed(id: string): Promise<void> {
        const existing = this.records.get(id);
        if (existing) {
            existing.lastUsedAt = new Date();
        }
    }
}
