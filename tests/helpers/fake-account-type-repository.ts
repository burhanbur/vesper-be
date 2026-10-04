import type { AccountTypeRepository } from '../../src/modules/account-types/account-type.repository.js';
import type {
    CreateAccountTypeInput,
    ListAccountTypesQuery,
    UpdateAccountTypeInput,
} from '../../src/modules/account-types/account-type.schema.js';
import type {
    AccountTypeMutationResult,
    AccountTypeRecord,
} from '../../src/modules/account-types/account-type.types.js';

export class FakeAccountTypeRepository implements AccountTypeRepository {
    public records = new Map<string, AccountTypeRecord>();
    public referencedIds = new Set<string>();

    async list(
        userId: string,
        query: ListAccountTypesQuery,
    ): Promise<{ items: AccountTypeRecord[]; total: number }> {
        let items = Array.from(this.records.values()).filter(
            (r) => r.userId === userId && r.deletedAt === null,
        );

        if (query.category) {
            items = items.filter((r) => r.category === query.category);
        }
        if (query.name) {
            const q = query.name.toLowerCase();
            items = items.filter((r) => r.name.toLowerCase().includes(q));
        }

        const total = items.length;
        const offset = (query.page - 1) * query.limit;
        return { items: items.slice(offset, offset + query.limit), total };
    }

    async create(
        userId: string,
        id: string,
        input: CreateAccountTypeInput,
    ): Promise<AccountTypeRecord> {
        const now = new Date();
        const record: AccountTypeRecord = {
            id,
            userId,
            name: input.name,
            category: input.category,
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
        input: UpdateAccountTypeInput,
    ): Promise<AccountTypeMutationResult> {
        const existing = this.records.get(id);
        if (existing?.userId !== userId || existing?.deletedAt !== null) {
            return { status: 'missing' };
        }
        const versionBigInt = BigInt(input.version);
        if (existing.version !== versionBigInt) {
            return { status: 'version_conflict', record: { ...existing } };
        }
        if (
            input.category &&
            input.category !== existing.category &&
            this.referencedIds.has(existing.id)
        ) {
            return { status: 'category_in_use', record: { ...existing } };
        }

        const updated: AccountTypeRecord = {
            ...existing,
            name: input.name ?? existing.name,
            category: input.category ?? existing.category,
            version: existing.version + 1n,
            updatedAt: new Date(),
        };
        this.records.set(id, updated);
        return { status: 'applied', record: { ...updated } };
    }

    async softDelete(
        userId: string,
        id: string,
        version: bigint,
    ): Promise<AccountTypeMutationResult> {
        const existing = this.records.get(id);
        if (existing?.userId !== userId || existing?.deletedAt !== null) {
            return { status: 'missing' };
        }
        if (existing.version !== version) {
            return { status: 'version_conflict', record: { ...existing } };
        }
        if (this.referencedIds.has(existing.id)) {
            return { status: 'category_in_use', record: { ...existing } };
        }

        const updated: AccountTypeRecord = {
            ...existing,
            version: existing.version + 1n,
            deletedAt: new Date(),
            updatedAt: new Date(),
        };
        this.records.set(id, updated);
        return { status: 'applied', record: { ...updated } };
    }
}
