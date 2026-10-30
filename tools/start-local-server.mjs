import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = resolve(root, 'server');
const configDirectory = resolve(server, '.wrangler', 'config');
mkdirSync(configDirectory, { recursive: true });
const localEnvironment = { ...process.env, XDG_CONFIG_HOME: configDirectory, WRANGLER_LOG_PATH: resolve(server, '.wrangler', 'logs'), WRANGLER_SEND_METRICS: 'false' };
const storageDirectory = process.env.CLEANCHECKS_LOCAL_STORAGE || resolve(server, '.wrangler', 'state-v092');
const children = new Set();
let stopping = false;
function launch(file, args = [], cwd = root) {
    const child = spawn(process.execPath, [file, ...args], { cwd, stdio: 'inherit', windowsHide: true, env: localEnvironment });
    children.add(child);
    child.on('exit', () => children.delete(child));
    return child;
}
async function run(file, args = [], cwd = root) {
    await new Promise((accept, reject) => {
        const child = launch(file, args, cwd);
        child.on('error', reject);
        child.on('exit', code => code === 0 ? accept() : reject(Error('준비 단계 실패: ' + file + ' (' + code + ')')));
    });
}
function stop(code = 0) {
    if (stopping)
        return;
    stopping = true;
    for (const child of children)
        child.kill('SIGTERM');
    setTimeout(() => process.exit(code), 350);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
try {
    const wrangler = resolve(server, 'node_modules/wrangler/bin/wrangler.js');
    if (!existsSync(wrangler))
        throw Error('서버 패키지가 없습니다. IntelliJ 터미널에서 npm.cmd run server:install 을 한 번 실행하세요.');
    await run(resolve(root, 'tools/update-server-configuration.mjs'));
    await run(resolve(root, 'node_modules/typescript/bin/tsc'), ['-b']);
    await run(resolve(root, 'node_modules/vite/bin/vite.js'), ['build']);
    await run(resolve(root, 'tools/prepare-server-assets.mjs'));
    await run(resolve(server, 'tools/prepare-local.mjs'), [], server);
    await run(wrangler, ['d1', 'migrations', 'apply', 'cleanchecks', '--local', '--persist-to', storageDirectory], server);
    const backend = launch(wrangler, ['dev', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', storageDirectory], server);
    backend.on('error', error => { console.error(error.message); stop(1); });
    backend.on('exit', code => {
        if (!stopping)
            stop(code || 1);
    });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
        if (stopping)
            break;
        try {
            const response = await fetch('http://127.0.0.1:8787/api/health', { signal: AbortSignal.timeout(800) });
            if (response.ok) {
                ready = true;
                break;
            }
        }
        catch { }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready)
        throw Error('서버 시작을 확인하지 못했습니다. 위 오류를 확인해 주세요.');
    console.log('서버 준비 완료. 기존 개발 주소 http://127.0.0.1:5179/ 에서 실행합니다.');
    const frontend = launch(resolve(root, 'node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', '5179', '--strictPort', ...(!process.argv.includes('--no-open') ? ['--open'] : [])]);
    frontend.on('error', error => { console.error(error.message); stop(1); });
    frontend.on('exit', code => {
        if (!stopping)
            stop(code || 0);
    });
}
catch (error) {
    console.error(error.message);
    stop(1);
}
