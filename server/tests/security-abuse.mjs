import { migrationStatements, applyMigration } from './migration-helpers.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { build } from '../../node_modules/esbuild/lib/main.js';
import { Miniflare } from 'miniflare';

mkdirSync('.test-work', { recursive:true });
for (const name of ['worker','validation','calendar-events','request-protection','login-protection']) await build({
    entryPoints:['src/'+name+'.ts'], outfile:'.test-work/security-'+name+'.mjs',
    bundle:true, format:'esm', platform:'browser',
});
const { readBody } = await import('../.test-work/security-validation.mjs');
const { checkRequestRate } = await import('../.test-work/security-request-protection.mjs');
const { verifyChallenge } = await import('../.test-work/security-login-protection.mjs');
const { CalendarEvents } = await import('../.test-work/security-calendar-events.mjs');
let failed = 0;
async function check(label, test) {
    try { await test(); console.log('PASS: '+label); }
    catch (error) { failed++; console.error('FAIL: '+label+' — '+error.message); }
}

await check('oversized streaming bodies stop within a fixed drain budget', async () => {
    let pulls = 0, cancelled = false;
    const stream = new ReadableStream({
        pull(controller) { pulls++; controller.enqueue(new Uint8Array(2048)); },
        cancel() { cancelled = true; },
    });
    await assert.rejects(() => readBody(new Request('https://local.test/api/login', {
        method:'POST', body:stream, duplex:'half',
    }), 1024), error => error.status === 413);
    assert.equal(cancelled, true); assert(pulls <= 131);
});
await check('edge limits reject request floods without storing raw addresses or making database calls', async () => {
    let counter = 0; const keys = [];
    const limiter = {limit:async ({key})=>{keys.push(key);return {success:++counter<=3};}};
    const env = {AUTH_REQUEST_LIMITER:limiter,APP_DATA_KEY:'test-secret'};
    const request = new Request('https://local.test/api/login',{headers:{'CF-Connecting-IP':'192.0.2.123'}});
    for (let i=0;i<3;i++) await checkRequestRate(request,env,true);
    await assert.rejects(()=>checkRequestRate(request,env,true),error=>error.status === 429);
    assert(keys.every(key=>!key.includes('192.0.2.123') && key.length === 44));
    await assert.rejects(()=>checkRequestRate(request,{...env,AUTH_REQUEST_LIMITER:{limit:async()=>{throw Error();}}},true),error=>error.status===503);
});
await check('production bot protection fails closed when configuration or upstream JSON is broken', async () => {
    const request = new Request('https://local.test/api/login');
    await assert.rejects(()=>verifyChallenge(request,'token',{REQUIRE_TURNSTILE:'true'}),error=>error.status===503);
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async()=>new Response('not-json');
        await assert.rejects(()=>verifyChallenge(request,'token',{TURNSTILE_SITE_KEY:'public',TURNSTILE_SECRET_KEY:'secret'}),error=>error.status===503);
    } finally { globalThis.fetch=original; }
});
await check('oversized realtime messages and floods close only the offending connection', async () => {
    let queries = 0;
    function socket() { return {readyState:1,state:{expiresAt:Date.now()+60000,session:'test-session',actor:'',encryptedName:'',editingUntil:0},
        serializeAttachment(value){this.state=value;},deserializeAttachment(){return this.state;},close(code){this.code=code;}}; }
    const hub = new CalendarEvents({getWebSockets:()=>[]},{DB:{prepare(){queries++;throw Error('Unexpected query');}}});
    const oversized = socket(); await hub.webSocketMessage(oversized,'x'.repeat(513)); assert.equal(oversized.code,1009);
    const flood = socket(); for (let i=0;i<21;i++) await hub.webSocketMessage(flood,'invalid');
    assert.equal(flood.code,1008); assert.equal(queries,0);
    const normal = socket(); await hub.webSocketMessage(normal,'viewing'); assert.equal(normal.code,undefined);
});
await check('realtime tab floods are bounded per session before a socket is accepted', async () => {
    const peers = Array.from({length:4},()=>({readyState:1,deserializeAttachment:()=>({session:'same-session'})}));
    const hub = new CalendarEvents({getWebSockets:()=>peers},{});
    const response = await hub.fetch(new Request('https://calendar.internal/events',{headers:{
        Upgrade:'websocket','X-Calendar-Session':'same-session','X-Calendar-Session-Expires':String(Date.now()+60000),
    }}));
    assert.equal(response.status,429);
});

