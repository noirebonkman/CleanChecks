import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const requiredProjectFiles = [
    'package.json', 'package-lock.json', 'index.html', 'vite.config.ts',
    'src/main.tsx', 'src/version.ts', 'src/cloud/LoginApplication.tsx',
    'server/package.json', 'server/package-lock.json', 'server/wrangler.jsonc', 'server/src/worker.ts',
    'server/migrations/0001_initial.sql', 'server/migrations/0002_account_login.sql',
    'tools/prepare-server-assets.mjs', 'tools/deployment-assets.mjs',
    'tools/check-server-deployment.mjs', 'tools/update-server-configuration.mjs',
];
const scriptNames = ['server:install', 'server:test', 'server:build', 'server:check'];
function readJson(root, name, errors) {
    try { return JSON.parse(readFileSync(resolve(root, name), 'utf8')); }
    catch { errors.push(name + ': 파일이 없거나 JSON 형식이 올바르지 않습니다.'); return null; }
}
function scriptFiles(text) {
    return [...text.matchAll(/\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*((?:tools|tests)\/[\w./-]+\.mjs)\b/g)].map(match => match[1]);
}
export function checkProjectFiles(root) {
    const errors = [];
    const required = new Set(requiredProjectFiles);
    const packageJson = readJson(root, 'package.json', errors);
    const serverJson = readJson(root, 'server/package.json', errors);
    for (const name of scriptNames) if (!packageJson?.scripts?.[name]) errors.push('package.json: ' + name + ' 명령이 없습니다.');
    for (const command of Object.values(packageJson?.scripts || {}))
        for (const file of scriptFiles(command)) required.add(file);
    for (const command of Object.values(serverJson?.scripts || {}))
        for (const file of scriptFiles(command)) required.add('server/' + file);
    const workflow = resolve(root, '.github/workflows/deploy.yml');
    if (existsSync(workflow))
        for (const file of scriptFiles(readFileSync(workflow, 'utf8'))) required.add(file);
    for (const file of required) if (!existsSync(resolve(root, file))) errors.push(file + ': 필수 파일이 없습니다.');
    for (const [manifest, lock] of [['package.json', 'package-lock.json'], ['server/package.json', 'server/package-lock.json']]) {
        const dependencyManifest = manifest === 'package.json' ? packageJson : serverJson;
        const dependencyLock = readJson(root, lock, errors);
        const locked = dependencyLock?.packages?.[''];
        if (!locked) errors.push(lock + ': npm ci에 필요한 packages 정보가 없습니다.');
        else for (const group of ['dependencies', 'devDependencies']) {
            const actual = dependencyManifest?.[group] || {};
            const recorded = locked[group] || {};
            if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(recorded).sort()))
                errors.push(lock + ': ' + manifest + '의 ' + group + '와 일치하지 않습니다.');
        }
    }
    // Follow active entry points; unused files left from an earlier release must not block deployment.
    const sourceFiles = ['src/main.tsx', 'server/src/worker.ts', 'vite.config.ts',
        ...[...required].filter(file => file.startsWith('tools/') && file.endsWith('.mjs'))
    ].map(file => resolve(root, file));
    const visited = new Set();
    while (sourceFiles.length) {
        const file = sourceFiles.pop();
        if (visited.has(file) || !existsSync(file) || !['.ts', '.tsx', '.js', '.mjs'].includes(extname(file))) continue;
        visited.add(file);
        const code = readFileSync(file, 'utf8');
        const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)];
        for (const match of imports) {
            const target = resolve(dirname(file), match[1].split('?')[0]);
            const candidates = [target, ...['.ts', '.tsx', '.js', '.mjs', '.css', '/index.ts', '/index.tsx'].map(suffix => target + suffix)];
            const found = candidates.find(candidate => existsSync(candidate));
            if (found) sourceFiles.push(found);
            else errors.push(relative(root, file).replaceAll('\\', '/') + ': 연결 파일 ' + match[1] + '이 없습니다.');
        }
    }
    return [...new Set(errors)];
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const errors = checkProjectFiles(root);
    if (errors.length) { console.error('프로젝트 파일 검사 실패:\n' + errors.map(error => '- ' + error).join('\n')); process.exitCode = 1; }
    else console.log('프로젝트 필수 파일·실행 명령·의존성 목록·소스 연결 검사 통과');
}
