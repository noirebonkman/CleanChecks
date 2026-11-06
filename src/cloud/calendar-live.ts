import { useEffect, useRef } from 'react';

export function useCalendarLive(onChange: () => void) {
    const handler = useRef(onChange);
    handler.current = onChange;
    const connected = useRef(false);

    useEffect(() => {
        if (typeof WebSocket === 'undefined') return;
        let socket: WebSocket | undefined;
        let timer: number | undefined;
        let closed = false;
        let retry = 1000;
        const endpoint = new URL('/api/calendar/events',window.location.href);
        endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

        function connect() {
            if (closed || socket || !navigator.onLine) return;
            try { socket = new WebSocket(endpoint); }
            catch { scheduleReconnect(); return; }
            socket.onopen = () => {
                connected.current = true;
                retry = 1000;
                handler.current();
            };
            socket.onmessage = event => {
                if (event.data === 'calendar-changed') handler.current();
            };
            socket.onclose = () => {
                socket = undefined;
                connected.current = false;
                scheduleReconnect();
            };
        }
        function scheduleReconnect() {
            if (closed || timer !== undefined) return;
            timer = window.setTimeout(() => { timer = undefined; connect(); },retry);
            retry = Math.min(30000,retry * 2);
        }
        window.addEventListener('online',connect);
        connect();
        return () => {
            closed = true;
            connected.current = false;
            window.clearTimeout(timer);
            window.removeEventListener('online',connect);
            if (socket) {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onclose = null;
                socket.close();
            }
        };
    },[]);

    return connected;
}
