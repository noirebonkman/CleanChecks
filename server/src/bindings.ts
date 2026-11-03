import type { EffectivePermissions, PermissionOverrides } from '../../src/access-control';
export interface Statement {
    bind(...values: unknown[]): Statement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
    run(): Promise<{
        meta: {
            changes: number;
            size_after?: number;
        };
    }>;
}
export interface Database {
    prepare(query: string): Statement;
    batch(statements: Statement[]): Promise<{
        meta: {
            changes: number;
        };
    }[]>;
}
export interface Environment {
    DB: Database;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    ASSETS?: {
        fetch(request: Request): Promise<Response>;
    };
    APP_ORIGIN?: string;
    APP_DATA_KEY: string;
    SETUP_TOKEN: string;
}
export type Account = {
    id: string;
    username: string;
    display_name: string;
    password_hash: string;
    role: 'owner' | 'admin' | 'inspector';
    active: number;
    must_change_password: number;
    temporary_expires_at: number | null;
    session_expires_at?: number;
    view_all_records?: number | null;
    write_own_records?: number | null;
    manage_sites?: number | null;
    manage_users?: number | null;
    permission_revision?: number;
};
export type PublicAccount = {
    id: string;
    username: string;
    name: string;
    role: 'owner' | 'admin' | 'inspector';
    active: boolean;
    mustChangePassword?: boolean;
    permissions: EffectivePermissions;
    permissionOverrides: PermissionOverrides;
    permissionRevision: number;
};
