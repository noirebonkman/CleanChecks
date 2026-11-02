import { resolvePermissions, type PermissionKey, type PermissionOverrides } from '../../src/access-control';
import type { Account } from './bindings';
import { ApiError } from './validation';
export const permissionColumns = 'p.view_all_records,p.write_own_records,p.manage_sites,p.manage_users,p.revision AS permission_revision';
export const accountSelection = 'SELECT a.*,' + permissionColumns + ' FROM accounts a LEFT JOIN account_permissions p ON p.account_id=a.id';
export function overridesFor(account: Account): PermissionOverrides {
    const decode = (value: number | null | undefined) => value === 1 ? true : value === 0 ? false : null;
    return { viewAllRecords: decode(account.view_all_records), writeOwnRecords: decode(account.write_own_records),
        manageSites: decode(account.manage_sites), manageUsers: decode(account.manage_users) };
}
export function permissionsFor(account: Account) { return resolvePermissions(account.role, overridesFor(account)); }
export function requirePermission(account: Account, key: PermissionKey): void {
    if (!permissionsFor(account)[key]) throw new ApiError(403, '이 작업에 대한 권한이 없습니다. 어드민에게 문의해 주세요.');
}
