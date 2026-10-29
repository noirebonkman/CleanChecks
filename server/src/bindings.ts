export interface Statement {
    bind(...values: unknown[]): Statement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
    run(): Promise<{
        meta: {
            changes: number;
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
};
export type PublicAccount = {
    id: string;
    username: string;
    name: string;
    role: 'owner' | 'admin' | 'inspector';
    active: boolean;
};
