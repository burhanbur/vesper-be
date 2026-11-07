import { activeGroup, activeMember, lockOwner } from '../../common/authorization/account-access.js';
import { AppError } from '../../common/errors/app-error.js';
import { generateId } from '../../common/utils/id.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { CreatePocketInput, PocketDto, UpdatePocketInput } from './pocket.schema.js';

export interface PocketRepository {
    read(actor: string, groupId: string): Promise<PocketDto[]>;
    create(actor: string, groupId: string, input: CreatePocketInput): Promise<PocketDto>;
    update(actor: string, groupId: string, pocketId: string, input: UpdatePocketInput): Promise<PocketDto>;
    delete(actor: string, groupId: string, pocketId: string): Promise<void>;
    assign(actor: string, groupId: string, pocketId: string, accountId: string, remove: boolean): Promise<void>;
}
function deny(): never {
    throw new AppError({ statusCode: 403, code: 'GROUP_ACCESS_DENIED', message: 'Permintaan grup tidak diizinkan.' });
}
async function authorize(tx: Prisma.TransactionClient, actor: string, groupId: string) {
    if (!await tx.userGroup.findFirst({ where: { groupId, ...activeMember(actor), group: activeGroup } })) deny();
}
async function lockGroup(tx: Prisma.TransactionClient, groupId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'group:' + groupId}::text, 0))::text`;
    await tx.$queryRaw`SELECT id FROM groups WHERE id = ${groupId}::uuid FOR UPDATE`;
}
export function pocketBalances(accounts: PocketDto['accounts']): PocketDto['balances'] {
    const totals = new Map<string, Prisma.Decimal>();
    for (const account of accounts) {
        totals.set(account.currency, (totals.get(account.currency) ?? new Prisma.Decimal(0)).plus(account.balance));
    }
    return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, balance]) => ({ currency, balance: balance.toFixed(2) }));
}
export class PrismaPocketRepository implements PocketRepository {
    constructor(private readonly client: PrismaClient) { }
    read(actor: string, groupId: string) {
        return this.client.$transaction(async (tx) => {
            await authorize(tx, actor, groupId);
            const pockets = await tx.groupPocket.findMany({
                where: { groupId }, select: { id: true, name: true, description: true },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            });
            // Same snapshot and same eligibility for detail and totals. Consent is still group_accounts.
            const rows = await tx.$queryRaw<(PocketDto['accounts'][number] & { pocket_id: string })[]>(Prisma.sql`
        SELECT pa.pocket_id, a.id AS account_id,
          CASE WHEN p.id IS NULL THEN a.name ELSE p.name || ' - ' || a.name END AS name,
          a.user_id AS owner_user_id, u.name AS owner_name, a.currency, a.balance::text AS balance
        FROM group_pocket_accounts pa
        JOIN accounts a ON a.id = pa.account_id AND a.deleted_at IS NULL
        JOIN account_types at ON at.id = a.account_type_id AND at.user_id = a.user_id AND at.deleted_at IS NULL
        JOIN users u ON u.id = a.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        JOIN user_groups ug ON ug.user_id = a.user_id AND ug.group_id = pa.group_id
        JOIN group_accounts ga ON ga.account_id = a.id AND ga.group_id = pa.group_id
        LEFT JOIN accounts p ON p.id = a.parent_account_id
        WHERE pa.group_id = ${groupId}::uuid AND NOT a.is_credit_card
          AND (a.parent_account_id IS NULL OR (p.deleted_at IS NULL AND p.user_id = a.user_id
            AND EXISTS (SELECT 1 FROM account_types pt WHERE pt.id = p.account_type_id AND pt.user_id = a.user_id AND pt.deleted_at IS NULL)))
          AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_account_id = a.id AND child.deleted_at IS NULL)
        ORDER BY pa.created_at, pa.id`);
            return pockets.map((pocket) => {
                const accounts = rows.filter((row) => row.pocket_id === pocket.id).map(({ pocket_id: _pocketId, ...account }) => account);
                return { ...pocket, accounts, balances: pocketBalances(accounts) };
            });
        }, { isolationLevel: 'RepeatableRead' });
    }
    create(actor: string, groupId: string, input: CreatePocketInput) {
        return this.client.$transaction(async (tx) => {
            await lockGroup(tx, groupId);
            await authorize(tx, actor, groupId);
            const pocket = await tx.groupPocket.create({
                data: { id: generateId(), groupId, name: input.name, description: input.description ?? null, createdBy: actor, updatedBy: actor },
                select: { id: true, name: true, description: true },
            });
            return { ...pocket, accounts: [], balances: [] };
        }, { isolationLevel: 'ReadCommitted' });
    }
    update(actor: string, groupId: string, pocketId: string, input: UpdatePocketInput) {
        return this.client.$transaction(async (tx) => {
            await lockGroup(tx, groupId);
            await authorize(tx, actor, groupId);
            const existing = await tx.groupPocket.findFirst({
                where: { id: pocketId, groupId },
                select: { id: true },
            });
            if (!existing) {
                throw new AppError({ statusCode: 404, code: 'GROUP_POCKET_NOT_FOUND', message: 'Kantong grup tidak ditemukan.' });
            }
            const updated = await tx.groupPocket.update({
                where: { id: pocketId },
                data: {
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.description !== undefined ? { description: input.description } : {}),
                    updatedBy: actor,
                },
                select: { id: true, name: true, description: true },
            });
            const rows = await tx.$queryRaw<(PocketDto['accounts'][number])[]>(Prisma.sql`
        SELECT a.id AS account_id,
          CASE WHEN p.id IS NULL THEN a.name ELSE p.name || ' - ' || a.name END AS name,
          a.user_id AS owner_user_id, u.name AS owner_name, a.currency, a.balance::text AS balance
        FROM group_pocket_accounts pa
        JOIN accounts a ON a.id = pa.account_id AND a.deleted_at IS NULL
        JOIN account_types at ON at.id = a.account_type_id AND at.user_id = a.user_id AND at.deleted_at IS NULL
        JOIN users u ON u.id = a.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        JOIN user_groups ug ON ug.user_id = a.user_id AND ug.group_id = pa.group_id
        JOIN group_accounts ga ON ga.account_id = a.id AND ga.group_id = pa.group_id
        LEFT JOIN accounts p ON p.id = a.parent_account_id
        WHERE pa.group_id = ${groupId}::uuid AND pa.pocket_id = ${pocketId}::uuid AND NOT a.is_credit_card
          AND (a.parent_account_id IS NULL OR (p.deleted_at IS NULL AND p.user_id = a.user_id
            AND EXISTS (SELECT 1 FROM account_types pt WHERE pt.id = p.account_type_id AND pt.user_id = a.user_id AND pt.deleted_at IS NULL)))
          AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_account_id = a.id AND child.deleted_at IS NULL)
        ORDER BY pa.created_at, pa.id`);
            return { ...updated, accounts: rows, balances: pocketBalances(rows) };
        }, { isolationLevel: 'ReadCommitted' });
    }
    delete(actor: string, groupId: string, pocketId: string) {
        return this.client.$transaction(async (tx) => {
            await lockGroup(tx, groupId);
            await authorize(tx, actor, groupId);
            const existing = await tx.groupPocket.findFirst({
                where: { id: pocketId, groupId },
                select: { id: true },
            });
            if (!existing) {
                throw new AppError({ statusCode: 404, code: 'GROUP_POCKET_NOT_FOUND', message: 'Kantong grup tidak ditemukan.' });
            }
            await tx.groupPocketAccount.deleteMany({ where: { groupId, pocketId } });
            await tx.groupPocket.delete({ where: { id: pocketId } });
        }, { isolationLevel: 'ReadCommitted' });
    }
    assign(actor: string, groupId: string, pocketId: string, accountId: string, remove: boolean) {
        return this.client.$transaction(async (tx) => {
            // Coordinate with account hierarchy, membership, sharing and ledger writers.
            await lockOwner(tx, actor);
            await lockGroup(tx, groupId);
            await authorize(tx, actor, groupId);
            if (!await tx.groupPocket.findFirst({ where: { id: pocketId, groupId } })) {
                throw new AppError({ statusCode: 404, code: 'GROUP_POCKET_NOT_FOUND', message: 'Kantong grup tidak ditemukan.' });
            }
            const account = await tx.account.findFirst({
                where: { id: accountId, userId: actor }, select: { id: true },
            });
            if (!account) deny();
            // Unlink must remain possible after an account becomes non-leaf or is tombstoned.
            if (remove) {
                await tx.groupPocketAccount.deleteMany({ where: { groupId, pocketId, accountId } });
                return;
            }
            const eligible = await tx.account.findFirst({
                where: {
                    id: accountId, userId: actor, deletedAt: null, isCreditCard: false,
                    accountType: { userId: actor, deletedAt: null },
                    children: { none: { deletedAt: null } },
                    OR: [{ parentAccountId: null }, { parent: { userId: actor, deletedAt: null, accountType: { userId: actor, deletedAt: null } } }],
                }, select: { id: true },
            });
            if (!eligible) {
                throw new AppError({ statusCode: 422, code: 'GROUP_POCKET_ACCOUNT_INVALID', message: 'Akun harus berupa akun milik sendiri yang aktif tanpa anak.' });
            }
            const current = await tx.groupPocketAccount.findUnique({ where: { groupId_accountId: { groupId, accountId } } });
            if (current && current.pocketId !== pocketId) {
                throw new AppError({ statusCode: 409, code: 'GROUP_POCKET_ACCOUNT_CONFLICT', message: 'Akun sudah ditautkan ke kantong lain dalam grup.' });
            }
            await tx.groupAccount.upsert({
                where: { groupId_accountId: { groupId, accountId } },
                create: { id: generateId(), groupId, accountId }, update: {},
            });
            if (!current) await tx.groupPocketAccount.create({ data: { id: generateId(), groupId, pocketId, accountId, createdBy: actor } });
        }, { isolationLevel: 'ReadCommitted' });
    }
}
