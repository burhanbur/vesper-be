import { AppError } from '../../src/common/errors/app-error.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { AccountRepository } from '../../src/modules/accounts/account.repository.js';
import type {
    CreateAccountInput,
    ListAccountsQuery,
    UpdateAccountInput,
} from '../../src/modules/accounts/account.schema.js';
import { toAccountDto, type AccountRecord } from '../../src/modules/accounts/account.types.js';

export class FakeAccountRepository implements AccountRepository {
    public accounts: AccountRecord[] = [];
    public activeAccountTypeIds = new Set<string>();

    async list(
        userId: string,
        query: ListAccountsQuery,
    ): Promise<{ items: AccountRecord[]; total: number }> {
        let filtered = this.accounts.filter((a) => a.userId === userId && a.deletedAt === null);

        if (query.account_type_id !== undefined) {
            filtered = filtered.filter((a) => a.accountTypeId === query.account_type_id);
        }
        if (query.parent_account_id !== undefined) {
            const parentId = query.parent_account_id === 'null' ? null : query.parent_account_id;
            filtered = filtered.filter((a) => a.parentAccountId === parentId);
        }
        if (query.is_visible !== undefined) {
            filtered = filtered.filter((a) => a.isVisible === (query.is_visible === 'true'));
        }

        const total = filtered.length;
        const skip = (query.page - 1) * query.limit;
        const items = filtered.slice(skip, skip + query.limit);

        return { items, total };
    }

    async create(userId: string, id: string, input: CreateAccountInput): Promise<AccountRecord> {
        if (
            this.activeAccountTypeIds.size > 0 &&
            !this.activeAccountTypeIds.has(input.account_type_id)
        ) {
            throw new AppError({
                statusCode: 422,
                code: 'ACCOUNT_TYPE_INVALID',
                message: 'Tipe akun aktif milik Anda tidak ditemukan.',
            });
        }

        if (input.parent_account_id) {
            const parent = this.accounts.find(
                (a) => a.id === input.parent_account_id && a.userId === userId && a.deletedAt === null,
            );
            if (parent?.accountTypeId !== input.account_type_id) {
                throw new AppError({
                    statusCode: 422,
                    code: 'ACCOUNT_PARENT_INVALID',
                    message: 'Parent harus akun aktif milik Anda dengan tipe yang sama.',
                });
            }
        }

        const now = new Date();
        const record: AccountRecord = {
            id,
            userId,
            accountTypeId: input.account_type_id,
            parentAccountId: input.parent_account_id,
            name: input.name,
            icon: input.icon ?? null,
            description: input.description ?? null,
            currency: input.currency ?? 'IDR',
            isVisible: input.is_visible ?? true,
            isIncludeTotal: input.is_include_total ?? true,
            sequenceOrder: BigInt(input.sequence_order ?? '0'),
            balance: new Prisma.Decimal('0.00'),
            version: 1n,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
        };

        this.accounts.push(record);
        return record;
    }

    async update(userId: string, id: string, input: UpdateAccountInput): Promise<AccountRecord> {
        const record = this.accounts.find(
            (a) => a.id === id && a.userId === userId && a.deletedAt === null,
        );
        if (!record) {
            throw new AppError({
                statusCode: 404,
                code: 'ACCOUNT_NOT_FOUND',
                message: 'Akun tidak ditemukan.',
            });
        }

        if (record.version !== BigInt(input.version)) {
            throw new AppError({
                statusCode: 409,
                code: 'ACCOUNT_VERSION_CONFLICT',
                message: 'Versi akun tidak sesuai atau telah mencapai batas maksimum.',
                errors: { server_data: toAccountDto(record) },
            });
        }

        if (
            input.account_type_id &&
            this.activeAccountTypeIds.size > 0 &&
            !this.activeAccountTypeIds.has(input.account_type_id)
        ) {
            throw new AppError({
                statusCode: 422,
                code: 'ACCOUNT_TYPE_INVALID',
                message: 'Tipe akun aktif milik Anda tidak ditemukan.',
            });
        }

        const targetTypeId = input.account_type_id ?? record.accountTypeId;
        const targetParentId =
            input.parent_account_id === undefined ? record.parentAccountId : input.parent_account_id;

        if (targetParentId) {
            if (targetParentId === id) {
                throw new AppError({
                    statusCode: 409,
                    code: 'ACCOUNT_HIERARCHY_CYCLE',
                    message: 'Hierarki akun tidak boleh membentuk siklus.',
                });
            }
            const parent = this.accounts.find(
                (a) => a.id === targetParentId && a.userId === userId && a.deletedAt === null,
            );
            if (parent?.accountTypeId !== targetTypeId) {
                throw new AppError({
                    statusCode: 422,
                    code: 'ACCOUNT_PARENT_INVALID',
                    message: 'Parent harus akun aktif milik Anda dengan tipe yang sama.',
                });
            }
        }

        if (input.name !== undefined) record.name = input.name;
        if (input.icon !== undefined) record.icon = input.icon;
        if (input.description !== undefined) record.description = input.description;
        if (input.is_visible !== undefined) record.isVisible = input.is_visible;
        if (input.is_include_total !== undefined) record.isIncludeTotal = input.is_include_total;
        if (input.sequence_order !== undefined) record.sequenceOrder = BigInt(input.sequence_order);
        if (input.account_type_id !== undefined) record.accountTypeId = input.account_type_id;
        if (input.parent_account_id !== undefined) record.parentAccountId = input.parent_account_id;

        record.version += 1n;
        record.updatedAt = new Date();

        return record;
    }

    async softDelete(userId: string, id: string, version: bigint): Promise<void> {
        const record = this.accounts.find(
            (a) => a.id === id && a.userId === userId && a.deletedAt === null,
        );
        if (!record) {
            throw new AppError({
                statusCode: 404,
                code: 'ACCOUNT_NOT_FOUND',
                message: 'Akun tidak ditemukan.',
            });
        }

        if (record.version !== version) {
            throw new AppError({
                statusCode: 409,
                code: 'ACCOUNT_VERSION_CONFLICT',
                message: 'Versi akun tidak sesuai atau telah mencapai batas maksimum.',
                errors: { server_data: toAccountDto(record) },
            });
        }

        const hasChildren = this.accounts.some(
            (a) => a.parentAccountId === id && a.userId === userId && a.deletedAt === null,
        );
        if (hasChildren) {
            throw new AppError({
                statusCode: 409,
                code: 'ACCOUNT_HAS_CHILDREN',
                message: 'Akun dengan child aktif tidak dapat dihapus.',
                errors: { server_data: toAccountDto(record) },
            });
        }

        if (!record.balance.isZero()) {
            throw new AppError({
                statusCode: 409,
                code: 'ACCOUNT_NONZERO_BALANCE',
                message: 'Akun dengan saldo tidak nol tidak dapat dihapus.',
                errors: { server_data: toAccountDto(record) },
            });
        }

        record.deletedAt = new Date();
        record.version += 1n;
        record.updatedAt = new Date();
    }
}
