// Invoked explicitly by the operator: creates a remote backup, migrates, then deploys.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = resolve(root, 'server');
const wrangler = resolve(server, 'node_modules/wrangler/bin/wrangler.js');
const configuration = JSON.parse(readFileSync(resolve(server, 'wrangler.jsonc'), 'utf8'));
const database = configuration.d1_databases?.find(item => item.binding === 'DB');
function run(file, args, cwd = server) {
    return new Promise((accept, reject) => {
        const child = spawn(process.execPath, [file, ...args], { cwd, stdio: 'inherit', windowsHide: true });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? accept() : reject(Error('작업을 중단했습니다. 실패한 단계: ' + args.join(' '))));
    });
}
try {
    await run(resolve(root, 'tools/check-server-deployment.mjs'), [], root);
    if (!database?.database_name) throw Error('데이터베이스 연결 설정이 없습니다.');
    const privateDirectory = resolve(root, 'private');
    mkdirSync(privateDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = resolve(privateDirectory, 'cleanchecks-before-update-' + timestamp + '.sql');
    if (existsSync(backup)) throw Error('같은 이름의 백업이 있습니다. 덮어쓰지 않습니다.');
    console.log('실제 서버 DB를 백업한 후 테이블 변경과 배포를 진행합니다.');
    await run(wrangler, ['d1', 'export', database.database_name, '--remote', '--output', backup]);
    if (!existsSync(backup) || statSync(backup).size === 0) throw Error('백업 파일을 확인하지 못해 업데이트를 중단합니다.');
    console.log('백업 파일 생성 완료. private 폴더를 별도 보관하세요.');
    await run(wrangler, ['d1', 'migrations', 'apply', database.database_name, '--remote']);
    await run(wrangler, ['deploy']);
} catch (error) {
    console.error(error instanceof Error ? error.message : '업데이트를 완료하지 못했습니다.');
    process.exitCode = 1;
}
