import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const publicFiles = [
    'index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest',
    'icon.svg', 'icon-192.png', 'icon-512.png', 'favicon-32.png',
    'apple-touch-icon.png', 'logo-black.svg', 'logo-white.svg',
];
const bundleExtensions = new Set(['.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2']);
export const securityHeaders = [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer',
    '  Strict-Transport-Security: max-age=31536000',
    '  Permissions-Policy: camera=(self), microphone=(), geolocation=()',
    "  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    '', '/index.html', '  Cache-Control: no-cache', '/sw.js', '  Cache-Control: no-cache', '',
].join('\n');

export function checkedFile(directory, name) {
    if (typeof name !== 'string' || !name || name.includes('\\') || isAbsolute(name) ||
        name.split('/').some(part => !part || part === '.' || part === '..')) {
        throw Error('허용되지 않은 배포 경로입니다.');
    }
    const base = resolve(directory);
    const file = resolve(base, name);
    const inside = relative(base, file);
    if (inside.startsWith('..' + sep) || isAbsolute(inside)) throw Error('배포 경로가 폴더 밖을 가리킵니다.');
    // Directory links must also be checked before accessing a file.
    let current = base;
    if (lstatSync(current).isSymbolicLink()) throw Error('배포 폴더에 연결 경로를 사용할 수 없습니다.');
    for (const part of name.split('/')) {
        current = resolve(current, part);
        if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
            throw Error('배포 파일에 연결 경로를 사용할 수 없습니다: ' + name);
        }
    }
    return file;
}
export function listFiles(directory, prefix = '') {
    const result = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        checkedFile(directory, entry.name);
        if (entry.isDirectory()) result.push(...listFiles(resolve(directory, entry.name), name + '/'));
        else if (entry.isFile()) result.push(name);
        else throw Error('일반 파일이 아닌 배포 항목이 있습니다: ' + name);
    }
    return result.sort();
}
export function collectBuildFiles(source) {
    const manifest = JSON.parse(readFileSync(checkedFile(source, '.vite/manifest.json'), 'utf8'));
    const names = new Set(publicFiles.filter(name => existsSync(checkedFile(source, name))));
    for (const entry of Object.values(manifest)) {
        for (const name of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
            if (typeof name !== 'string' || !name.startsWith('assets/') ||
                !bundleExtensions.has(extname(name))) {
                throw Error('빌드 목록에 허용되지 않은 파일이 있습니다.');
            }
            checkedFile(source, name);
            names.add(name);
        }
    }
    for (const name of ['index.html', 'sw.js', 'manifest.webmanifest']) {
        if (!names.has(name)) throw Error('필수 웹 파일이 없습니다: ' + name);
    }
    return [...names].sort();
}
export function hashFile(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}
export function verifyStagedFiles(directory, inventory, version) {
    if (inventory.version !== version || !Array.isArray(inventory.files) || !inventory.files.length) {
        throw Error('배포 파일 목록의 버전이 맞지 않습니다. 다시 빌드하세요.');
    }
    const expected = inventory.files.map(entry => entry.path).sort();
    if (new Set(expected).size !== expected.length ||
        JSON.stringify(listFiles(directory)) !== JSON.stringify(expected)) {
        throw Error('배포 폴더에 누락되거나 예상하지 않은 파일이 있습니다. 다시 확인하세요.');
    }
    for (const entry of inventory.files) {
        const file = checkedFile(directory, entry.path);
        if (hashFile(file) !== entry.sha256) throw Error('빌드 후 변경된 파일이 있습니다: ' + entry.path);
    }
    if (readFileSync(checkedFile(directory, '_headers'), 'utf8') !== securityHeaders) {
        throw Error('배포 보안 헤더가 올바르지 않습니다.');
    }
    const html = readFileSync(checkedFile(directory, 'index.html'), 'utf8');
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc\s*=/.test(script[1]) && script[2].trim()) {
            throw Error('보안 정책에서 실행할 수 없는 인라인 스크립트가 있습니다.');
        }
    }
}