const host = 'https://abuse-test.example.workers.dev';
const secret = randomBytes(32).toString('hex');
let siteverifyCalls = 0;
const mf = new Miniflare({ modules:true, scriptPath:'.test-work/security-worker.mjs',
    compatibilityDate:'2026-08-01', d1Databases:{DB:'isolated-security-audit'},
    bindings:{APP_DATA_KEY:randomBytes(32).toString('base64'), SETUP_TOKEN:secret,
        TURNSTILE_SITE_KEY:'audit-public', TURNSTILE_SECRET_KEY:'audit-private'},
    outboundService:async request => {
        assert.equal(new URL(request.url).hostname, 'challenges.cloudflare.com');
        siteverifyCalls++;
        const body = await request.formData(), token = body.get('response');
        return Response.json({success:token === 'valid-login' || token === 'valid-access',
            hostname:new URL(host).hostname, action:token === 'valid-access' ? 'access' : 'login'});
    },
});
const db = await mf.getD1Database('DB');
async function call(path, {method='GET',body,cookie,headers={}} = {}) {
    return mf.dispatchFetch(host+'/api/'+path, {method,
        headers:{Origin:host, ...(body !== undefined ? {'Content-Type':'application/json'} : {}),
            ...(cookie ? {Cookie:cookie} : {}), ...headers},
        ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
    });
}
async function status(path, expected, options) {
    const response = await call(path, options);
    assert.equal(response.status, expected, await response.text());
}
try {
    for (const name of readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort())
        for (const sql of migrationStatements(readFileSync('migrations/'+name,'utf8')).filter(sql=>sql.trim()))
            await db.prepare(sql).run();
    await check('invalid bot tokens cannot exhaust the shared login allowance', async () => {
        await status('access-check', 403, {method:'POST',body:{challenge:'invalid-token'}});
        const row = await db.prepare("SELECT failures FROM login_attempts WHERE username='@login-burst'").first();
        assert.equal(row?.failures ?? 0, 0);
    });
    await check('authentication rejects an oversized body before external verification or database work', async () => {
        const before = siteverifyCalls;
        await status('login', 413, {method:'POST',body:{challenge:'valid-login',extra:'x'.repeat(20000)}});
        assert.equal(siteverifyCalls, before);
    });
    await check('forged sessions and unauthenticated data/privilege requests are denied', async () => {
        for (const path of ['session','records','admin/records','accounts','people','sites','owner/history','owner/trash','audit','calendar?month=2026-11'])
            await status(path,401,{cookie:'__Host-cleanchecks_session=forged-token'});
        await status('accounts/fake/permissions',401,{method:'PATCH',body:{role:'owner',permissions:{manageUsers:true}}});
    });
    await check('cross-site JSON, missing origins and non-JSON form attacks are blocked', async () => {
        await status('login',403,{method:'POST',headers:{Origin:'https://attacker.example'},body:{}});
        await status('login',403,{method:'POST',headers:{Origin:''},body:{}});
        await status('login',403,{method:'POST',headers:{'Sec-Fetch-Site':'cross-site'},body:{}});
        await status('login',415,{method:'POST',headers:{'Content-Type':'text/plain'},body:{}});
    });
    await check('access tokens cannot be reused as login tokens', async () => {
        await status('login',403,{method:'POST',body:{challenge:'valid-access',username:'ludmin',password:'audit-password'}});
    });
    await check('unknown accounts and SQL payloads do not expose internal exceptions', async () => {
        const response = await call('login',{method:'POST',body:{challenge:'valid-login',username:"' OR 1=1 --",password:'wrong-password'}});
        assert.equal(response.status,400);
        assert(!/SELECT|sqlite|password_hash|audit-private/i.test(await response.text()));
    });
    await check('successful auth uses server sessions; hostile names remain JSON and sensitive responses cannot be cached', async () => {
        await status('setup',201,{method:'POST',body:{challenge:'valid-login',setupToken:secret,username:'ludmin',name:'<img src=x onerror=alert(1)>',password:'Audit-password-12345'}});
        const response = await call('login',{method:'POST',body:{challenge:'valid-login',username:'ludmin',password:'Audit-password-12345'}});
        assert.equal(response.status,200);
        const header = response.headers.get('set-cookie');
        for (const attribute of ['__Host-cleanchecks_session=','HttpOnly','Secure','SameSite=Strict']) assert(header.includes(attribute));
        assert.equal(response.headers.get('cache-control'),'no-store');
        assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        assert(response.headers.get('content-type').includes('application/json'));
        const data = await response.json();
        assert.equal(data.user.name,'<img src=x onerror=alert(1)>');
        assert(!JSON.stringify(data).includes('password_hash'));
        const cookie = header.split(';')[0];
        const restored = await call('access-check',{method:'POST',cookie,body:{challenge:'valid-access'}});
        assert.equal(restored.status,200);
        assert.equal((await restored.json()).user.id,data.user.id);
        await status('accounts',403,{method:'POST',cookie,headers:{Origin:'https://attacker.example'},body:{}});
        await status('logout',200,{method:'POST',cookie,body:{}});
        await status('session',401,{cookie});
        const revoked = await call('access-check',{method:'POST',cookie,body:{challenge:'valid-access'}});
        assert.equal((await revoked.json()).user,null);
    });
} finally { await mf.dispose(); }

if (failed) process.exitCode = 1;
else console.log('ATTACK REGRESSIONS PASSED');
