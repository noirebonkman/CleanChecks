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
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => { loader = undefined; reject(Error('로봇 방지 확인을 불러오지 못했습니다.')); };
        document.head.append(script);
    });
    return loader;
}
export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken: (token: string) => void; onError: (message: string) => void }) {
    const element = useRef<HTMLDivElement>(null);
    const callbacks = useRef({ onToken, onError }); callbacks.current = { onToken, onError };
    useEffect(() => {
        let active = true, widget: string | undefined;
        void loadChallenge().then(() => {
            if (active && element.current && window.turnstile) widget = window.turnstile.render(element.current, {
                sitekey: siteKey, action: 'login', theme: 'auto', size: 'flexible',
                callback: (token: string) => callbacks.current.onToken(token),
                'expired-callback': () => callbacks.current.onToken(''),
                'error-callback': () => { callbacks.current.onToken(''); callbacks.current.onError('로봇 방지 확인을 다시 시도해 주세요.'); },
            });
        }).catch(error => { if (active) callbacks.current.onError(error.message); });
        return () => { active = false; if (widget) window.turnstile?.remove(widget); };
    }, [siteKey]);
    return <div className="login-challenge" ref={element} aria-label="로봇 방지 확인"/>;
}
