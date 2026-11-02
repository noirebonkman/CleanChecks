export type ApplyAppUpdate = () => Promise<void>;
let availableUpdate: ApplyAppUpdate | null = null;
const listeners = new Set<(apply: ApplyAppUpdate) => void>();

// The update can arrive while login/session restoration is still mounting the app.
export function publishAppUpdate(apply: ApplyAppUpdate): void {
    availableUpdate = apply;
    for (const listener of listeners) listener(apply);
}
export function subscribeAppUpdates(listener: (apply: ApplyAppUpdate) => void): () => void {
    listeners.add(listener);
    if (availableUpdate) listener(availableUpdate);
    return () => { listeners.delete(listener); };
}
type UpdateEnvironment = {
    window: EventTarget;
    document: EventTarget & { visibilityState: string };
    online: () => boolean;
    now: () => number;
};
export function watchForAppUpdates(registration: { update: () => Promise<unknown> },
    environment: UpdateEnvironment = { window, document, online: () => navigator.onLine, now: () => Date.now() }): () => void {
    let lastChecked = environment.now();
    const check = () => {
        const time = environment.now();
        if (environment.document.visibilityState !== 'visible' || !environment.online() || time - lastChecked < 300000) return;
        lastChecked = time;
        void registration.update().catch(() => { /* Offline/update failure must not interrupt inspection. */ });
    };
    environment.document.addEventListener('visibilitychange', check);
    environment.window.addEventListener('online', check);
    return () => {
        environment.document.removeEventListener('visibilitychange', check);
        environment.window.removeEventListener('online', check);
    };
}
