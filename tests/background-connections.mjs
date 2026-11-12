import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

mkdirSync('.test-work', { recursive: true });
await build({ entryPoints: ['src/cloud/session-monitor.ts'], outfile: '.test-work/session-monitor.mjs', bundle: true, platform: 'node', format: 'esm' });
const { monitorSession } = await import('../.test-work/session-monitor.mjs');
const originalFetch = globalThis.fetch;
globalThis.window = new EventTarget();
const documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
const user = { id: 'worker', username: 'worker', name: '점검자', role: 'inspector', active: true };
let current = user, expiry = null, clock = 0, online = true, interval, stopped = false, invalidated = 0;
const pending = [];
globalThis.fetch = (_, options) => new Promise((resolve, reject) => {
    pending.push({ resolve, signal: options.signal });
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
});
const environment = {
    window, document: documentEvents, online: () => online, now: () => clock,
    startTimer(callback) { interval = callback; return 7; },
    stopTimer(value) { assert.equal(value, 7); stopped = true; },
};
const stop = monitorSession({ currentUser: () => current, expiresAt: () => expiry, invalidate: () => invalidated++ }, environment);
const settle = () => new Promise(resolve => setImmediate(resolve));
interval();
window.dispatchEvent(new Event('online'));
documentEvents.dispatchEvent(new Event('visibilitychange'));
assert.equal(pending.length, 1, 'Resume and timer events must share one in-flight session request');
pending[0].resolve(Response.json({ user }));
await settle();
assert.equal(invalidated, 0);
documentEvents.visibilityState = 'hidden';
interval();
assert.equal(pending.length, 1, 'Hidden tabs must not poll the session');
documentEvents.visibilityState = 'visible'; online = false; interval();
assert.equal(pending.length, 1, 'Offline tabs must not poll the session');
online = true; window.dispatchEvent(new Event('online'));
assert.equal(pending.length, 2);
pending[1].resolve(Response.json({ user: { ...user, role: 'admin' } }));
await settle();
assert.equal(invalidated, 1, 'Role changes must invalidate the old workspace');
documentEvents.visibilityState = 'hidden'; expiry = 100; clock = 100; interval();
assert.equal(invalidated, 2, 'Fixed expiry must still apply while hidden/offline');
assert.equal(pending.length, 2);
expiry = null; documentEvents.visibilityState = 'visible'; interval();
current = { ...user, id: 'another-account' };
pending[2].resolve(Response.json({ user: { ...user, role: 'admin' } }));
await settle();
assert.equal(invalidated, 2, 'A stale response must not log a different account out');
interval();
stop();
assert(stopped && pending[3].signal.aborted, 'Unmount must abort pending requests and remove the timer');
await settle();
window.dispatchEvent(new Event('online')); interval();
assert.equal(pending.length, 4);
console.log('PASS: one foreground session request, immediate resume, offline preservation, fixed expiry, account-switch isolation and cleanup');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, screen, act, cleanup } = await import('@testing-library/react');
const sockets = [];
class TestSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.messages = []; sockets.push(this); }
    send(message) { assert.equal(this.readyState, 1); this.messages.push(message); }
    open() { this.readyState = 1; this.onopen?.(); }
    close() { this.readyState = 3; this.onclose?.(); }
}
globalThis.WebSocket = TestSocket;
await build({ entryPoints: ['src/cloud/calendar-live.ts', 'src/cloud/Turnstile.tsx'], outdir: '.test-work/background-ui', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
const { useCalendarLive } = await import('../.test-work/background-ui/calendar-live.js');
const { Turnstile } = await import('../.test-work/background-ui/Turnstile.js');
let refreshes = 0;
function CalendarConnection({ editing }) {
    const live = useCalendarLive(() => refreshes++, editing);
    return React.createElement('output', null, JSON.stringify(live.editors));
}
try {
    const mounted = render(React.createElement(CalendarConnection, { editing: null }));
    assert.equal(sockets.length, 1);
    await act(async () => sockets[0].open());
    assert.equal(sockets[0].messages.at(-1), 'viewing', 'Simply viewing must never announce an editor');
    mounted.rerender(React.createElement(CalendarConnection, { editing: 'visit@2026-11-12' }));
    assert.equal(sockets[0].messages.at(-1), 'editing:visit@2026-11-12');
    await act(async () => sockets[0].onmessage({ data: JSON.stringify({ type: 'calendar-editors', editors: [{ name: '일정 관리자', remaining: 5000, items: [{ key: 'visit@2026-11-12', remaining: 5000 }] }] }) }));
    assert.match(screen.getByRole('status').textContent, /일정 관리자/);
    await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(sockets[0].messages.at(-1), 'viewing');
    await act(async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
    });
    assert.equal(sockets[0].readyState, 3);
    assert.equal(screen.getByRole('status').textContent, '[]', 'Disconnected editors must not remain visible');
    await act(async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        window.dispatchEvent(new Event('online'));
        sockets[1].open();
    });
    assert.equal(sockets.length, 2);
    assert.equal(sockets[1].messages.at(-1), 'viewing');
    const previousRefreshes = refreshes;
    await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(sockets[1].messages.at(-1), 'editing:visit@2026-11-12');
    assert(refreshes > previousRefreshes, 'Returning to the app must request fresh schedules');
    mounted.unmount();
    assert.equal(sockets[1].readyState, 3);
    window.dispatchEvent(new Event('online'));
    assert.equal(sockets.length, 2, 'Unmounted calendars must not reconnect');
    console.log('PASS: viewer/editor separation, hidden presence release, offline cleanup, immediate reconnect, foreground refresh and socket teardown');

    function RecentConnection({enabled}) {
        useCalendarLive(()=>refreshes++,null,'inspections-changed',enabled);
        return null;
    }
    const recent = render(React.createElement(RecentConnection,{enabled:true}));
    const recentSocket = sockets.at(-1);
    await act(async()=>recentSocket.open());
    const baseline=refreshes;
    await act(async()=>recentSocket.onmessage({data:'calendar-changed'}));
    assert.equal(refreshes,baseline);
    await act(async()=>recentSocket.onmessage({data:'inspections-changed'}));
    assert.equal(refreshes,baseline+1);
    assert.equal(recentSocket.messages.at(-1),'viewing');
    recent.rerender(React.createElement(RecentConnection,{enabled:false}));
    assert.equal(recentSocket.readyState,3);
    recent.unmount();
    console.log('PASS: recent-inspection events refresh the shared feed without announcing an editor; collapsing disconnects it');

    const widgets = [];
    window.turnstile = { render(_, options) { widgets.push(options); return String(widgets.length); }, remove() {} };
    const tokens = [], errors = [];
    const challenge = render(React.createElement(Turnstile, { siteKey: 'test', onToken: value => tokens.push(value), onError: value => errors.push(value) }));
    await act(settle);
    assert.equal(widgets.length, 1);
    widgets[0].callback('valid');
    assert.deepEqual(tokens, ['valid']);
    challenge.unmount();
    widgets[0].callback('stale'); widgets[0]['expired-callback'](); widgets[0]['error-callback']();
    assert.deepEqual(tokens, ['valid']); assert.deepEqual(errors, []);
    console.log('PASS: removed access-check widgets cannot overwrite a fresh login token or display stale errors');
} finally {
    cleanup(); dom.window.close(); globalThis.fetch = originalFetch;
}
