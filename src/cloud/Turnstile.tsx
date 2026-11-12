import { useEffect, useRef } from 'react';

type Challenge = {
    render: (element: HTMLElement, options: Record<string, unknown>) => string;
    remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Challenge } }
let loader: Promise<void> | undefined;
function loadChallenge() {
    if (window.turnstile) return Promise.resolve();
    if (!loader) loader = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        const fail = () => {
            clearTimeout(timer); loader = undefined; script.remove();
            reject(Error('접속 확인을 불러오지 못했습니다. 다시 확인해 주세요.'));
        };
        const timer = setTimeout(fail,15000);
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => { if (!window.turnstile) return fail(); clearTimeout(timer); resolve(); };
        script.onerror = fail;
        document.head.append(script);
    });
    return loader;
}
export function Turnstile({ siteKey, action = 'login', onToken, onError }: { siteKey: string; action?: 'login' | 'access'; onToken: (token: string) => void; onError: (message: string) => void }) {
    const element = useRef<HTMLDivElement>(null);
    const callbacks = useRef({ onToken, onError }); callbacks.current = { onToken, onError };
    useEffect(() => {
        let active = true, widget: string | undefined;
        void loadChallenge().then(() => {
            if (active && element.current && window.turnstile) widget = window.turnstile.render(element.current, {
                sitekey: siteKey, action, theme: 'auto', size: 'flexible',
                execution: 'render', appearance: 'interaction-only', language: 'ko',
                callback: (token: string) => { if (active) callbacks.current.onToken(token); },
                'expired-callback': () => { if (active) callbacks.current.onToken(''); },
                'error-callback': () => { if (active) { callbacks.current.onToken(''); callbacks.current.onError('로봇 방지 확인을 다시 시도해 주세요.'); } },
            });
        }).catch(error => { if (active) { callbacks.current.onToken(''); callbacks.current.onError(error.message); } });
        return () => { active = false; if (widget) window.turnstile?.remove(widget); };
    }, [siteKey, action]);
    return <div className="login-challenge" ref={element} aria-hidden="true"/>;
}
