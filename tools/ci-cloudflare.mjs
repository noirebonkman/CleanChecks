import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptBackup, readBackupKey } from './github-backup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = resolve(root, 'server');
const wrangler = resolve(server, 'node_modules/wrangler/bin/wrangler.js');
const configuration = JSON.parse(readFileSync(resolve(server, 'wrangler.jsonc'), 'utf8'));
function checkConfiguration(requireKey = false) {
    if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) throw Error('GitHub Secrets에 CLOUDFLARE_API_TOKEN을 등록하세요.');
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    if (!/^[a-f0-9]{32}$/i.test(accountId)) throw Error('GitHub Secrets의 CLOUDFLARE_ACCOUNT_ID는 계정 ID 32자리여야 합니다.');
    if (configuration.account_id && configuration.account_id !== accountId) throw Error('배포 계정과 설정 파일의 계정이 다릅니다.');
    const bindings = configuration.d1_databases?.filter(item => item.binding === 'DB') || [];
    if (bindings.length !== 1 || !/^[a-f0-9-]{36}$/i.test(bindings[0].database_id || '') ||
        bindings[0].database_id === '00000000-0000-0000-0000-000000000000') {
        throw Error('커밋한 server/wrangler.jsonc에 실제 D1 ID를 DB 연결 하나로 설정하세요.');
    }
    if (requireKey) readBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
    return bindings[0];
}
function run(args) {
    if (!existsSync(wrangler)) throw Error('먼저 npm run server:install 을 실행하세요.');
    return new Promise((accept, reject) => {
        const child = spawn(process.execPath, [wrangler, ...args], {
            cwd: server, stdio: 'inherit', windowsHide: true,
            env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
        });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? accept() : reject(Error('Cloudflare 단계가 실패하여 중단했습니다: ' + args[0])));
    });
}
async function main() {
    const command = process.argv[2];
    const database = checkConfiguration(command === 'check' || command === 'backup');
    if (command === 'check') {
        console.log('자동배포 연결 설정 확인 완료. 비밀 값은 출력하지 않습니다.');
    } else if (command === 'backup') {
        const directory = resolve(root, 'private');
        await mkdir(directory, { recursive: true });
        const raw = resolve(directory, 'cloudflare-backup.sql');
        const encrypted = resolve(directory, 'cloudflare-backup.encrypted');
        if (existsSync(raw) || existsSync(encrypted)) throw Error('백업 파일이 이미 있어 덮어쓰지 않습니다. 새 작업 환경을 사용하세요.');
        await run(['d1', 'export', database.database_name, '--remote', '--output', raw]);
        await encryptBackup(raw, encrypted, readBackupKey(process.env.BACKUP_ENCRYPTION_KEY));
        await unlink(raw);
        console.log('백업 암호화 완료. GitHub에는 암호화된 파일만 보관합니다.');
    } else if (command === 'migrate') {
        await run(['d1', 'migrations', 'apply', database.database_name, '--remote']);
    } else if (command === 'deploy') {
        await run(['deploy']);
    } else throw Error('지원하지 않는 자동배포 작업입니다.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
