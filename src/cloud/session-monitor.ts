import { request, type ServerUser } from './client';

type SessionAccess = {
    currentUser: () => ServerUser | null;
    expiresAt: () => number | null;
    invalidate: () => void;
};
type MonitorEnvironment = {
    window: EventTarget;
    document: EventTarget & { visibilityState: string };
    online: () => boolean;
    now: () => number;
    startTimer: (callback: () => void, delay: number) => unknown;
    stopTimer: (timer: unknown) => void;
};

// Expiry is fixed at login. Background tabs do not need periodic network checks;
// returning to the app checks permissions immediately, with at most one request.
export function monitorSession(access: SessionAccess, environment: MonitorEnvironment = {
    window, document, online: () => navigator.onLine, now: () => Date.now(),
    startTimer: (callback, delay) => window.setInterval(callback, delay),
    stopTimer: timer => window.clearInterval(timer as number),
}): () => void {
    let active = true;
    let checking = false;
    const controller = new AbortController();
    const check = async () => {
        const user = access.currentUser();
        if (!active || !user) return;
        const expiry = access.expiresAt();
        if (expiry !== null && environment.now() >= expiry) {
            access.invalidate();
            return;
        }
        if (checking || !environment.online() || environment.document.visibilityState !== 'visible') return;
        checking = true;
        try {
            const session = await request<{ user: ServerUser }>('session', { signal: controller.signal });
            const current = access.currentUser();
            if (!active || current?.id !== user.id) return;
            if (session.user.id !== current.id || session.user.role !== current.role ||
                JSON.stringify(session.user.permissions) !== JSON.stringify(current.permissions)) access.invalidate();
        } catch {
            // The shared request handler handles expired sessions. A network
            // failure must preserve the account and its unsent local records.
        } finally {
            checking = false;
        }
    };
    const refresh = () => { void check(); };
    const timer = environment.startTimer(refresh, 60_000);
    environment.window.addEventListener('online', refresh);
    environment.document.addEventListener('visibilitychange', refresh);
    return () => {
        active = false;
        controller.abort();
        environment.stopTimer(timer);
        environment.window.removeEventListener('online', refresh);
        environment.document.removeEventListener('visibilitychange', refresh);
    };
}
