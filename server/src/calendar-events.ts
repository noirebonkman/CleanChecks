import type { Environment } from './bindings';
import { open } from './security';

const editorLease = 40_000;
type SocketState = {
    expiresAt: number;
    session: string;
    actor: string;
    encryptedName: string;
    editingUntil: number;
    item?: string;
};

type CalendarSocket = WebSocket & {
    serializeAttachment(value: SocketState): void;
    deserializeAttachment(): unknown;
};
type SocketContext = {
    acceptWebSocket(socket: CalendarSocket): void;
    getWebSockets(): CalendarSocket[];
};
declare const WebSocketPair: new () => { 0: WebSocket; 1: CalendarSocket };

function stateOf(socket: CalendarSocket): SocketState | undefined {
    const stored = socket.deserializeAttachment();
    // A live connection opened before this release only has the expiry timestamp.
    if (typeof stored === 'number') return {expiresAt:stored,session:'',actor:'',encryptedName:'',editingUntil:0};
    return stored ? stored as SocketState : undefined;
}

export class CalendarEvents {
    private presenceRevision = 0;
    constructor(private readonly context: SocketContext, private readonly env: Environment) {}

    async fetch(request: Request): Promise<Response> {
        if (request.method === 'POST') {
            for (const socket of this.context.getWebSockets()) {
                try {
                    if ((stateOf(socket)?.expiresAt || 0) <= Date.now()) socket.close(1008,'Session expired');
                    else socket.send('calendar-changed');
                } catch {
                    // A disconnected viewer must not interrupt other viewers.
                }
            }
            return new Response(null,{status:204});
        }

        const expiresAt = Number(request.headers.get('X-Calendar-Session-Expires'));
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
            return new Response('WebSocket upgrade required',{status:426});
        const {0:client,1:server} = new WebSocketPair();
        this.context.acceptWebSocket(server);
        server.serializeAttachment({
            expiresAt,
            session:request.headers.get('X-Calendar-Session') || '',
            actor:request.headers.get('X-Calendar-Editor') || '',
            encryptedName:request.headers.get('X-Calendar-Editor-Name') || '',
            editingUntil:0,
        });
        await this.publishEditors();
        return new Response(null,{status:101,webSocket:client} as ResponseInit & {webSocket:WebSocket});
    }

    async webSocketMessage(socket: CalendarSocket, message: string | ArrayBuffer) {
        if (typeof message !== 'string') return;
        const stopping = message === 'viewing';
        const item = message.startsWith('editing:') ? message.slice(8) : '';
        if (!stopping && message !== 'editing' && !/^[\w-]{1,100}@(\d{4}-\d{2}-\d{2})?$/.test(item)) return;
        const state = stateOf(socket), now = Date.now();
        if (!state?.actor || !state.session || state.expiresAt <= now) return;
        if (stopping ? !state.editingUntil : (state.item || '') === item && state.editingUntil > now + editorLease - 8_000) return;
        state.item = item;
        state.editingUntil = stopping ? 0 : Math.min(now + editorLease,state.expiresAt);
        socket.serializeAttachment(state);
        await this.publishEditors();
    }

    private async publishEditors(exclude?: CalendarSocket) {
        const revision = ++this.presenceRevision;
        const now = Date.now();
        const clients = this.context.getWebSockets().flatMap(socket => {
            if (socket === exclude || socket.readyState !== 1) return [];
            const state = stateOf(socket);
            return state?.session && state.expiresAt > now ? [{socket,state}] : [];
        });
        const hasEditors = clients.some(({state}) => state.editingUntil > now);
        const allowed = hasEditors ? await Promise.all(clients.map(async ({socket,state}) => {
            try {
                const active = await this.env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?')
                    .bind(state.session,now).first();
                return active ? {socket,state} : null;
            } catch { return null; }
        })) : clients;
        const byActor = new Map<string,{state:SocketState;items:Map<string,number>}>();
        for (const client of allowed) {
            const state = client?.state;
            if (!state?.actor || state.editingUntil <= now) continue;
            const editor = byActor.get(state.actor) ?? {state,items:new Map<string,number>()};
            if (editor.state.editingUntil < state.editingUntil) editor.state = state;
            if (state.item && (editor.items.get(state.item) || 0) < state.editingUntil)
                editor.items.set(state.item,state.editingUntil);
            byActor.set(state.actor,editor);
        }
        const decoded = await Promise.all([...byActor.values()].map(async ({state,items}) => {
            try { return {name:await open<string>(state.encryptedName,this.env),until:state.editingUntil,items}; }
            catch { return null; }
        }));
        if (revision !== this.presenceRevision) return;
        const sentAt = Date.now();
        const editors = decoded.flatMap(editor => editor && editor.until > sentAt
            ? [{name:editor.name,remaining:editor.until - sentAt,items:[...editor.items].flatMap(([key,until]) =>
                until > sentAt ? [{key,remaining:until - sentAt}] : [])}] : []);
        const message = JSON.stringify({type:'calendar-editors',editors});
        for (const client of allowed) {
            try { client?.socket.send(message); }
            catch { /* The connection may have closed during the lookup. */ }
        }
    }

    async webSocketClose(socket: CalendarSocket, code: number, reason: string) {
        try { socket.close(code,reason); }
        finally { await this.publishEditors(socket); }
    }
    async webSocketError(socket: CalendarSocket) {
        try { socket.close(1011,'Connection interrupted'); }
        finally { await this.publishEditors(socket); }
    }
}

export function calendarEventHub(env: Environment) {
    return env.CALENDAR_EVENTS?.get(env.CALENDAR_EVENTS.idFromName('calendar'));
}

export async function publishCalendarChange(env: Environment) {
    try {
        await calendarEventHub(env)?.fetch(new Request('https://calendar.internal/changed',{method:'POST'}));
    } catch {
        // Schedule writes have already committed. The client can reconcile by fetching.
    }
}
