import type { Environment } from './bindings';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const buffer = (value: Uint8Array) => value as unknown as BufferSource;
export function base64(value: Uint8Array): string {
    let text = '';
    for (const byte of value)
        text += String.fromCharCode(byte);
    return btoa(text);
}
export function fromBase64(text: string): Uint8Array {
    return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}
export async function digest(text: string): Promise<string> {
    return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
export function same(left: string, right: string): boolean {
    let mismatch = left.length ^ right.length;
    for (let index = 0; index < Math.max(left.length, right.length); index++)
        mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
    return mismatch === 0;
}
export async function passwordHash(password: string, salt = base64(crypto.getRandomValues(new Uint8Array(16)))): Promise<string> {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: buffer(fromBase64(salt)), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return salt + '.' + base64(new Uint8Array(bits));
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const salt = hash.split('.')[0];
    return same(await passwordHash(password, salt), hash);
}
async function dataKey(environment: Environment): Promise<CryptoKey> {
    const bytes = fromBase64(environment.APP_DATA_KEY || '');
    if (bytes.length !== 32)
        throw new Error('Server encryption key is not configured');
    return crypto.subtle.importKey('raw', buffer(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealBytes(bytes: Uint8Array, environment: Environment): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(environment), buffer(bytes)));
    const result = new Uint8Array(12 + encrypted.length);
    result.set(iv);
    result.set(encrypted, 12);
    return result;
}
export async function openBytes(bytes: Uint8Array, environment: Environment): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(bytes.slice(0, 12)) }, await dataKey(environment), buffer(bytes.slice(12))));
}
export async function seal(value: unknown, environment: Environment): Promise<string> {
    return base64(await sealBytes(encoder.encode(JSON.stringify(value)), environment));
}
export async function open<T>(value: string, environment: Environment): Promise<T> {
    return JSON.parse(decoder.decode(await openBytes(fromBase64(value), environment))) as T;
}
export function sessionToken(request: Request): string | undefined {
    const name = new URL(request.url).protocol === 'https:' ? '__Host-cleanchecks_session' : 'cleanchecks_session';
    return request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1);
}
export function cookie(token: string, request: Request, maxAge: number | null = 43200): string {
    const secure = new URL(request.url).protocol === 'https:';
    const name = secure ? '__Host-cleanchecks_session' : 'cleanchecks_session';
    return name + '=' + token + '; Path=' + (secure ? '/' : '/api') + '; HttpOnly; SameSite=Strict' + (maxAge === null ? '' : '; Max-Age=' + maxAge) + (secure ? '; Secure' : '');
}
