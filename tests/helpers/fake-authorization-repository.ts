import type { AuthorizationRepository } from '../../src/modules/authorization/authorization.repository.js';

export class FakeAuthorizationRepository implements AuthorizationRepository {
  private readonly userRoles = new Map<string, Set<string>>();
  private readonly rolePermissions = new Map<string, Set<string>>();
  private readonly deletedRoles = new Set<string>();
  private readonly deletedPermissions = new Set<string>();

  grant(userId: string, ...permissionNames: string[]): void {
    const roleCode = `direct:${userId}`;
    this.assignRole(userId, roleCode);
    this.grantRole(roleCode, ...permissionNames);
  }

  revoke(userId: string, permissionName: string): void {
    this.revokeRole(`direct:${userId}`, permissionName);
  }

  assignRole(userId: string, ...roleCodes: string[]): void {
    const roles = this.userRoles.get(userId) ?? new Set<string>();
    for (const roleCode of roleCodes) roles.add(roleCode);
    this.userRoles.set(userId, roles);
  }

  grantRole(roleCode: string, ...permissionNames: string[]): void {
    const permissions = this.rolePermissions.get(roleCode) ?? new Set<string>();
    for (const permissionName of permissionNames) permissions.add(permissionName);
    this.rolePermissions.set(roleCode, permissions);
  }

  revokeRole(roleCode: string, permissionName: string): void {
    this.rolePermissions.get(roleCode)?.delete(permissionName);
  }

  setRoleDeleted(roleCode: string, isDeleted: boolean): void {
    if (isDeleted) {
      this.deletedRoles.add(roleCode);
      return;
    }
    this.deletedRoles.delete(roleCode);
  }

  setPermissionDeleted(permissionName: string, isDeleted: boolean): void {
    if (isDeleted) {
      this.deletedPermissions.add(permissionName);
      return;
    }
    this.deletedPermissions.delete(permissionName);
  }

  async hasPermission(userId: string, permissionName: string): Promise<boolean> {
    if (this.deletedPermissions.has(permissionName)) return false;

    for (const roleCode of this.userRoles.get(userId) ?? []) {
      if (
        !this.deletedRoles.has(roleCode) &&
        this.rolePermissions.get(roleCode)?.has(permissionName)
      ) {
        return true;
      }
    }

    return false;
  }
}
