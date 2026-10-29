import { useState, type FormEvent } from 'react';
import { post, request, type ServerUser } from './client';
import { listRemoteRecords, type RemoteRecord } from './synchronization';
type Event = {
    id: string;
    at: string;
    action: string;
    targetId: string;
    detail: {
        reason: string;
        name?: string;
        recordCount?: number;
    };
};
export function OwnerRecordTools() {
    const [rows, setRows] = useState<RemoteRecord[]>([]), [users, setUsers] = useState<ServerUser[]>([]), [events, setEvents] = useState<Event[]>([]);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const run = async (action: () => Promise<void>) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await action();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.');
        }
        finally {
            setBusy(false);
        }
    };
    const refresh = async () => {
        setRows((await listRemoteRecords('admin/records')).filter(row => !row.deleted));
        setUsers((await request<{
            users: ServerUser[];
        }>('accounts')).users);
    };
    const remove = (kind: 'records' | 'accounts') => async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget, values = new FormData(form), target = String(values.get('target'));
        await run(async () => {
            const row = rows.find(row => row.id === target);
            await post('owner/' + kind + '/' + target, { revision: row?.revision, reason: values.get('reason') }, 'DELETE');
            await refresh();
            form.reset();
            setMessage(kind === 'records' ? '서버 점검 기록을 삭제했습니다.' : '점검자 계정과 해당 계정의 서버 기록을 삭제했습니다.');
        });
    };
    return <details className="cloud-owner-tools"><summary>운영자 전용 관리</summary>
  {message && <p role="status">{message}</p>}{error && <p role="alert" className="cloud-error">{error}</p>}
  <div className="cloud-actions"><button disabled={busy} onClick={() => void run(refresh)}>점검자·기록 불러오기</button><button disabled={busy} onClick={() => void run(async () => setEvents((await request<{
            events: Event[];
        }>('owner/history')).events))}>상세 삭제 로그 확인</button></div>
  <form className="cloud-form" onSubmit={remove('records')}><fieldset disabled={busy}><legend>서버 점검 기록 삭제</legend>
   <label>삭제할 기록<select name="target" required><option value="">선택하세요</option>{rows.map(row => <option key={row.id} value={row.id}>{users.find(user => user.id === row.ownerId)?.name || row.ownerId} · {row.record?.site.name} · {row.record?.date.replace('T', ' ')}</option>)}</select></label>
   <label>삭제 사유<textarea name="reason" maxLength={1000} required/></label>
   <label><input type="checkbox" required/>선택한 서버 기록을 삭제하겠습니다.</label><button type="submit">점검 기록 삭제</button></fieldset></form>
  <form className="cloud-form" onSubmit={remove('accounts')}><fieldset disabled={busy}><legend>서버 점검자 삭제</legend>
   <label>삭제할 계정<select name="target" required><option value="">선택하세요</option>{users.filter(user => user.role !== 'owner').map(user => <option key={user.id} value={user.id}>{user.name} ({user.username}) · 기록 {rows.filter(row => row.ownerId === user.id).length}건</option>)}</select></label>
   <label>삭제 사유<textarea name="reason" maxLength={1000} required/></label>
   <label><input type="checkbox" required/>이 계정의 접속을 해제하고 서버 점검 기록도 함께 삭제하겠습니다.</label><button type="submit">점검자와 서버 기록 삭제</button></fieldset></form>
  <p className="hint">서버에서 삭제한 기록은 다음 동기화 때 기기에도 반영됩니다. 로그아웃한 기기의 로컬 기록을 원격으로 즉시 지우지는 않습니다.</p>
  {events.map(event => <details className="cloud-record" key={event.id}><summary>{new Date(event.at).toLocaleString('ko-KR')} · {event.action === 'account-deleted' ? '점검자 삭제' : '점검 기록 삭제'}</summary><p>대상: {event.detail.name || event.targetId}</p><p>사유: {event.detail.reason}</p>{event.detail.recordCount !== undefined && <p>삭제 기록: {event.detail.recordCount}건</p>}</details>)}
 </details>;
}
