import type { Environment, Account, PublicAccount } from './bindings';
import { base64, fromBase64, cookie, sessionToken, digest, open, passwordHash, same, seal, verifyPassword } from './security';
import { ApiError, id, jsonBody, readBody, record, revision, site, text } from './validation';
const sessionSeconds = 12 * 60 * 60;
const now = () => new Date().toISOString();
const send = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
async function publicAccount(account: Account, env: Environment): Promise<PublicAccount> {
    return { id: account.id, username: account.username, name: await open<string>(account.display_name, env), role: account.role, active: !!account.active };
}
function loginName(value: unknown): string {
    const name = text(value, '로그인 아이디', 80, true).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(name))
        throw new ApiError(400, '아이디는 영문 소문자·숫자 등 3~80자로 입력해 주세요.');
    return name;
}
function password(value: unknown): string {
    const result = text(value, '비밀번호', 128, true);
    if (result.length < 12)
        throw new ApiError(400, '서버 비밀번호는 12자 이상으로 설정해 주세요.');
    return result;
}
async function authenticate(request: Request, env: Environment): Promise<Account> {
    const token = sessionToken(request);
    if (!token || token.length > 200)
        throw new ApiError(401, '서버에 로그인해 주세요.');
    const user = await env.DB.prepare('SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND a.deleted_at IS NULL')
        .bind(await digest(token), Date.now()).first<Account>();
    if (!user)
        throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    // Reject a wrong encryption key before any authenticated write can mix incompatible ciphertext.
    await open<string>(user.display_name, env);
    return user;
}
function requireAdmin(account: Account) {
    if (account.role !== 'admin' && account.role !== 'owner')
        throw new ApiError(403, '서버 관리자만 사용할 수 있습니다.');
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
        return send({ ok: true, service: 'cleanchecks', version: '0.93', photoStorage: 'local-only' });
    }
    if (path === '/api/setup' && method === 'POST') {
        const body = await jsonBody(request);
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
        const body = await jsonBody(request), username = loginName(body.username), provided = text(body.password, '비밀번호', 128, true), clock = Date.now();
        await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(clock).run();
        const attempts = await env.DB.prepare('INSERT INTO login_attempts(username,failures,expires_at) VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN expires_at<? THEN 1 ELSE failures+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING failures,expires_at')
            .bind(username, clock + 15 * 60000, clock, clock).first<{
            failures: number;
            expires_at: number;
        }>();
        if (!attempts || attempts.failures > 8)
            throw new ApiError(429, '로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.');
        const account = await env.DB.prepare('SELECT * FROM accounts WHERE username=?').bind(username).first<Account>();
        const dummy = 'AAAAAAAAAAAAAAAAAAAAAA==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        const valid = await verifyPassword(provided, account?.password_hash || dummy);
        if (!account || !account.active || (account as Account & {
            deleted_at?: string;
        }).deleted_at || !valid)
            throw new ApiError(401, '아이디 또는 비밀번호를 확인해 주세요.');
        const token = base64(crypto.getRandomValues(new Uint8Array(32)));
        await env.DB.batch([
            env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username),
            env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(clock),
            env.DB.prepare('DELETE FROM sessions WHERE account_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY expires_at DESC LIMIT 4)').bind(account.id, account.id),
            env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await digest(token), account.id, clock + sessionSeconds * 1000),
            audit(env, account.id, 'login', account.id),
        ]);
        return send({ user: await publicAccount(account, env) }, 200, { 'Set-Cookie': cookie(token, request) });
    }
    const account = await authenticate(request, env);
    if (path === '/api/session' && method === 'GET')
        return send({ user: await publicAccount(account, env) });
    if (path === '/api/logout' && method === 'POST') {
        const token = sessionToken(request) || '';
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
        return send({ ok: true }, 200, { 'Set-Cookie': cookie('', request, 0) });
    }
    if (path === '/api/password' && method === 'POST') {
        const body = await jsonBody(request);
        if (!await verifyPassword(text(body.current, '현재 비밀번호', 128, true), account.password_hash))
            throw new ApiError(401, '현재 비밀번호가 다릅니다.');
        await env.DB.batch([
            env.DB.prepare('UPDATE accounts SET password_hash=? WHERE id=?').bind(await passwordHash(password(body.password)), account.id),
            env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(account.id), audit(env, account.id, 'password-changed', account.id)
        ]);
        return send({ ok: true }, 200, { 'Set-Cookie': cookie('', request, 0) });
    }
    if (path === '/api/accounts') {
        requireAdmin(account);
        if (method === 'GET') {
            const result = await env.DB.prepare(account.role === 'owner' ? 'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at LIMIT 500' : "SELECT * FROM accounts WHERE role<>'owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 500").all<Account>();
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
            await env.DB.batch([env.DB.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').bind(userId, username, await seal(name, env), hash, role, now()), audit(env, account.id, 'account-created', userId)]);
            return send({ ok: true }, 201);
        }
    }
    const accountMatch = /^\/api\/accounts\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (accountMatch && method === 'PATCH') {
        requireAdmin(account);
        const target = id(accountMatch[1]), body = await jsonBody(request);
        if (target === account.id)
            throw new ApiError(400, '본인 계정은 이 메뉴에서 변경할 수 없습니다.');
        const targetAccount = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(target).first<Account>();
        if (!targetAccount || targetAccount.role === 'owner' || (targetAccount.role === 'admin' && account.role !== 'owner'))
            throw new ApiError(404, '점검자 계정이 없습니다.');
        if (typeof body.active === 'boolean')
            await env.DB.batch([env.DB.prepare('UPDATE accounts SET active=? WHERE id=?').bind(body.active ? 1 : 0, target), env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(target), audit(env, account.id, body.active ? 'account-enabled' : 'account-disabled', target)]);
        else if (body.password)
            await env.DB.batch([env.DB.prepare('UPDATE accounts SET password_hash=? WHERE id=?').bind(await passwordHash(password(body.password)), target), env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(target), audit(env, account.id, 'password-reset', target)]);
        else
            throw new ApiError(400, '변경할 값을 확인해 주세요.');
        return send({ ok: true });
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
        requireAdmin(account);
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
        if (account.role !== 'inspector')
            throw new ApiError(403, '관리 계정은 일반 점검자로 연결하지 않습니다.');
        return listRecords(request, env, account);
    }
    if (path === '/api/admin/records' && method === 'GET') {
        requireAdmin(account);
        return listRecords(request, env, account, true);
    }
    const recordMatch = /^\/api\/records\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (recordMatch && (method === 'PUT' || method === 'DELETE')) {
        if (account.role !== 'inspector')
            throw new ApiError(403, '관리 계정은 일반 점검자로 연결하지 않습니다.');
        const recordId = id(recordMatch[1]), body = await jsonBody(request), expected = revision(body.revision), at = now(), operation = crypto.randomUUID();
        const value = method === 'PUT' ? record(body.record) : null;
        if (value && value.id !== recordId)
            throw new ApiError(400, '점검표 식별번호가 다릅니다.');
        const payload = await seal(value, env), deleted = method === 'DELETE' ? 1 : 0;
        // Existing rows are updated only at the revision read by this client. Audit is part of the same transaction.
        const result = await env.DB.batch([
            expected === 0
                ? env.DB.prepare('INSERT INTO inspections(id,account_id,payload,revision,deleted,operation_id,updated_at) SELECT ?,?,?,1,?,?,? WHERE ?=0 ON CONFLICT(id) DO NOTHING').bind(recordId, account.id, payload, deleted, operation, at, deleted)
                : env.DB.prepare('UPDATE inspections SET payload=?,revision=revision+1,deleted=?,operation_id=?,updated_at=? WHERE id=? AND account_id=? AND revision=?').bind(payload, deleted, operation, at, recordId, account.id, expected),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)')
                .bind(crypto.randomUUID(), account.id, deleted ? 'inspection-deleted' : 'inspection-saved', recordId, at, recordId, operation),
        ]);
        if (result[0].meta.changes !== 1)
            throw new ApiError(409, '다른 기기에서 변경되었거나 접근할 수 없는 점검표입니다.');
        return send({ revision: expected + 1, updated: at });
    }
    if (path === '/api/photos' || path.startsWith('/api/photos/'))
        throw new ApiError(410, '서버 사진 저장은 사용하지 않습니다. 사진은 촬영한 기기에 보관됩니다.');
    const ownerRecord = /^\/api\/owner\/records\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (ownerRecord && method === 'DELETE') {
        if (account.role !== 'owner')
            throw new ApiError(403, '최상위 운영자만 다른 사람의 기록을 삭제할 수 있습니다.');
        const recordId = id(ownerRecord[1]), body = await jsonBody(request), expected = revision(body.revision);
        const reason = text(body.reason, '삭제 사유', 1000, true);
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
            env.DB.prepare('UPDATE inspections SET payload=?,revision=revision+1,deleted=1,operation_id=?,updated_at=? WHERE id=? AND revision=? AND deleted=0').bind(payload, operation, at, recordId, expected),
            env.DB.prepare('INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(crypto.randomUUID(), account.id, recordId, 'record-deleted', await seal({ reason, accountId: existing.account_id, name: (await open<{
                    site?: {
                        name?: string;
                    };
                    date?: string;
                }>(existing.payload, env))?.site?.name || recordId }, env), at, recordId, operation),
            env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)').bind(crypto.randomUUID(), account.id, 'owner-deleted-record', recordId, at, recordId, operation),
        ]);
        if (results[0].meta.changes !== 1)
            throw new ApiError(409, '기록이 변경되었거나 이미 삭제되었습니다. 다시 불러와 주세요.');
        return send({ revision: expected + 1 });
    }
    const ownerAccount = /^\/api\/owner\/accounts\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (ownerAccount && method === 'DELETE') {
        if (account.role !== 'owner')
            throw new ApiError(403, '최상위 운영자만 점검자를 삭제할 수 있습니다.');
        const target = id(ownerAccount[1]), body = await jsonBody(request), reason = text(body.reason, '삭제 사유', 1000, true);
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
            env.DB.prepare('UPDATE inspections SET payload=?,deleted=1,revision=revision+1,operation_id=?,updated_at=? WHERE account_id=? AND deleted=0').bind(await seal(null, env), operation, at, target),
            env.DB.prepare('INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), account.id, target, 'account-deleted', await seal({ reason, name: await open(person.display_name, env), recordCount: count?.total || 0 }, env), at),
            audit(env, account.id, 'owner-deleted-account', target),
        ]);
        return send({ ok: true, deletedRecords: count?.total || 0 });
    }
    if (path === '/api/owner/history' && method === 'GET') {
        if (account.role !== 'owner')
            throw new ApiError(403, '최상위 운영자만 확인할 수 있습니다.');
        const rows = await env.DB.prepare('SELECT * FROM owner_actions ORDER BY at DESC LIMIT 200').all<{
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
        requireAdmin(account);
        const rows = await env.DB.prepare('SELECT actor_id,action,target_id,at FROM audit ORDER BY at DESC LIMIT 200').all();
        return send({ events: rows.results });
    }
    throw new ApiError(404, '지원하지 않는 요청입니다.');
}
function secureResponse(response: Response, request: Request): Response {
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
