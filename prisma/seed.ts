import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to run the seed.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const roles = [
  { id: '0199a1b0-0000-7000-8000-000000000001', code: 'SA', name: 'Super Admin' },
  { id: '0199a1b0-0000-7000-8000-000000000002', code: 'ADM', name: 'Administrator' },
  { id: '0199a1b0-0000-7000-8000-000000000003', code: 'USR', name: 'User' },
] as const;

const permissions = [
  {
    id: '0199a1b1-0000-7000-8000-000000000001',
    name: 'user.index',
    method: 'GET',
    module: 'Users',
    description: 'List, export, or view users',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000002',
    name: 'user.create',
    method: 'GET',
    module: 'Users',
    description: 'Download the user import template',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000003',
    name: 'user.store',
    method: 'POST',
    module: 'Users',
    description: 'Create or import users',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000004',
    name: 'user.edit',
    method: 'GET',
    module: 'Users',
    description: 'Access user editing capabilities',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000005',
    name: 'user.update',
    method: 'PATCH',
    module: 'Users',
    description: 'Update a user',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000006',
    name: 'user.destroy',
    method: 'DELETE',
    module: 'Users',
    description: 'Delete a user',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000007',
    name: 'file.index',
    method: 'GET',
    module: 'Files',
    description: 'List file metadata',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000008',
    name: 'file.store',
    method: 'POST',
    module: 'Files',
    description: 'Upload a file',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000009',
    name: 'file.show',
    method: 'GET',
    module: 'Files',
    description: 'View file metadata',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000010',
    name: 'file.download',
    method: 'GET',
    module: 'Files',
    description: 'Download a file',
  },
  {
    id: '0199a1b1-0000-7000-8000-000000000011',
    name: 'file.destroy',
    method: 'DELETE',
    module: 'Files',
    description: 'Delete a file',
  },
] as const;

async function main(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    for (const role of roles) {
      await transaction.role.upsert({
        where: { code: role.code },
        create: role,
        update: { name: role.name, deletedAt: null, deletedBy: null },
      });
    }

    const seededRoutes = [];
    for (const permission of permissions) {
      seededRoutes.push(
        await transaction.authorizationRoute.upsert({
          where: { name: permission.name },
          create: permission,
          update: {
            method: permission.method,
            module: permission.module,
            description: permission.description,
            deletedAt: null,
            deletedBy: null,
          },
        }),
      );
    }

    const superAdmin = await transaction.role.findUniqueOrThrow({ where: { code: 'SA' } });
    for (const route of seededRoutes) {
      await transaction.rolePermission.upsert({
        where: { roleId_routeId: { roleId: superAdmin.id, routeId: route.id } },
        create: { roleId: superAdmin.id, routeId: route.id },
        update: {},
      });
    }
  });
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
