export const permissionKeys = ['viewAllRecords', 'writeOwnRecords', 'manageSites', 'manageUsers'] as const;
export type PermissionKey = typeof permissionKeys[number];
export type EffectivePermissions = Record<PermissionKey, boolean>;
export type PermissionOverrides = Record<PermissionKey, boolean | null>;
export type AccountRole = 'owner' | 'admin' | 'inspector';
export const permissionLabels: Record<PermissionKey, string> = {
    viewAllRecords: '모든 점검자 기록 조회',
    writeOwnRecords: '본인 점검 작성·수정·삭제',
    manageSites: '현장 등록·수정·사용 중지',
    manageUsers: '일반 사용자 계정 추가·조회',
};
export function resolvePermissions(role: AccountRole, overrides: Partial<PermissionOverrides> = {}): EffectivePermissions {
    return Object.fromEntries(permissionKeys.map(key => [key, role === 'owner' ? key !== 'writeOwnRecords' : (
        typeof overrides[key] === 'boolean' ? overrides[key] : key === 'writeOwnRecords' || role === 'admin'
    )])) as EffectivePermissions;
}
type AccountAccess = { role: AccountRole; permissions?: EffectivePermissions };

export function hasPermission(user: AccountAccess | null | undefined, key: PermissionKey): boolean {
    if (!user) return false;
    if (user.role === 'owner') return key !== 'writeOwnRecords';
    return user.permissions ? user.permissions[key] === true : resolvePermissions(user.role)[key];
}

export function canManageCalendar(user: AccountAccess): boolean {
    return user.role !== 'inspector' && hasPermission(user, 'manageSites');
}
