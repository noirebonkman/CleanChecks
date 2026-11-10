import { APP_VERSION } from '../../src/version';
import { canManageCalendar, permissionKeys, type PermissionOverrides } from '../../src/access-control';
import { accountSelection, permissionColumns, permissionsFor, overridesFor, requirePermission } from './account-permissions';
import { checkLoginBurst, verifyChallenge } from './login-protection';
import type { Environment, Account, PublicAccount } from './bindings';
import { base64, fromBase64, cookie, sessionToken, digest, open, passwordHash, same, seal, verifyPassword } from './security';
import { ApiError, id, jsonBody, readBody, record, revision, site, text } from './validation';
import { cleanExpiredPhotos, inspectionPhoto, photoBytes, photoStorageBudget, trashDurationMs } from './inspection-photos';
import { calendarRoute } from './calendar';
import { calendarEventHub, publishCalendarChange } from './calendar-events';
export { CalendarEvents } from './calendar-events';
const sessionSeconds = 12 * 60 * 60;
const rememberedSeconds = 30 * 24 * 60 * 60;
const now = () => new Date().toISOString();
const send = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
async function publicAccount(account: Account, env: Environment): Promise<PublicAccount> {
    return { id: account.id, username: account.username, name: await open<string>(account.display_name, env), role: account.role, active: !!account.active, mustChangePassword: !!account.must_change_password, permissions: permissionsFor(account), permissionOverrides: overridesFor(account), permissionRevision: account.permission_revision || 0 };
}
function loginName(value: unknown): string {
    const name = text(value, '로그인 아이디', 80, true).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(name))
        throw new ApiError(400, '아이디는 영문 소문자·숫자 등 3~80자로 입력해 주세요.');
    return name;
}
function password(value: unknown): string {
    const result = text(value, '비밀번호', 128, true);
    if (result.length < 10)
        throw new ApiError(400, '비밀번호는 10자 이상으로 설정해 주세요.');
    return result;
}
async function authenticate(request: Request, env: Environment): Promise<Account> {
    const token = sessionToken(request);
    if (!token || token.length > 200)
        throw new ApiError(401, '서버에 로그인해 주세요.');
    const user = await env.DB.prepare('SELECT a.*,s.expires_at AS session_expires_at,' + permissionColumns + ' FROM accounts a JOIN sessions s ON s.account_id=a.id LEFT JOIN account_permissions p ON p.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND a.deleted_at IS NULL')
        .bind(await digest(token), Date.now()).first<Account>();
    if (!user)
        throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    // Reject a wrong encryption key before any authenticated write can mix incompatible ciphertext.
    await open<string>(user.display_name, env);
    return user;
}
async function confirmPassword(account: Account, provided: string, env: Environment): Promise<void> {
    await checkLoginBurst(env);
    const clock=Date.now(), key='@confirm-'+account.id;
    const attempt=await env.DB.prepare('INSERT INTO login_attempts(username,failures,expires_at) VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN expires_at<? THEN 1 ELSE failures+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING failures').bind(key,clock+15*60000,clock,clock).first<{failures:number}>();
    if (!attempt || attempt.failures>8) throw new ApiError(429,'비밀번호 확인 시도가 많습니다. 15분 후 다시 시도해 주세요.');
    if (!await verifyPassword(provided,account.password_hash)) throw new ApiError(403,'비밀번호를 확인해 주세요.');
    await env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(key).run();
}
function audit(env: Environment, actor: string, action: string, target: string) {
    return env.DB.prepare('INSERT INTO audit(id,actor_id,action,target_id,at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), actor, action, target, now());
}
async function listRecords(request: Request, env: Environment, account: Account, all = false) {
    const url = new URL(request.url), cursor = url.searchParams.get('cursor') || '';
    if (cursor)
        id(cursor);
    const rows = await env.DB.prepare(all ?
        'SELECT * FROM inspections WHERE id>? ORDER BY id LIMIT 101' :
        'SELECT * FROM inspections WHERE account_id=? AND id>? ORDER BY id LIMIT 101')
        .bind(...(all ? [cursor] : [account.id, cursor])).all<{
        id: string;
        account_id: string;
        payload: string;
        revision: number;
        deleted: number;
        updated_at: string;
    }>();
    const page = rows.results.slice(0, 100);
    return send({ records: await Promise.all(page.map(async (row) => ({ id: row.id, ownerId: row.account_id, revision: row.revision, deleted: !!row.deleted, updated: row.updated_at, record: row.deleted ? null : await open(row.payload, env) }))), nextCursor: rows.results.length > 100 ? page[page.length - 1].id : null });
}
async function route(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (!path.startsWith('/api/'))
        return env.ASSETS ? env.ASSETS.fetch(request) : new Response('CleanChecks API', { status: 200 });
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!loopback && url.protocol !== 'https:')
        throw new ApiError(400, 'HTTPS 접속만 허용합니다.');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site')
        throw new ApiError(403, '외부 사이트 요청은 허용하지 않습니다.');
    if (method !== 'GET' && method !== 'HEAD') {
        const origin = request.headers.get('Origin');
        const localOrigin = loopback && ['http://127.0.0.1:5179', 'http://localhost:5179'].includes(origin || '');
        if (!origin || (origin !== url.origin && !localOrigin))
            throw new ApiError(403, '허용하지 않은 접속 주소입니다.');
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
            throw new ApiError(415, 'JSON 형식만 허용합니다.');
    }
    if (path === '/api/auth-config' && method === 'GET') {
        const installed = await env.DB.prepare('SELECT id FROM installation WHERE id=1').first();
        return send({ setupRequired: !installed, turnstileSiteKey: loopback ? '' : env.TURNSTILE_SITE_KEY || '', localDevelopment: loopback });
    }
    if (path === '/api/health' && method === 'GET') {
        try {
            if (fromBase64(env.APP_DATA_KEY || '').length !== 32)
                throw Error();
        }
        catch {
            throw new ApiError(503, '서버 암호화 설정이 준비되지 않았습니다.');
        }
        await env.DB.prepare('SELECT id FROM installation WHERE id=1').first();
        const owner = await env.DB.prepare('SELECT display_name FROM accounts WHERE username=?').bind('ludmin').first<{
            display_name: string;
        }>();
        if (owner) {
            try {
                await open<string>(owner.display_name, env);
            }
            catch {
                throw new ApiError(503, '기존 자료의 암호화 키를 확인해 주세요. 새 키로 덮어쓰지 마세요.');
            }
        }
        return send({ ok: true, service: 'cleanchecks', version: APP_VERSION, photoStorage: 'd1' });
    }
    if (path === '/api/setup' && method === 'POST') {
        await checkLoginBurst(env);
        const body = await jsonBody(request);
        await verifyChallenge(request, body.challenge, env);
        if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 32 || !same(String(body.setupToken || ''), env.SETUP_TOKEN))
            throw new ApiError(403, '서버 초기 설정 코드를 확인해 주세요.');
        const username = loginName(body.username), name = text(body.name, '이름', 100, true);
        if (username !== 'ludmin')
            throw new ApiError(400, '최초 운영자 아이디는 ludmin입니다.');
        const hash = await passwordHash(password(body.password)), userId = crypto.randomUUID();
        if (await env.DB.prepare('SELECT id FROM installation WHERE id=1').first())
            throw new ApiError(409, '초기 설정이 이미 완료되었습니다.');
        try {
            await env.DB.batch([
                env.DB.prepare('INSERT INTO installation(id) VALUES(1)'),
                env.DB.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').bind(userId, username, await seal(name, env), hash, 'owner', now()),
                audit(env, userId, 'server-initialized', userId),
            ]);
        }
        catch {
            throw new ApiError(409, '초기 설정이 이미 완료되었거나 저장에 실패했습니다.');
        }
        return send({ ok: true }, 201);
    }
    if (path === '/api/login' && method === 'POST') {
        await checkLoginBurst(env);
        const body = await jsonBody(request);
        await verifyChallenge(request, body.challenge, env);
        const username = loginName(body.username), provided = text(body.password, '비밀번호', 128, true), clock = Date.now();
        await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(clock).run();
        const attempts = await env.DB.prepare('INSERT INTO login_attempts(username,failures,expires_at) VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN expires_at<? THEN 1 ELSE failures+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING failures,expires_at')
            .bind(username, clock + 15 * 60000, clock, clock).first<{
            failures: number;
            expires_at: number;
        }>();
        if (!attempts || attempts.failures > 8)
            throw new ApiError(429, '로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.');
        const account = await env.DB.prepare(accountSelection + ' WHERE a.username=?').bind(username).first<Account>();
        const dummy = 'AAAAAAAAAAAAAAAAAAAAAA==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        const valid = await verifyPassword(provided, account?.password_hash || dummy);
        if (!account || !account.active || (account as Account & {
            deleted_at?: string;
        }).deleted_at || !valid)
            throw new ApiError(401, '아이디 또는 비밀번호를 확인해 주세요.');
        if (account.must_change_password && (!account.temporary_expires_at || account.temporary_expires_at < clock))
            throw new ApiError(401, '임시 비밀번호가 만료되었습니다. 관리자에게 재발급을 요청해 주세요.');
        const duration = body.remember === true ? rememberedSeconds : sessionSeconds;
        const token = base64(crypto.getRandomValues(new Uint8Array(32)));
        await env.DB.batch([
            env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username),
            env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(clock),
            env.DB.prepare('DELETE FROM sessions WHERE account_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY expires_at DESC LIMIT 4)').bind(account.id, account.id),
            env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await digest(token), account.id, clock + duration * 1000),
            audit(env, account.id, 'login', account.id),
        ]);
        return send({ user: await publicAccount(account, env), expiresAt: clock + duration * 1000 }, 200, { 'Set-Cookie': cookie(token, request, body.remember === true ? rememberedSeconds : null) });
    }
    const account = await authenticate(request, env);
    if (path === '/api/session' && method === 'GET')
        return send({ user: await publicAccount(account, env), expiresAt: account.session_expires_at });
    if (path === '/api/logout' && method === 'POST') {
        const token = sessionToken(request) || '';
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
        return send({ ok: true }, 200, { 'Set-Cookie': cookie('', request, 0) });
    }
    if (account.must_change_password && !(path === '/api/password' && method === 'POST'))
        throw new ApiError(403, '먼저 임시 비밀번호를 본인 비밀번호로 변경해 주세요.');
    if (path === '/api/password' && method === 'POST') {
        const body = await jsonBody(request);
        await confirmPassword(account,text(body.current,'현재 비밀번호',128,true),env);
        if (await verifyPassword(password(body.password), account.password_hash))
            throw new ApiError(400, '이전 비밀번호와 다른 비밀번호를 입력해 주세요.');
        await env.DB.batch([
            env.DB.prepare('UPDATE accounts SET password_hash=?,must_change_password=0,temporary_expires_at=NULL WHERE id=?').bind(await passwordHash(password(body.password)), account.id),
            env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(account.id), audit(env, account.id, 'password-changed', account.id)
        ]);
        return send({ ok: true }, 200, { 'Set-Cookie': cookie('', request, 0) });
    }
    if (path === '/api/people' && method === 'GET') {
        requirePermission(account, 'viewAllRecords');
        const rows=await env.DB.prepare(accountSelection + ' WHERE a.deleted_at IS NULL ORDER BY a.created_at LIMIT 500').all<Account>();
        return send({ users: await Promise.all(rows.results.map(row=>publicAccount(row,env))) });
    }
    if (path === '/api/accounts') {
        requirePermission(account, 'manageUsers');
        if (method === 'GET') {
            const result = await env.DB.prepare(account.role === 'owner' ? accountSelection + ' WHERE a.deleted_at IS NULL ORDER BY a.created_at LIMIT 500' : accountSelection + " WHERE a.role<>'owner' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 500").all<Account>();
            return send({ users: await Promise.all(result.results.map(row => publicAccount(row, env))) });
        }
        if (method === 'POST') {
            const body = await jsonBody(request), username = loginName(body.username), name = text(body.name, '이름', 100, true);
            const hash = await passwordHash(password(body.password)), userId = crypto.randomUUID();
            const duplicate = await env.DB.prepare('SELECT id FROM accounts WHERE username=?').bind(username).first();
            if (duplicate)
                throw new ApiError(409, '같은 아이디가 있습니다.');
            if (body.role && body.role !== 'inspector' && (body.role !== 'admin' || account.role !== 'owner'))
                throw new ApiError(403, '관리자 계정은 최상위 운영자만 만들 수 있습니다.');
            const role = body.role === 'admin' ? 'admin' : 'inspector';
            await env.DB.batch([env.DB.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at,must_change_password,temporary_expires_at) VALUES(?,?,?,?,?,?,1,?)').bind(userId, username, await seal(name, env), hash, role, now(), Date.now() + 7 * 86400000), audit(env, account.id, 'account-created', userId)]);
            return send({ ok: true }, 201);
        }
    }
    const permissionMatch = /^\/api\/accounts\/([a-zA-Z0-9_-]+)\/permissions$/.exec(path);
    if (permissionMatch && method === 'PATCH') {
        if (account.role !== 'owner') throw new ApiError(403, '개인별 권한은 어드민만 변경할 수 있습니다.');
        const target = id(permissionMatch[1]), body = await jsonBody(request);
        const person = await env.DB.prepare(accountSelection + ' WHERE a.id=? AND a.deleted_at IS NULL').bind(target).first<Account>();
        if (!person || person.role === 'owner' || person.id === account.id) throw new ApiError(400, '어드민의 권한은 변경할 수 없습니다.');
        const values = body.permissions as Record<string, unknown> | null;
        if (!values || typeof values !== 'object' || Array.isArray(values) ||
            Object.keys(values).length !== permissionKeys.length ||
            Object.keys(values).some(key => !permissionKeys.includes(key as typeof permissionKeys[number])) ||
            permissionKeys.some(key => values[key] !== null && typeof values[key] !== 'boolean'))
            throw new ApiError(400, '권한 항목과 허용·차단 값을 확인해 주세요.');
        const overrides = values as PermissionOverrides, expected = revision(body.revision);
        const reason = body.reason === undefined ? undefined : text(body.reason,'권한 변경 사유',1000,true).trim();
        const operation = crypto.randomUUID(), at = now();
        const flags = permissionKeys.map(key => overrides[key] === null ? null : overrides[key] ? 1 : 0);
        const condition = 'SELECT 1 FROM account_permissions WHERE account_id=? AND operation_id=?';
        const saved = await env.DB.batch([
            expected === 0
                ? env.DB.prepare('INSERT INTO account_permissions(account_id,view_all_records,write_own_records,manage_sites,manage_users,revision,operation_id,updated_by,updated_at) VALUES(?,?,?,?,?,1,?,?,?) ON CONFLICT(account_id) DO NOTHING').bind(target,...flags,operation,account.id,at)
                : env.DB.prepare('UPDATE account_permissions SET view_all_records=?,write_own_records=?,manage_sites=?,manage_users=?,revision=revision+1,operation_id=?,updated_by=?,updated_at=? WHERE account_id=? AND revision=?').bind(...flags,operation,account.id,at,target,expected),
            env.DB.prepare('DELETE FROM sessions WHERE account_id=? AND EXISTS(' + condition + ')').bind(target,target,operation),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(' + condition + ')').bind(crypto.randomUUID(),account.id,'account-permissions-changed',target,at,target,operation),
            env.DB.prepare('INSERT INTO owner_actions SELECT ?,?,?,?,?,? WHERE EXISTS(' + condition + ')').bind(crypto.randomUUID(),account.id,target,'account-permissions-changed',await seal({name:await open<string>(person.display_name,env),reason,before:overridesFor(person),after:overrides},env),at,target,operation),
        ]);
        if (saved[0].meta.changes !== 1) throw new ApiError(409, '다른 화면에서 권한이 변경되었습니다. 계정 목록을 다시 불러와 주세요.');
        const updated = await env.DB.prepare(accountSelection + ' WHERE a.id=?').bind(target).first<Account>();
        return send({ ok:true, revision:expected + 1, user:updated ? await publicAccount(updated,env) : undefined });
    }
    const accountMatch = /^\/api\/accounts\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (accountMatch && method === 'PATCH') {
        requirePermission(account, 'manageUsers');
        const target = id(accountMatch[1]), body = await jsonBody(request);
        if (target === account.id)
            throw new ApiError(400, '본인 계정은 이 메뉴에서 변경할 수 없습니다.');
        const targetAccount = await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').bind(target).first<Account>();
        if (!targetAccount || targetAccount.role === 'owner' || (targetAccount.role === 'admin' && account.role !== 'owner'))
            throw new ApiError(404, '점검자 계정이 없습니다.');
        const reason = typeof body.reason === 'string' ? text(body.reason,'변경 사유',1000,true).trim() : undefined;
        const at = now();
        const statements: ReturnType<typeof env.DB.prepare>[] = [];
        if (body.role !== undefined) {
            if (account.role !== 'owner' || !['admin','inspector'].includes(String(body.role)))
                throw new ApiError(403, '권한 변경은 어드민만 가능합니다.');
            if (body.role === targetAccount.role) throw new ApiError(409, '이미 해당 등급입니다. 목록을 새로고침해 주세요.');
            statements.push(
                env.DB.prepare('UPDATE accounts SET role=? WHERE id=?').bind(body.role,target),
                env.DB.prepare('INSERT INTO account_permissions(account_id,view_all_records,write_own_records,manage_sites,manage_users,revision,operation_id,updated_by,updated_at) VALUES(?,NULL,NULL,NULL,NULL,1,?,?,?) ON CONFLICT(account_id) DO UPDATE SET view_all_records=NULL,write_own_records=NULL,manage_sites=NULL,manage_users=NULL,revision=account_permissions.revision+1,operation_id=excluded.operation_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(target,crypto.randomUUID(),account.id,at),
                audit(env,account.id,'account-role-changed',target),
            );
        } else if (typeof body.active === 'boolean') {
            statements.push(env.DB.prepare('UPDATE accounts SET active=? WHERE id=?').bind(body.active ? 1 : 0,target),
                audit(env,account.id,body.active ? 'account-enabled' : 'account-disabled',target));
        } else if (body.password) {
            statements.push(env.DB.prepare('UPDATE accounts SET password_hash=?,must_change_password=1,temporary_expires_at=? WHERE id=?')
                .bind(await passwordHash(password(body.password)),Date.now()+7*86400000,target),audit(env,account.id,'password-reset',target));
        } else throw new ApiError(400,'변경할 값을 확인해 주세요.');
        const detail = await seal({ reason,fields:Object.keys(body).filter(key=>key!=='password'),name:await open<string>(targetAccount.display_name,env),
            ...(body.role!==undefined ? {beforeRole:targetAccount.role,afterRole:body.role,resetPermissions:true} : {}) },env);
        await env.DB.batch([...statements,env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(target),
            env.DB.prepare('INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) VALUES(?,?,?,?,?,?)')
                .bind(crypto.randomUUID(),account.id,target,'account-management',detail,at)]);
        const updated = await env.DB.prepare(accountSelection + ' WHERE a.id=?').bind(target).first<Account>();
        return send({ ok:true, user:updated ? await publicAccount(updated,env) : undefined });
    }
    if (path === '/api/my-history' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT action,target_id,at FROM audit WHERE actor_id=? ORDER BY at DESC LIMIT 200').bind(account.id).all();
        return send({ events: rows.results });
    }
    if (path === '/api/calendar/events' && method === 'GET') {
        if (request.headers.get('Origin') !== url.origin) throw new ApiError(403,'같은 사이트에서 연결해 주세요.');
        const hub = calendarEventHub(env);
        if (!hub) throw new ApiError(503,'실시간 연결을 사용할 수 없습니다.');
        const mayEdit = canManageCalendar({role:account.role,permissions:permissionsFor(account)});
        return hub.fetch(new Request(request,{headers:{
            Upgrade:request.headers.get('Upgrade') || '',
            'X-Calendar-Session-Expires':String(account.session_expires_at || 0),
            'X-Calendar-Session':await digest(sessionToken(request)!),
            ...(mayEdit ? {'X-Calendar-Editor':account.id,'X-Calendar-Editor-Name':account.display_name} : {}),
        }}));
    }
    if (path === '/api/calendar' || path.startsWith('/api/calendar/')) {
        const result = await calendarRoute(request, env, account, url);
        if (method !== 'GET') await publishCalendarChange(env);
        return send(result);
    }
    if (path === '/api/sites' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM sites ORDER BY id LIMIT 2000').all<{
            id: string;
            payload: string;
            revision: number;
        }>();
        return send({ sites: await Promise.all(rows.results.map(async (row) => ({ site: await open(row.payload, env), revision: row.revision }))) });
    }
    const siteMatch = /^\/api\/sites\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (siteMatch && method === 'PUT') {
        requirePermission(account, 'manageSites');
        const body = await jsonBody(request), value = site(body.site), expected = revision(body.revision), operation = crypto.randomUUID(), at = now();
        if (value.id !== siteMatch[1])
            throw new ApiError(400, '현장 식별번호가 다릅니다.');
        const result = await env.DB.batch([
            expected === 0
                ? env.DB.prepare('INSERT INTO sites(id,payload,revision,operation_id,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(id) DO NOTHING').bind(value.id, await seal(value, env), operation, at)
                : env.DB.prepare('UPDATE sites SET payload=?,revision=revision+1,operation_id=?,updated_at=? WHERE id=? AND revision=?').bind(await seal(value, env), operation, at, value.id, expected),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sites WHERE id=? AND operation_id=?)').bind(crypto.randomUUID(), account.id, 'site-saved', value.id, at, value.id, operation),
        ]);
        if (result[0].meta.changes !== 1)
            throw new ApiError(409, '현장이 다른 기기에서 변경되었습니다.');
        return send({ revision: expected + 1 });
    }
    if (path === '/api/records' && method === 'GET') {
        return listRecords(request, env, account);
    }
    if (path === '/api/admin/records' && method === 'GET') {
        requirePermission(account, 'viewAllRecords');
        return listRecords(request, env, account, true);
    }
    if (path === '/api/owner/photo-storage' && method === 'GET') {
        if (account.role !== 'owner') throw new ApiError(403, '저장 공간은 어드민만 확인할 수 있습니다.');
        const usage = await env.DB.prepare('SELECT 1 AS ok').run();
        const databaseBytes = usage.meta.size_after;
        return send({ used: typeof databaseBytes === 'number' && databaseBytes > 0 ? databaseBytes : await photoBytes(env), limit: 500_000_000, photoBudget: photoStorageBudget });
    }
    const photoMatch = /^\/api\/records\/([a-zA-Z0-9_-]+)\/photos(?:\/([a-zA-Z0-9_-]+))?$/.exec(path);
    if (photoMatch) {
        const photo = await inspectionPhoto(request, env, account, id(photoMatch[1]), photoMatch[2] ? id(photoMatch[2]) : undefined);
        if ('data' in photo && photo.data && new URL(request.url).searchParams.has('image')) {
            const [header, encoded] = photo.data.split(',');
            return new Response(fromBase64(encoded) as unknown as BodyInit, { headers: { 'Content-Type': header.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'no-store' } });
        }
        return send(photo);
    }
    const recordMatch = /^\/api\/records\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (recordMatch && (method === 'PUT' || method === 'DELETE')) {
        if (method === 'PUT') requirePermission(account, 'writeOwnRecords');
        if (method === 'DELETE' && account.role !== 'owner')
            throw new ApiError(403, '점검 기록 삭제는 어드민만 가능합니다.');
        const recordId = id(recordMatch[1]), body = await jsonBody(request), expected = revision(body.revision), at = now(), operation = crypto.randomUUID();
        const value = method === 'PUT' ? record(body.record) : null;
        if (value && value.id !== recordId)
            throw new ApiError(400, '점검표 식별번호가 다릅니다.');
        if (value && (value.photos as unknown[]).length && (body.photoManifest !== true || value.status !== 'complete'))
            throw new ApiError(400, '사진 전송을 확인한 뒤 점검표를 저장해 주세요.');
        if (value && body.photoManifest !== true && expected > 0) {
            const prior = await env.DB.prepare('SELECT payload FROM inspections WHERE id=? AND account_id=? AND revision=? AND deleted=0').bind(recordId, account.id, expected).first<{payload:string}>();
            const saved = prior && await open<{photos?: {id:string}[]}|null>(prior.payload, env);
            if (saved?.photos?.length) throw new ApiError(409, '사진이 있는 점검표를 수정하려면 앱을 업데이트해 주세요.');
        }
        const photoIds = JSON.stringify((value?.photos as {id:string}[] | undefined)?.map(photo => photo.id) ?? []);
        const photosReady = ' (SELECT COUNT(*) FROM inspection_photos WHERE account_id=? AND record_id=? AND photo_id IN (SELECT value FROM json_each(?)))=json_array_length(?)';
        const payload = await seal(value, env), deleted = method === 'DELETE' ? 1 : 0;
        // Existing rows are updated only at the revision read by this client. Audit is part of the same transaction.
        const result = await env.DB.batch([
            ...(method === 'DELETE' ? [env.DB.prepare('INSERT INTO inspection_trash(record_id,payload,expires_at) SELECT id,payload,? FROM inspections WHERE id=? AND account_id=? AND revision=? AND deleted=0 ON CONFLICT(record_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(Date.now()+trashDurationMs, recordId, account.id, expected)] : []),
            expected === 0
                ? env.DB.prepare('INSERT INTO inspections(id,account_id,payload,revision,deleted,operation_id,updated_at) SELECT ?,?,?,1,?,?,? WHERE ?=0 AND '+photosReady+' ON CONFLICT(id) DO NOTHING').bind(recordId, account.id, payload, deleted, operation, at, deleted, account.id, recordId, photoIds, photoIds)
                : env.DB.prepare('UPDATE inspections SET payload=?,revision=revision+1,deleted=?,operation_id=?,updated_at=? WHERE id=? AND account_id=? AND revision=? AND deleted=0 AND '+photosReady).bind(payload, deleted, operation, at, recordId, account.id, expected, account.id, recordId, photoIds, photoIds),
            ...(value && body.photoManifest === true ? [
                env.DB.prepare('UPDATE inspection_photos SET staged_at=NULL WHERE account_id=? AND record_id=? AND photo_id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(account.id, recordId, photoIds, recordId, operation),
                env.DB.prepare('DELETE FROM inspection_photos WHERE account_id=? AND record_id=? AND photo_id NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(account.id, recordId, photoIds, recordId, operation),
            ] : []),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)')
                .bind(crypto.randomUUID(), account.id, deleted ? 'inspection-deleted' : 'inspection-saved', recordId, at, recordId, operation),
        ]);
        if (result[method === 'DELETE' ? 1 : 0].meta.changes !== 1)
            throw new ApiError(409, '다른 기기에서 변경되었거나 접근할 수 없는 점검표입니다.');
        return send({ revision: expected + 1, updated: at });
    }
    if (path === '/api/photos' || path.startsWith('/api/photos/'))
        throw new ApiError(410, '사진은 해당 점검표에서 열어 주세요.');
    const ownerRecord = /^\/api\/owner\/records\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (ownerRecord && method === 'DELETE') {
        if (account.role !== 'owner')
            throw new ApiError(403, '최상위 운영자만 다른 사람의 기록을 삭제할 수 있습니다.');
        const recordId = id(ownerRecord[1]), body = await jsonBody(request), expected = revision(body.revision);
        const reason = text(body.reason, '삭제 사유', 1000, true);
        await confirmPassword(account,text(body.password,'어드민 비밀번호',128,true),env);
        const existing = await env.DB.prepare('SELECT * FROM inspections WHERE id=?').bind(recordId).first<{
            id: string;
            account_id: string;
            payload: string;
            revision: number;
            deleted: number;
        }>();
        if (!existing)
            throw new ApiError(404, '점검 기록을 찾을 수 없습니다.');
        const operation = crypto.randomUUID(), at = now(), payload = await seal(null, env);
        const results = await env.DB.batch([
            env.DB.prepare('INSERT INTO inspection_trash(record_id,payload,expires_at) SELECT id,payload,? FROM inspections WHERE id=? AND revision=? AND deleted=0 ON CONFLICT(record_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(Date.now()+trashDurationMs, recordId, expected),
            env.DB.prepare('UPDATE inspections SET payload=?,revision=revision+1,deleted=1,operation_id=?,updated_at=? WHERE id=? AND revision=? AND deleted=0').bind(payload, operation, at, recordId, expected),
            env.DB.prepare('INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(crypto.randomUUID(), account.id, recordId, 'record-deleted', await seal({ reason, accountId: existing.account_id, name: (await open<{
                    site?: {
                        name?: string;
                    };
                    date?: string;
                }>(existing.payload, env))?.site?.name || recordId }, env), at, recordId, operation),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(crypto.randomUUID(), account.id, 'owner-deleted-record', recordId, at, recordId, operation),
        ]);
        if (results[1].meta.changes !== 1)
            throw new ApiError(409, '기록이 변경되었거나 이미 삭제되었습니다. 다시 불러와 주세요.');
        return send({ revision: expected + 1 });
    }
    const ownerAccount = /^\/api\/owner\/accounts\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (ownerAccount && method === 'DELETE') {
        if (account.role !== 'owner')
            throw new ApiError(403, '최상위 운영자만 점검자를 삭제할 수 있습니다.');
        const target = id(ownerAccount[1]), body = await jsonBody(request), reason = text(body.reason, '삭제 사유', 1000, true);
        await confirmPassword(account,text(body.password,'어드민 비밀번호',128,true),env);
        const person = await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').bind(target).first<Account>();
        if (!person || person.role === 'owner' || person.id === account.id)
            throw new ApiError(400, '삭제할 수 없는 계정입니다.');
        const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM inspections WHERE account_id=? AND deleted=0').bind(target).first<{
            total: number;
        }>();
        const at = now(), operation = crypto.randomUUID();
        await env.DB.batch([
            env.DB.prepare('UPDATE accounts SET active=0,deleted_at=? WHERE id=?').bind(at, target),
            env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(target),
            env.DB.prepare('INSERT INTO inspection_trash(record_id,payload,expires_at) SELECT id,payload,? FROM inspections WHERE account_id=? AND deleted=0 ON CONFLICT(record_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(Date.now()+trashDurationMs, target),
            env.DB.prepare('UPDATE inspections SET payload=?,deleted=1,revision=revision+1,operation_id=?,updated_at=? WHERE account_id=? AND deleted=0').bind(await seal(null, env), operation, at, target),
            env.DB.prepare('INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), account.id, target, 'account-deleted', await seal({ reason, name: await open(person.display_name, env), recordCount: count?.total || 0 }, env), at),
            audit(env, account.id, 'owner-deleted-account', target),
        ]);
        return send({ ok: true, deletedRecords: count?.total || 0 });
    }
    if (path === '/api/owner/trash' && method === 'GET') {
        if (account.role !== 'owner') throw new ApiError(403, '어드민만 확인할 수 있습니다.');
        await cleanExpiredPhotos(env);
        const rows = await env.DB.prepare('SELECT t.record_id,t.payload,t.expires_at,i.account_id,i.revision FROM inspection_trash t JOIN inspections i ON i.id=t.record_id WHERE i.deleted=1 ORDER BY t.expires_at DESC LIMIT 500').all<{record_id:string;payload:string;expires_at:number;account_id:string;revision:number}>();
        return send({ records: await Promise.all(rows.results.map(async row=>({id:row.record_id,ownerId:row.account_id,revision:row.revision,expiresAt:row.expires_at,record:await open(row.payload,env)}))) });
    }
    const restoreMatch = /^\/api\/owner\/restore\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (restoreMatch && method === 'POST') {
        if (account.role !== 'owner') throw new ApiError(403, '어드민만 복원할 수 있습니다.');
        const body=await jsonBody(request), target=id(restoreMatch[1]), expected=revision(body.revision);
        await confirmPassword(account,text(body.password,'어드민 비밀번호',128,true),env);
        const operation=crypto.randomUUID(), at=now();
        const result=await env.DB.batch([
            env.DB.prepare('UPDATE inspections SET payload=(SELECT payload FROM inspection_trash WHERE record_id=? AND expires_at>?),deleted=0,revision=revision+1,operation_id=?,updated_at=? WHERE id=? AND revision=? AND deleted=1 AND EXISTS(SELECT 1 FROM inspection_trash WHERE record_id=? AND expires_at>?) AND EXISTS(SELECT 1 FROM accounts WHERE id=inspections.account_id AND deleted_at IS NULL)').bind(target,Date.now(),operation,at,target,expected,target,Date.now()),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(crypto.randomUUID(),account.id,'inspection-restored',target,at,target,operation)
        ]);
        if(result[0].meta.changes!==1)throw new ApiError(409,'복원 기한·기록 버전·작성자 계정을 확인해 주세요.');
        return send({ok:true});
    }
    if (path === '/api/owner/history' && method === 'GET') {
        if (account.role !== 'owner')
            throw new ApiError(403, '최상위 운영자만 확인할 수 있습니다.');
        const scope = url.searchParams.get('scope');
        const filter = scope === 'calendar' ? " WHERE action GLOB 'calendar-*'"
            : scope === 'management' ? " WHERE action NOT GLOB 'calendar-*'" : '';
        const rows = await env.DB.prepare('SELECT * FROM owner_actions' + filter + ' ORDER BY at DESC, rowid DESC LIMIT 200').all<{
            id: string;
            actor_id: string;
            target_id: string;
            action: string;
            detail: string;
            at: string;
        }>();
        return send({ events: await Promise.all(rows.results.map(async (row) => ({ id: row.id, actorId: row.actor_id, targetId: row.target_id, action: row.action, detail: await open(row.detail, env), at: row.at }))) });
    }
    if (path === '/api/audit' && method === 'GET') {
        if (account.role !== 'owner') throw new ApiError(403, '전체 변경이력은 어드민만 확인할 수 있습니다.');
        const rows = await env.DB.prepare('SELECT actor_id,action,target_id,at FROM audit ORDER BY at DESC LIMIT 200').all();
        return send({ events: rows.results });
    }
    throw new ApiError(404, '지원하지 않는 요청입니다.');
}
function secureResponse(response: Response, request: Request): Response {
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (new URL(request.url).protocol === 'https:')
        headers.set('Strict-Transport-Security', 'max-age=31536000');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export default {
    async scheduled(_event: unknown, env: Environment): Promise<void> {
        await cleanExpiredPhotos(env);
    },
    async fetch(request: Request, env: Environment): Promise<Response> {
        let response: Response;
        try {
            response = await route(request, env);
        }
        catch (error) {
            response = error instanceof ApiError ? send({ error: error.message, details: error.details }, error.status) : send({ error: '서버 처리에 실패했습니다. 연결과 서버 설정을 확인해 주세요.' }, 500);
        }
        return secureResponse(response, request);
    }
};
