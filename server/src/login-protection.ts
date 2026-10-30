import type { Environment } from './bindings';
import { ApiError } from './validation';

export async function checkLoginBurst(env: Environment) {
    const clock = Date.now();
    const row = await env.DB.prepare(
        'INSERT INTO login_attempts(username,failures,expires_at) VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN expires_at<? THEN 1 ELSE failures+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING failures'
    ).bind('@login-burst', clock + 60000, clock, clock).first<{ failures: number }>();
    if (!row || row.failures > 120) throw new ApiError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
}

export async function verifyChallenge(request: Request, token: unknown, env: Environment) {
    // Local previews listen on loopback only and must not use production challenge keys.
    if (['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)) return;
    // No IP or device fingerprint is retained by the application.
    if (!env.TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY) return;
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) {
        throw new ApiError(503, '로그인 봇 검사 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.');
    }
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048) {
        throw new ApiError(400, '로봇 방지 확인을 완료해 주세요.');
    }
    let response: Response;
    try {
        response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
            signal: AbortSignal.timeout(8000),
        });
    } catch { throw new ApiError(503, '로봇 방지 확인에 연결하지 못했습니다. 다시 시도해 주세요.'); }
    const result = await response.json() as { success: boolean; hostname?: string; action?: string };
    if (!response.ok || !result.success || result.hostname !== new URL(request.url).hostname || result.action !== 'login') {
        throw new ApiError(403, '로봇 방지 확인이 만료되었습니다. 다시 시도해 주세요.');
    }
}
