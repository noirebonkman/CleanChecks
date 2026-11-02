import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { build } from '../../node_modules/esbuild/lib/main.js';
import { Miniflare } from 'miniflare';

mkdirSync('.test-work', { recursive: true });
await build({ entryPoints: ['src/worker.ts'], outfile: '.test-work/permission-worker.mjs', bundle: true, format: 'esm', platform: 'browser' });
const setupToken = randomBytes(32).toString('hex'), password = 'OwnerPass12345', temporary = 'TempPass12345', chosen = 'Personal12345';
const mf = new Miniflare({ modules: true, scriptPath: '.test-work/permission-worker.mjs', compatibilityDate: '2026-08-01',
    d1Databases: { DB: 'permission-test' }, bindings: { APP_DATA_KEY: randomBytes(32).toString('base64'), SETUP_TOKEN: setupToken } });
const origin = 'https://permission.example.workers.dev', db = await mf.getD1Database('DB');
async function apply(name) {
    for (const sql of readFileSync('migrations/' + name, 'utf8').split(';').filter(value => value.trim())) await db.prepare(sql).run();
}
async function call(path, status, { cookie, method = 'GET', body } = {}) {
    const response = await mf.dispatchFetch(origin + '/api/' + path, { method,
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data));
    return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(username, pass = chosen) { return call('login', 200, { method: 'POST', body: { username, password: pass } }); }
const permissions = (viewAllRecords = false, writeOwnRecords = true, manageSites = false, manageUsers = false) => ({ viewAllRecords, writeOwnRecords, manageSites, manageUsers });
try {
    await apply('0001_initial.sql'); await apply('0002_account_login.sql');
    await call('setup', 201, { method: 'POST', body: { setupToken, username: 'ludmin', name: '어드민', password } });
    await apply('0003_account_permissions.sql');
    const owner = await login('ludmin', password);
    assert(Object.values(owner.data.user.permissions).every(Boolean));
    for (const [username, role] of [['worker', 'inspector'], ['manager', 'admin']]) {
        await call('accounts', 201, { method: 'POST', cookie: owner.cookie, body: { username, name: username, password: temporary, role } });
        const first = await login(username, temporary);
        await call('password', 200, { method: 'POST', cookie: first.cookie, body: { current: temporary, password: chosen } });
    }
    let worker = await login('worker'), manager = await login('manager');
    const workerId = worker.data.user.id, managerId = manager.data.user.id;
    assert.deepEqual(worker.data.user.permissions, permissions());
    assert(Object.values(manager.data.user.permissions).every(Boolean));
    console.log('PASS: permission migration preserves existing owner; absent overrides retain role defaults');

    await call('accounts/' + workerId + '/permissions', 403, { cookie: manager.cookie, method: 'PATCH',
        body: { revision: 0, permissions: permissions(true), reason: 'unauthorized' } });
    await call('accounts/' + workerId + '/permissions', 200, { cookie: owner.cookie, method: 'PATCH',
        body: { revision: 0, permissions: permissions(true, false), reason: '조회 전용 검토' } });
    await call('session', 401, { cookie: worker.cookie });
    worker = await login('worker');
    assert.deepEqual(worker.data.user.permissions, permissions(true, false));
    await call('admin/records', 200, { cookie: worker.cookie });
    await call('people', 200, { cookie: worker.cookie });
    await call('accounts', 403, { cookie: worker.cookie });
    await call('sites/site', 403, { cookie: worker.cookie, method: 'PUT', body: { revision: 0 } });
    await call('records/own', 403, { cookie: worker.cookie, method: 'PUT', body: { revision: 0 } });
    await call('owner/history', 403, { cookie: worker.cookie });
    const before = (await db.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='account-permissions-changed'").first()).count;
    await call('accounts/' + workerId + '/permissions', 409, { cookie: owner.cookie, method: 'PATCH',
        body: { revision: 0, permissions: permissions(), reason: '오래된 화면' } });
    await call('session', 200, { cookie: worker.cookie });
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='account-permissions-changed'").first()).count, before);
    console.log('PASS: personal grant/deny is server-enforced; rights changes revoke sessions; stale saves do not revoke or produce audit');

    await call('accounts/' + workerId + '/permissions', 200, { cookie: owner.cookie, method: 'PATCH',
        body: { revision: 1, permissions: permissions(false, true, true, true), reason: '현장과 일반 계정 관리 담당' } });
    worker = await login('worker');
    await call('admin/records', 403, { cookie: worker.cookie });
    await call('people', 403, { cookie: worker.cookie });
    const site = { id: 'site', name: '권한 테스트 현장', zone: '구역', address: '주소', priority: '', cycle: '' };
    await call('sites/site', 200, { cookie: worker.cookie, method: 'PUT', body: { site, revision: 0 } });
    const record = { id: 'own', site, date: '2026-11-02T12:00', type: '', cycle: '', technician: '', answers: {}, rating: '',
        issues: '', action: '', assignee: '', due: '', actionState: '', notes: '', photos: [], history: [], status: 'draft', updated: new Date().toISOString() };
    await call('records/own', 200, { cookie: worker.cookie, method: 'PUT', body: { record, revision: 0 } });
    await call('accounts', 201, { cookie: worker.cookie, method: 'POST', body: { username: 'child', name: '자식 계정', password: temporary, role: 'inspector' } });
    await call('accounts', 403, { cookie: worker.cookie, method: 'POST', body: { username: 'illegal', name: '불가', password: temporary, role: 'admin' } });
    const child = (await call('accounts', 200, { cookie: owner.cookie })).data.users.find(user => user.username === 'child');
    await call('accounts/' + child.id, 403, { cookie: worker.cookie, method: 'PATCH', body: { role: 'admin' } });
    await call('accounts/' + managerId, 404, { cookie: worker.cookie, method: 'PATCH', body: { active: false } });
    await call('accounts/' + child.id + '/permissions', 403, { cookie: worker.cookie, method: 'PATCH',
        body: { revision: 0, permissions: permissions(true), reason: '불가' } });
    await call('owner/records/own', 403, { cookie: worker.cookie, method: 'DELETE', body: { revision: 1, reason: '불가', password: chosen } });
    console.log('PASS: delegated inspector can manage sites/ordinary accounts but cannot elevate roles, change permissions or delete others');

    await call('accounts/' + managerId + '/permissions', 200, { cookie: owner.cookie, method: 'PATCH',
        body: { revision: 0, permissions: permissions(false, false, false, false), reason: '관리자 기능 일시 차단' } });
    manager = await login('manager');
    assert.equal(manager.data.user.role, 'admin');
    await call('audit', 403, { cookie: manager.cookie });
    await call('admin/records', 403, { cookie: manager.cookie });
    await call('accounts', 403, { cookie: manager.cookie });
    await call('sites/site', 403, { cookie: manager.cookie, method: 'PUT', body: { site, revision: 1 } });
    await call('records/mine', 403, { cookie: manager.cookie, method: 'PUT', body: { record: { ...record, id: 'mine' }, revision: 0 } });
    await call('accounts/' + workerId, 200, { cookie: owner.cookie, method: 'PATCH', body: { role: 'admin', reason: '승격' } });
    await call('session', 401, { cookie: worker.cookie });
    worker = await login('worker');
    assert.equal(worker.data.user.role, 'admin'); assert(Object.values(worker.data.user.permissions).every(Boolean));
    assert(worker.data.user.permissionRevision > 2);
    await call('accounts/' + workerId + '/permissions', 409, { cookie: owner.cookie, method: 'PATCH', body: { revision: 2, permissions: permissions(), reason: '승격 전 화면의 저장 차단' } });
    await call('session', 200, { cookie: worker.cookie });
    assert(Object.values(worker.data.user.permissionOverrides).every(value => value === null));
    await call('records/own', 409, { cookie: owner.cookie, method: 'PUT', body: { record, revision: 1 } });
    await call('accounts/' + workerId, 200, { cookie: owner.cookie, method: 'PATCH', body: { role: 'inspector', reason: '강등' } });
    worker = await login('worker'); assert.deepEqual(worker.data.user.permissions, permissions());
    console.log('PASS: administrator denies apply immediately; promotion/demotion reset overrides to the new role without enabling foreign edits');

    await call('accounts/' + owner.data.user.id + '/permissions', 400, { cookie: owner.cookie, method: 'PATCH',
        body: { revision: 0, permissions: permissions(false, false, false, false), reason: '어드민 잠금 방지' } });
    await call('accounts/' + workerId + '/permissions', 400, { cookie: owner.cookie, method: 'PATCH',
        body: { revision: 0, permissions: { ...permissions(), unexpected: true }, reason: '잘못된 항목' } });
    const audit = (await call('owner/history', 200, { cookie: owner.cookie })).data.events.filter(event => event.action === 'account-permissions-changed');
    assert.equal(audit.length, 3);
    assert(audit.every(event => event.detail.name && event.detail.reason && event.detail.before && event.detail.after));
    const changes=(await call('owner/history',200,{cookie:owner.cookie})).data.events.filter(event=>event.detail.beforeRole);
    assert(changes.some(event=>event.detail.beforeRole==='inspector' && event.detail.afterRole==='admin'));
    assert(changes.some(event=>event.detail.beforeRole==='admin' && event.detail.afterRole==='inspector'));
    assert(changes.every(event=>event.detail.resetPermissions===true));
    console.log('PASS: owner cannot lock itself out; unexpected flags rejected; encrypted before/after/reason audit retained');
} finally { await mf.dispose(); }
