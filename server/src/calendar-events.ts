import type { Environment } from './bindings';

type CalendarSocket = WebSocket & {
    serializeAttachment(value: number): void;
    deserializeAttachment(): unknown;
};
type SocketContext = {
    acceptWebSocket(socket: CalendarSocket): void;
    getWebSockets(): CalendarSocket[];
};
declare const WebSocketPair: new () => { 0: WebSocket; 1: CalendarSocket };

export class CalendarEvents {
    constructor(private readonly context: SocketContext) {}

    fetch(request: Request): Response {
        if (request.method === 'POST') {
            for (const socket of this.context.getWebSockets()) {
                try {
                    if (Number(socket.deserializeAttachment()) <= Date.now()) socket.close(1008,'Session expired');
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
        server.serializeAttachment(expiresAt);
        return new Response(null,{status:101,webSocket:client} as ResponseInit & {webSocket:WebSocket});
    }

    webSocketClose(socket: WebSocket, code: number, reason: string) { socket.close(code,reason); }
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
