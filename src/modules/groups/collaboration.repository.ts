import { AppError } from '../../common/errors/app-error.js';
import { activeGroup, activeMember, lockOwner } from '../../common/authorization/account-access.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export class CollaborationRepository {
    constructor(private readonly client: PrismaClient) { }

    private async authorize(tx: Prisma.TransactionClient, actor: string, groupId: string) {
        const member = await tx.userGroup.findFirst({ where: { groupId, ...activeMember(actor), group: activeGroup } });
        if (!member) throw new AppError({ statusCode: 403, code: 'GROUP_ACCESS_DENIED', message: 'Permintaan grup tidak diizinkan.' });
        return member;
    }

    read(actor: string, groupId: string, period: string, page: number, limit: number) {
        return this.client.$transaction(async (tx) => {
            await this.authorize(tx, actor, groupId);
            const start = new Date(`${period}-01T00:00:00.000Z`);
            const end = new Date(start);
            end.setUTCMonth(end.getUTCMonth() + 1);
            // One eligibility predicate for totals and feed. No private labels, notes or account IDs.
            const eligible = Prisma.sql`
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
        JOIN account_types at ON at.id = a.account_type_id AND at.user_id = a.user_id AND at.deleted_at IS NULL
        JOIN users u ON u.id = a.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        JOIN user_groups ug ON ug.user_id = u.id AND ug.group_id = ${groupId}::uuid
        JOIN group_accounts ga ON ga.account_id = a.id AND ga.group_id = ug.group_id
        JOIN categories c ON c.id = t.category_id AND c.user_id = u.id AND c.deleted_at IS NULL
        JOIN mapping_group_categories m ON m.user_category_id = c.id AND m.group_id = ug.group_id
        JOIN group_categories gc ON gc.id = m.group_category_id AND gc.group_id = ug.group_id AND gc.type = c.type
        WHERE t.deleted_at IS NULL AND t.transfer_id IS NULL AND t.type::text = gc.type::text
          AND t.transacted_at >= ${start} AND t.transacted_at < ${end}
          AND NOT EXISTS (SELECT 1 FROM investment_transactions it WHERE it.linked_transaction_id = t.id)`;
            const balances = await tx.$queryRaw<{ currency: string; balance: string }[]>(Prisma.sql`
        SELECT a.currency, SUM(a.balance)::text AS balance FROM accounts a
        JOIN account_types at ON at.id = a.account_type_id AND at.user_id = a.user_id AND at.deleted_at IS NULL AND at.category = 'CASH'
        JOIN group_accounts ga ON ga.account_id = a.id AND ga.group_id = ${groupId}::uuid
        JOIN user_groups ug ON ug.group_id = ga.group_id AND ug.user_id = a.user_id
        JOIN users u ON u.id = ug.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        WHERE a.deleted_at IS NULL GROUP BY a.currency ORDER BY a.currency`);
            const contributions = await tx.$queryRaw<{ user_id: string; currency: string; income: string; expense: string }[]>(Prisma.sql`
        SELECT u.id AS user_id, a.currency,
          COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'INCOME'),0)::text AS income,
          COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'EXPENSE'),0)::text AS expense
        ${eligible} GROUP BY u.id, a.currency ORDER BY u.id, a.currency LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
            const feed = await tx.$queryRaw<{ id: string; user_id: string; currency: string; amount: string; type: string; category: string; transacted_at: Date }[]>(Prisma.sql`
        SELECT t.id, u.id AS user_id, a.currency, t.amount::text AS amount, t.type::text AS type,
          gc.name AS category, t.transacted_at ${eligible}
        ORDER BY t.transacted_at DESC, t.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
            return { period, page, limit, balances, contributions, feed: feed.map((row) => ({ ...row, transacted_at: row.transacted_at.toISOString() })) };
        }, { isolationLevel: 'RepeatableRead' });
    }

    manage(actor: string, groupId: string, target: string, action: 'REMOVE' | 'TRANSFER_OWNER') {
        return this.client.$transaction(async (tx) => {
            // Same owner-before-group lock order as sharing and ledger writers.
            await lockOwner(tx, target);
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'group:' + groupId}::text, 0))::text`;
            const member = await this.authorize(tx, actor, groupId);
            const subject = await this.authorize(tx, target, groupId);
            if (subject.role === 'OWNER' || (actor !== target && member.role !== 'OWNER') || (action === 'TRANSFER_OWNER' && member.role !== 'OWNER')) {
                throw new AppError({ statusCode: 403, code: 'GROUP_ACCESS_DENIED', message: 'Permintaan grup tidak diizinkan.' });
            }
            if (action === 'TRANSFER_OWNER') {
                await tx.userGroup.update({ where: { id: subject.id }, data: { role: 'OWNER' } });
                await tx.userGroup.update({ where: { id: member.id }, data: { role: 'MEMBER' } });
            } else {
                // Membership is a grant table without tombstones. Personal data stays untouched.
                // Remove old opt-ins so rejoining never silently restores historical sharing.
                await tx.groupAccount.deleteMany({ where: { groupId, account: { userId: target } } });
                await tx.mappingGroupCategory.deleteMany({ where: { groupId, userCategory: { userId: target } } });
                await tx.userGroup.delete({ where: { id: subject.id } });
            }
        }, { isolationLevel: 'ReadCommitted' });
    }
}
