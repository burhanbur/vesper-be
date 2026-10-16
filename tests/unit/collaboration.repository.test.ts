import { describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { CollaborationRepository } from '../../src/modules/groups/collaboration.repository.js';
import {
  CollaborationQuerySchema,
  MembershipActionSchema,
} from '../../src/modules/groups/collaboration.route.js';

function setup(roles: (string | null)[]) {
  const tx = {
    userGroup: {
      findFirst: vi.fn().mockImplementation(async () => {
        const role = roles.shift();
        return role ? { id: role, role } : null;
      }),
      update: vi.fn<(args: Prisma.UserGroupUpdateArgs) => Promise<unknown>>(),
      delete: vi.fn(),
    },
    groupAccount: { deleteMany: vi.fn() },
    mappingGroupCategory: { deleteMany: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const client = {
    $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaClient;
  return { tx, repository: new CollaborationRepository(client) };
}
describe('collaboration privacy and membership', () => {
  it('rejects nonmembers before financial reads', async () => {
    const { repository, tx } = setup([null]);
    await expect(repository.read('actor', 'group', '2026-10', 1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([
    ['MEMBER', 'MEMBER', 'other'],
    ['OWNER', 'OWNER', 'other'],
    ['OWNER', 'OWNER', 'actor'],
  ])('denies unauthorized removal %s/%s', async (role, targetRole, target) => {
    const { repository, tx } = setup([role, targetRole]);
    await expect(repository.manage('actor', 'group', target, 'REMOVE')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(tx.userGroup.delete).not.toHaveBeenCalled();
  });
  it('allows self leave and removes opt-ins only', async () => {
    const { repository, tx } = setup(['MEMBER', 'MEMBER']);
    await repository.manage('actor', 'group', 'actor', 'REMOVE');
    expect(tx.groupAccount.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 'group', account: { userId: 'actor' } },
    });
    expect(tx.mappingGroupCategory.deleteMany).toHaveBeenCalledOnce();
    expect(tx.userGroup.delete).toHaveBeenCalledOnce();
  });
  it('transfers ownership atomically without deleting opt-ins', async () => {
    const { repository, tx } = setup(['OWNER', 'MEMBER']);
    await repository.manage('actor', 'group', 'other', 'TRANSFER_OWNER');
    expect(tx.userGroup.update.mock.calls.map((call) => call[0])).toEqual([
      { where: { id: 'MEMBER' }, data: { role: 'OWNER' } },
      { where: { id: 'OWNER' }, data: { role: 'MEMBER' } },
    ]);
    expect(tx.groupAccount.deleteMany).not.toHaveBeenCalled();
  });
  it('bounds pages and rejects privilege injection', () => {
    expect(CollaborationQuerySchema.safeParse({ period: '2026-13' }).success).toBe(false);
    expect(CollaborationQuerySchema.safeParse({ period: '2026-10', limit: 101 }).success).toBe(
      false,
    );
    expect(
      MembershipActionSchema.safeParse({
        user_id: '019a0000-0000-7000-8000-000000000001',
        action: 'ADMIN',
      }).success,
    ).toBe(false);
  });
  it('preserves decimal text and applies privacy eligibility SQL', async () => {
    const { repository, tx } = setup(['MEMBER']);
    tx.$queryRaw.mockResolvedValueOnce([{ currency: 'IDR', balance: '9007199254740993.01' }]);
    const data = await repository.read('actor', 'group', '2026-10', 1, 20);
    expect(data.balances[0]?.balance).toBe('9007199254740993.01');
    const queries = tx.$queryRaw.mock.calls.map((call) =>
      String((call as unknown as [{ sql: string }])[0].sql),
    );
    expect(queries[0]).toContain("at.category = 'CASH'");
    expect(queries[1]).toContain('gc.group_id = ug.group_id');
    expect(queries[2]).toContain('t.transfer_id IS NULL');
    expect(queries[2]).toContain('investment_transactions');
    expect(queries[2]).not.toContain('description');
  });
});
