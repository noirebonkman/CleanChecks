import { useEffect, useRef, useState } from 'react';

const editorPulse = 15_000;
type ItemLease = {key:string;remaining:number};
type EditorLease = {name:string;remaining:number;items?:ItemLease[]};
type ActiveEditor = {name:string;items:string[]};

// null is viewing, an empty string is creating a new schedule.
export function useCalendarLive(onChange: () => void, editingItem: string | null) {
    const handler = useRef(onChange);
    handler.current = onChange;
    const connected = useRef(false);
    const editingRef = useRef(editingItem);
    const publish = useRef<() => void>(() => {});
    const [editors,setEditors] = useState<ActiveEditor[]>([]);

    useEffect(() => {
        editingRef.current = editingItem;
        publish.current();
    },[editingItem]);

    useEffect(() => {
        if (typeof WebSocket === 'undefined') return;
        let socket: WebSocket | undefined;
        let timer: number | undefined;
        let expiryTimer: number | undefined;
        let closed = false;
        let retry = 1000;
        const endpoint = new URL('/api/calendar/events',window.location.href);
        endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

        function sendEditing() {
            if (socket?.readyState !== WebSocket.OPEN) return;
            const item = editingRef.current;
            socket.send(item === null || document.visibilityState !== 'visible' ? 'viewing' : item ? 'editing:' + item : 'editing');
        }
        function receiveEditors(message: string) {
            let data: {type?:string;editors?:EditorLease[]};
            try { data = JSON.parse(message); }
            catch { return; }
            if (data?.type !== 'calendar-editors' || !Array.isArray(data.editors)) return;
            const now = Date.now();
            const leases = data.editors.filter(editor => typeof editor?.name === 'string' &&
                Number.isFinite(editor.remaining) && editor.remaining > 0)
                .map(editor => ({
                    name:editor.name,until:now + Math.min(editor.remaining,40_000),
                    items:Array.isArray(editor.items) ? editor.items.filter(item => typeof item?.key === 'string' &&
                        Number.isFinite(item.remaining) && item.remaining > 0)
                        .map(item => ({key:item.key,until:now + Math.min(item.remaining,40_000)})) : [],
                }));
            function update() {
                const clock = Date.now();
                const active = leases.filter(editor => editor.until > clock).map(editor => ({
                    ...editor,items:editor.items.filter(item => item.until > clock),
                }));
                setEditors(active.map(editor => ({name:editor.name,items:editor.items.map(item => item.key)})));
                const next = Math.min(...active.flatMap(editor => [editor.until,...editor.items.map(item => item.until)]));
                if (Number.isFinite(next)) expiryTimer = window.setTimeout(update,Math.max(1,next - Date.now()));
            }
            window.clearTimeout(expiryTimer);
            update();
        }
        publish.current = sendEditing;
        document.addEventListener('visibilitychange',sendEditing);
        const heartbeat = window.setInterval(() => { if (editingRef.current !== null && document.visibilityState === 'visible') sendEditing(); },editorPulse);

        function connect() {
            if (closed || socket || !navigator.onLine) return;
            try { socket = new WebSocket(endpoint); }
            catch { scheduleReconnect(); return; }
            socket.onopen = () => {
                connected.current = true;
                retry = 1000;
                handler.current();
                sendEditing();
            };
            socket.onmessage = event => {
                if (event.data === 'calendar-changed') handler.current();
                else if (typeof event.data === 'string') receiveEditors(event.data);
            };
            socket.onclose = () => {
                socket = undefined;
                connected.current = false;
                window.clearTimeout(expiryTimer);
                setEditors([]);
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
            window.clearTimeout(expiryTimer);
            window.clearInterval(heartbeat);
            document.removeEventListener('visibilitychange',sendEditing);
            publish.current = () => {};
            window.removeEventListener('online',connect);
            if (socket) {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onclose = null;
                socket.close();
            }
        };
    },[]);

    return {connected,editors};
}
