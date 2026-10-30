import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'server/wrangler.jsonc');
const configuration = JSON.parse(readFileSync(file, 'utf8'));
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (!/^\d+(\.\d+)+$/.test(version)) throw Error('버전 형식을 확인하세요.');
if (!/^\.\.\/\.server-build\/v\d+(\.\d+)+$/.test(configuration.assets?.directory || '')) {
    throw Error('사용자 지정 assets 경로는 자동 변경하지 않습니다. 배포 경로를 확인해 주세요.');
}
configuration.assets.directory = '../.server-build/v' + version;
// Preserve the deployed D1 identifier, Worker name, bindings and user configuration.
writeFileSync(file, JSON.stringify(configuration, null, 2) + '\n');
console.log('배포 경로 버전 반영 완료. 기존 D1 연결과 비밀 설정을 유지합니다.');
