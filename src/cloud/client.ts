export type ServerUser = {
    id: string;
    username: string;
    name: string;
    role: 'owner' | 'admin' | 'inspector';
    active: boolean;
    mustChangePassword?: boolean;
};
export class ServerError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
// Limit stalled requests without retrying writes whose outcome may be unknown.
const requestTimeoutMs = 20000;
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    try {
        const response = await fetch('/api/' + path, {
            credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal,
        });
        if (!response.ok) {
            if (response.status === 401 && typeof window !== 'undefined')
                window.dispatchEvent(new Event('cleanchecks:server-logout'));
            let message = '서버 요청에 실패했습니다.';
            try { message = (await response.json()).error || message; } catch { /* Keep the safe fallback. */ }
            throw new ServerError(response.status, message);
        }
        return await response.json() as T;
    } catch (error) {
        if (timedOut) throw Error('서버 응답이 늦어 요청을 중단했습니다. 저장 결과를 확인한 뒤 다시 시도해 주세요.');
        if (options.signal?.aborted) throw error;
        if (error instanceof TypeError) throw Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
        throw error;
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
    }
}
export const post = <T>(path: string, body: unknown, method = 'POST') => request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
