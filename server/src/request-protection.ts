import type { Environment } from './bindings';
import { digest } from './security';
import { ApiError } from './validation';

export async function checkRequestRate(request: Request, env: Environment, authentication: boolean) {
    const limiter = authentication ? env.AUTH_REQUEST_LIMITER : env.API_REQUEST_LIMITER;
    if (!limiter) return; // Older deployments and isolated local tests do not have edge bindings.
    // Cloudflare supplies this header. Keep only a keyed, short-lived counter at the edge;
    // never write addresses or device identifiers to D1, application logs or audit history.
    const address = request.headers.get('CF-Connecting-IP') || 'no-edge-address';
    const window = Math.floor(Date.now() / 300000);
    const key = await digest(env.APP_DATA_KEY + ':' + window + ':' + address);
    try {
        const result = await limiter.limit({key});
        if (!result.success) throw new ApiError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, '접속 보호 확인을 다시 시도해 주세요.');
    }
}
