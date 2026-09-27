import type { PrismaClient } from '../../generated/prisma/client.js';

export interface AuthorizationRepository {
  hasPermission(userId: string, permissionName: string): Promise<boolean>;
}

export class PrismaAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly client: PrismaClient) {}

  async hasPermission(userId: string, permissionName: string): Promise<boolean> {
    const rows = await this.client.$queryRaw<{ permitted: boolean }[]>`
            SELECT EXISTS (
                SELECT 1
                FROM user_roles ur
                INNER JOIN roles role ON role.id = ur.role_id
                INNER JOIN role_permissions rp ON rp.role_id = role.id
                INNER JOIN routes route ON route.id = rp.route_id
                WHERE ur.user_id = ${userId}::uuid
                  AND role.deleted_at IS NULL
                  AND route.deleted_at IS NULL
                  AND route.name = ${permissionName}
            ) AS permitted
        `;

    return rows[0]?.permitted === true;
  }
}
