export type ServerUser = {
    id: string;
    username: string;
    name: string;
    role: 'owner' | 'admin' | 'inspector';
    active: boolean;
};
export class ServerError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch('/api/' + path, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined')
            window.dispatchEvent(new Event('cleanchecks:server-logout'));
        let message = '서버 요청에 실패했습니다.';
        try {
            message = (await response.json()).error || message;
        }
        catch { }
        throw new ServerError(response.status, message);
    }
    return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown, method = 'POST') => request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
