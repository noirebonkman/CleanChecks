import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync('.test-work', { recursive: true });
await build({ entryPoints: ['src/cloud/client.ts'], outfile: '.test-work/test-client.mjs', bundle: true, platform: 'node', format: 'esm' });
const { request, ServerError } = await import('../.test-work/test-client.mjs');
const originalFetch = globalThis.fetch, originalTimer = globalThis.setTimeout;
globalThis.window = new EventTarget();
let logout = 0;
window.addEventListener('cleanchecks:server-logout', () => logout++);
try {
    globalThis.fetch = async () => Response.json({ ok: true });
    assert.deepEqual(await request('test'), { ok: true });
    globalThis.fetch = async () => Response.json({ error: '로그인 필요' }, { status: 401 });
    await assert.rejects(request('session'), error => error instanceof ServerError && error.status === 401);
    assert.equal(logout, 1);
    globalThis.fetch = async () => { throw new TypeError('network failure'); };
    await assert.rejects(request('test'), /인터넷 연결/);
    globalThis.setTimeout = (fn, ms, ...args) => originalTimer(fn, ms === 20000 ? 5 : ms, ...args);
    globalThis.fetch = async (_, { signal }) => new Promise((_, reject) => {
        const fail = () => reject(signal.reason);
        if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
    });
    await assert.rejects(request('records'), /서버 응답이 늦어/);
    const controller = new AbortController(); controller.abort(Error('caller cancelled'));
    await assert.rejects(request('records', { signal: controller.signal }), /caller cancelled/);
    assert.equal(logout, 1, 'Connection errors must not log the account out');
    console.log('PASS: successful requests, session expiry, offline messages, bounded timeout and caller cancellation');
} finally {
    globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer; delete globalThis.window;
}
