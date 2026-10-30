import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedFile, collectBuildFiles, hashFile, listFiles, securityHeaders, verifyStagedFiles } from './deployment-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'dist');
if (!existsSync(source)) throw Error('먼저 npm run build 를 실행하세요.');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (!/^\d+(?:\.\d+)+$/.test(version)) throw Error('버전 형식을 확인하세요.');
const staging = resolve(root, '.server-build');
mkdirSync(staging, { recursive: true });
const destination = checkedFile(staging, 'v' + version);
mkdirSync(destination, { recursive: true });
const files = collectBuildFiles(source);
const allowed = new Set([...files, '_headers']);
// Do not silently retain stale files or remove a user's directory.
for (const name of listFiles(destination)) {
    if (!allowed.has(name)) throw Error('이전 배포 파일이 섞여 있습니다: ' + name);
}
for (const name of files) {
    const input = checkedFile(source, name);
    if (!statSync(input).isFile() || statSync(input).size > 8 * 1024 * 1024) {
        throw Error('배포 파일 크기나 형식을 확인하세요: ' + name);
    }
    const output = checkedFile(destination, name);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(input, output);
}
writeFileSync(checkedFile(destination, '_headers'), securityHeaders);
const inventory = {
    version,
    files: [...allowed].sort().map(path => ({ path, sha256: hashFile(checkedFile(destination, path)) })),
};
verifyStagedFiles(destination, inventory, version);
// The verification inventory is outside the public asset directory.
writeFileSync(checkedFile(staging, 'v' + version + '.manifest.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log('서버 배포 파일 준비 완료: .server-build/v' + version + ' (빌드 목록에 포함된 웹 파일만 사용)');
