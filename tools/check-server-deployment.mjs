import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedFile, verifyStagedFiles } from './deployment-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configuration = JSON.parse(readFileSync(resolve(root, 'server/wrangler.jsonc'), 'utf8'));
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dry = process.argv.includes('--dry-run');
const errors = [];
if (configuration.r2_buckets?.length) errors.push('R2 연결이 남아 있습니다.');
for (const name of ['APP_DATA_KEY', 'SETUP_TOKEN']) {
    if (!configuration.secrets?.required?.includes(name)) errors.push(name + ' 비밀 설정이 없습니다.');
    if (Object.hasOwn(configuration.vars ?? {}, name)) errors.push('비밀키를 일반 환경 변수에 넣으면 안 됩니다: ' + name);
}
if (configuration.observability?.enabled !== false) errors.push('요청 관측 로그 설정을 확인하세요.');
const database = configuration.d1_databases?.find(item => item.binding === 'DB');
if (!database) errors.push('DB 연결 설정이 없습니다.');
if (!dry && (!database?.database_id || database.database_id === '00000000-0000-0000-0000-000000000000')) {
    errors.push('D1 database_id를 실제 값으로 바꾸세요.');
}
if (configuration.assets?.binding !== 'ASSETS' ||
    !configuration.assets?.run_worker_first?.includes('/api/*')) {
    errors.push('API 요청 우선 처리 설정이 올바르지 않습니다.');
}
const directory = resolve(root, 'server', configuration.assets?.directory ?? '.');
const expectedDirectory = resolve(root, '.server-build', 'v' + version);
if (directory !== expectedDirectory) errors.push('배포 폴더와 앱 버전이 다릅니다.');
try {
    const inventoryFile = checkedFile(resolve(root, '.server-build'), 'v' + version + '.manifest.json');
    if (!existsSync(inventoryFile)) throw Error('서버용 웹 파일을 먼저 빌드하세요.');
    const inventory = JSON.parse(readFileSync(inventoryFile, 'utf8'));
    verifyStagedFiles(directory, inventory, version);
} catch (error) {
    errors.push(error.message);
}
if (errors.length) throw Error(errors.join('\n'));
console.log(dry
    ? '로컬 배포 구성·파일 무결성·보안 헤더 검사 통과 (실제 업로드 없음)'
    : '배포 구성·파일 검사 통과. Cloudflare Workers Free 요금제인지 대시보드에서 확인하세요.');
