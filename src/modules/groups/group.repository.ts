import { AppError } from '../../common/errors/app-error.js';
import { activeGroup, activeMember, lockOwner } from '../../common/authorization/account-access.js';
import { generateId } from '../../common/utils/id.js';
import {
  Prisma,
  type PrismaClient,
  type Group,
  type GroupCategory,
  type GroupRole,
} from '../../generated/prisma/client.js';
import type {
  GroupPage,
  GroupCategoryInput,
  GroupCategoryPatch,
  GroupDto,
  GroupCategoryDto,
  GroupMemberDto,
  GroupReportDto,
} from './group.schema.js';

export interface GroupRepository {
  create(userId: string, name: string, code: string): Promise<GroupDto & { code: string }>;
  join(userId: string, id: string, code: string): Promise<GroupDto>;
  list(userId: string, page: GroupPage): Promise<{ items: GroupDto[]; total: number }>;
  members(
    userId: string,
    id: string,
    page: GroupPage,
  ): Promise<{ items: GroupMemberDto[]; total: number }>;
  share(userId: string, id: string, accountId: string, remove: boolean): Promise<void>;
  categories(
    userId: string,
    id: string,
    page: GroupPage,
  ): Promise<{ items: GroupCategoryDto[]; total: number }>;
  createCategory(userId: string, id: string, input: GroupCategoryInput): Promise<GroupCategoryDto>;
  changeCategory(
    userId: string,
    id: string,
    categoryId: string,
    input?: GroupCategoryPatch,
  ): Promise<GroupCategoryDto | null>;
  mapping(
    userId: string,
    id: string,
    categoryId: string,
    personalId: string,
    remove: boolean,
  ): Promise<void>;
  report(userId: string, id: string, period: string): Promise<GroupReportDto>;
}
function deny(): never {
  throw new AppError({
    statusCode: 403,
    code: 'GROUP_ACCESS_DENIED',
    message: 'Permintaan grup tidak diizinkan.',
  });
}
function invalid(): never {
  throw new AppError({
    statusCode: 422,
    code: 'GROUP_RESOURCE_INVALID',
    message: 'Data grup tidak valid.',
  });
}
function conflict(): never {
  throw new AppError({
    statusCode: 409,
    code: 'GROUP_CATEGORY_CONFLICT',
    message: 'Kategori telah dipetakan atau sedang digunakan.',
  });
}
function groupDto(group: Group, role: GroupRole): GroupDto {
  return {
    id: group.id,
    name: group.name,
    is_active: group.isActive,
    role,
    created_at: group.createdAt.toISOString(),
    updated_at: group.updatedAt.toISOString(),
  };
}
function categoryDto(category: GroupCategory): GroupCategoryDto {
  return {
    id: category.id,
    group_id: category.groupId,
    name: category.name,
    type: category.type,
    created_at: category.createdAt.toISOString(),
    updated_at: category.updatedAt.toISOString(),
  };
}
async function requireMember(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  owner = false,
) {
  const member = await tx.userGroup.findFirst({
    where: { groupId: id, ...activeMember(userId), group: activeGroup },
    include: { group: true },
  });
  if (!member || (owner && member.role !== 'OWNER')) deny();
  return member;
}
async function lockGroup(tx: Prisma.TransactionClient, id: string): Promise<void> {
  // All grant writers coordinate with ledger SHARE locks; never acquire an owner after this lock.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'group:' + id}::text, 0))::text`;
  await tx.$queryRaw`SELECT id FROM groups WHERE id = ${id}::uuid FOR UPDATE`;
}
export class PrismaGroupRepository implements GroupRepository {
  constructor(private readonly client: PrismaClient) {}
  create(userId: string, name: string, code: string) {
    return this.client.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: { id: generateId(), name, code, createdBy: userId, updatedBy: userId },
      });
      await tx.userGroup.create({
        data: { id: generateId(), userId, groupId: group.id, role: 'OWNER', createdBy: userId },
      });
      return { ...groupDto(group, 'OWNER'), code: group.code };
    });
  }
  join(userId: string, id: string, code: string) {
    return this.client.$transaction(
      async (tx) => {
        await lockGroup(tx, id);
        const group = await tx.group.findFirst({ where: { id, code, ...activeGroup } });
        if (!group) deny();
        const member = await tx.userGroup.upsert({
          where: { userId_groupId: { userId, groupId: id } },
          create: { id: generateId(), userId, groupId: id, role: 'MEMBER', createdBy: userId },
          update: {},
        });
        return groupDto(group, member.role);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
  list(userId: string, page: GroupPage) {
    return this.client.$transaction(
      async (tx) => {
        const where: Prisma.UserGroupWhereInput = { ...activeMember(userId), group: activeGroup };
        const [rows, total] = await Promise.all([
          tx.userGroup.findMany({
            where,
            include: { group: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page.page - 1) * page.limit,
            take: page.limit,
          }),
          tx.userGroup.count({ where }),
        ]);
        return { items: rows.map((row) => groupDto(row.group, row.role)), total };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  members(userId: string, id: string, page: GroupPage) {
    return this.client.$transaction(
      async (tx) => {
        await requireMember(tx, userId, id);
        const where = { groupId: id, ...activeMember() };
        const [rows, total] = await Promise.all([
          tx.userGroup.findMany({
            where,
            select: {
              userId: true,
              role: true,
              createdAt: true,
              user: {
                select: {
                  name: true,
                  profile: { select: { fullName: true, photo: true, deletedAt: true } },
                },
              },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: (page.page - 1) * page.limit,
            take: page.limit,
          }),
          tx.userGroup.count({ where }),
        ]);
        return {
          total,
          items: rows.map((row) => ({
            user_id: row.userId,
            role: row.role,
            name: row.user.name,
            profile:
              row.user.profile?.deletedAt === null
                ? { full_name: row.user.profile.fullName, photo: row.user.profile.photo }
                : null,
            created_at: row.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  share(userId: string, id: string, accountId: string, remove: boolean) {
    return this.client.$transaction(
      async (tx) => {
        await lockOwner(tx, userId);
        await lockGroup(tx, id);
        await requireMember(tx, userId, id);
        const account = await tx.account.findFirst({
          where: {
            id: accountId,
            userId,
            deletedAt: null,
            accountType: { userId, deletedAt: null },
          },
        });
        if (!account) deny();
        if (remove) await tx.groupAccount.deleteMany({ where: { groupId: id, accountId } });
        else
          await tx.groupAccount.upsert({
            where: { groupId_accountId: { groupId: id, accountId } },
            create: { id: generateId(), groupId: id, accountId },
            update: {},
          });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
  categories(userId: string, id: string, page: GroupPage) {
    return this.client.$transaction(
      async (tx) => {
        await requireMember(tx, userId, id);
        const where = { groupId: id };
        const [rows, total] = await Promise.all([
          tx.groupCategory.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: (page.page - 1) * page.limit,
            take: page.limit,
          }),
          tx.groupCategory.count({ where }),
        ]);
        return { items: rows.map(categoryDto), total };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  createCategory(userId: string, id: string, input: GroupCategoryInput) {
    return this.client.$transaction(async (tx) => {
      await lockGroup(tx, id);
      await requireMember(tx, userId, id, true);
      return categoryDto(
        await tx.groupCategory.create({
          data: { id: generateId(), groupId: id, ...input, createdBy: userId, updatedBy: userId },
        }),
      );
    });
  }
  changeCategory(userId: string, id: string, categoryId: string, input?: GroupCategoryPatch) {
    return this.client.$transaction(async (tx) => {
      await lockGroup(tx, id);
      await requireMember(tx, userId, id, true);
      const current = await tx.groupCategory.findFirst({ where: { id: categoryId, groupId: id } });
      if (!current) invalid();
      if (!input) {
        // ERD has no category tombstone: remove mappings atomically, not personal history.
        await tx.mappingGroupCategory.deleteMany({
          where: { groupId: id, groupCategoryId: categoryId },
        });
        await tx.groupCategory.delete({ where: { id: categoryId } });
        return null;
      }
      if (
        input.type &&
        input.type !== current.type &&
        (await tx.mappingGroupCategory.count({
          where: { groupId: id, groupCategoryId: categoryId },
        }))
      )
        conflict();
      return categoryDto(
        await tx.groupCategory.update({
          where: { id: categoryId },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.type === undefined ? {} : { type: input.type }),
            updatedBy: userId,
          },
        }),
      );
    });
  }
  mapping(userId: string, id: string, categoryId: string, personalId: string, remove: boolean) {
    return this.client.$transaction(
      async (tx) => {
        await lockOwner(tx, userId);
        await lockGroup(tx, id);
        await requireMember(tx, userId, id);
        await tx.$queryRaw`SELECT id FROM categories WHERE id = ${personalId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
        const personal = await tx.category.findFirst({
          where: { id: personalId, userId, deletedAt: null },
        });
        const category = await tx.groupCategory.findFirst({
          where: { id: categoryId, groupId: id },
        });
        if (!personal || personal.type !== category?.type) invalid();
        if (remove) {
          await tx.mappingGroupCategory.deleteMany({
            where: { groupId: id, groupCategoryId: categoryId, userCategoryId: personalId },
          });
          return;
        }
        const current = await tx.mappingGroupCategory.findUnique({
          where: { groupId_userCategoryId: { groupId: id, userCategoryId: personalId } },
        });
        if (current && current.groupCategoryId !== categoryId) conflict();
        if (!current)
          await tx.mappingGroupCategory.create({
            data: {
              id: generateId(),
              groupId: id,
              groupCategoryId: categoryId,
              userCategoryId: personalId,
            },
          });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
  report(userId: string, id: string, period: string) {
    return this.client.$transaction(
      async (tx) => {
        await requireMember(tx, userId, id);
        const start = new Date(`${period}-01T00:00:00.000Z`);
        const end = new Date(start);
        end.setUTCMonth(end.getUTCMonth() + 1);
        // Bound PostgreSQL aggregate avoids unbounded application reads and preserves decimals.
        const rows = await tx.$queryRaw<
          {
            group_category_id: string;
            name: string;
            type: 'INCOME' | 'EXPENSE';
            income: string;
            expense: string;
          }[]
        >`
                SELECT gc.id AS group_category_id, gc.name, gc.type::text AS type,
                    COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'INCOME'), 0)::numeric(30,2)::text AS income,
                    COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'EXPENSE'), 0)::numeric(30,2)::text AS expense
                FROM group_categories gc
                LEFT JOIN mapping_group_categories m ON m.group_id = gc.group_id AND m.group_category_id = gc.id
                LEFT JOIN categories c ON c.id = m.user_category_id AND c.deleted_at IS NULL AND c.type = gc.type
                LEFT JOIN transactions t ON t.category_id = c.id AND t.deleted_at IS NULL
                    AND t.transfer_id IS NULL AND t.type::text = gc.type::text
                    AND t.transacted_at >= ${start} AND t.transacted_at < ${end}
                    AND NOT EXISTS (SELECT 1 FROM investment_transactions it WHERE it.linked_transaction_id = t.id)
                    AND EXISTS (
                        SELECT 1 FROM accounts a
                        JOIN account_types at ON at.id = a.account_type_id AND at.deleted_at IS NULL
                        JOIN group_accounts ga ON ga.account_id = a.id AND ga.group_id = gc.group_id
                        JOIN user_groups ug ON ug.group_id = gc.group_id AND ug.user_id = at.user_id
                        JOIN users u ON u.id = ug.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
                        WHERE a.id = t.account_id AND a.deleted_at IS NULL AND at.user_id = c.user_id AND a.user_id = at.user_id
                    )
                WHERE gc.group_id = ${id}::uuid
                GROUP BY gc.id, gc.name, gc.type ORDER BY gc.name, gc.id`;
        return { period, categories: rows };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}

export function isGroupCodeCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const target: unknown = error.meta?.target;
  return Array.isArray(target) && target.length === 1 && target[0] === 'code';
}
