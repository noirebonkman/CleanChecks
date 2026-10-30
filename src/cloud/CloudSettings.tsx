import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { State } from '../inspection-model';
import { makeStaff } from '../local-storage';
import { post, request, ServerError, type ServerUser } from './client';
import { listRemoteRecords, synchronizeCloud, resolveCloudConflict, type RemoteRecord } from './synchronization';
import './cloud-settings.css';
import { OwnerRecordTools } from './OwnerRecordTools';
type Props = {
    visible: boolean;
    data: State;
    getState: () => State;
    save: (next: State) => Promise<void>;
    onSession: (user: ServerUser | null) => void;
};
export function CloudSettings({ visible, data, getState, save, onSession }: Props) {
    const [user, setUser] = useState<ServerUser | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const [setup, setSetup] = useState(false), [staffId, setStaffId] = useState(''), [users, setUsers] = useState<ServerUser[]>([]), [logs, setLogs] = useState<Record<string, string>[]>([]), [remoteRecords, setRemoteRecords] = useState<RemoteRecord[]>([]);
    const [onlineTick, setOnlineTick] = useState(0);
    const [conflicts, setConflicts] = useState<string[]>([]);
    const running = useRef(false), access = useRef({ getState, save });
    access.current = { getState, save };
    const operation = async (action: () => Promise<void>) => {
        if (running.current)
            return;
        running.current = true;
        setBusy(true);
        setError('');
        try {
            await action();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : '서버 작업을 완료하지 못했습니다.');
            if (cause instanceof ServerError && cause.status === 401) {
                setUser(null);
                onSession(null);
            }
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    };
    const synchronize = () => operation(async () => {
        if (!user)
            return;
        const result = await synchronizeCloud(user, () => access.current.getState(), next => access.current.save(next));
        setConflicts(result.conflictIds);
        setMessage('서버에 보냄 ' + result.sent + '건 · 기기로 받음 ' + result.received + '건');
        if (result.conflicts.length)
            setError('양쪽에서 수정한 기록은 보존했습니다: ' + result.conflicts.join(', ') + '. 자동 덮어쓰기는 하지 않았습니다. 기기 기록을 백업한 뒤 아래에서 유지할 내용을 선택해 주세요.');
    });
    useEffect(() => {
        let active = true;
        request<{
            user: ServerUser;
        }>('session').then(value => {
            if (active) {
                if (value.user && ['owner', 'admin', 'inspector'].includes(value.user.role)) {
                    setUser(value.user);
                    onSession(value.user);
                }
            }
        }).catch(() => { });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        const online = () => setOnlineTick(value => value + 1);
        const visible = () => {
            if (document.visibilityState === 'visible')
                online();
        };
        window.addEventListener('online', online);
        document.addEventListener('visibilitychange', visible);
        return () => { window.removeEventListener('online', online); document.removeEventListener('visibilitychange', visible); };
    }, []);
    useEffect(() => { const logout = () => { setUser(null); onSession(null); setUsers([]); setLogs([]); setRemoteRecords([]); }; window.addEventListener('cleanchecks:server-logout', logout); return () => window.removeEventListener('cleanchecks:server-logout', logout); }, []);
    const signature = data.records.filter(record => record.staffId === data.cloud?.staffId).map(record => record.id + ':' + record.updated).sort().join('|');
    useEffect(() => {
        if (!user || user.role !== 'inspector' || !data.cloud?.automatic || data.cloud.userId !== user.id || !navigator.onLine)
            return;
        const timer = setTimeout(() => void synchronize(), 2500);
        return () => clearTimeout(timer);
    }, [user?.id, data.cloud?.automatic, signature, onlineTick]);
    const login = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget, fields = new FormData(form);
        await operation(async () => {
            const result = await post<{
                user: ServerUser;
            }>('login', { username: fields.get('username'), password: fields.get('password') });
            setUser(result.user);
            onSession(result.user);
            setMessage(result.user.role === 'inspector' ? '서버 로그인 완료. 본인 점검 기록을 연결해 주세요.' : '관리 권한으로 로그인했습니다. 점검자 연결 없이 관리 기능을 사용할 수 있습니다.');
            const link = access.current.getState().cloud;
            if (link?.userId === result.user.id)
                setStaffId(link.staffId);
            else
                setStaffId(access.current.getState().staff.find(person => person.name === result.user.name)?.id || 'new');
            form.reset();
        });
    };
    const linked = !!user && data.cloud?.userId === user.id;
    if (!visible)
        return null;
    return <section className="setting-card cloud-settings" aria-labelledby="cloud-heading">
  <h2 id="cloud-heading">서버 저장</h2>
  <p>점검 기록은 서버에 저장하고 사진은 촬영한 기기에만 보관합니다. 어드민·관리자는 점검자 연결 없이 관리 기능을 사용합니다.</p>
  <p className="hint">사진은 다른 기기나 관리자 화면으로 전송되지 않습니다. JPG·PDF 내보내기에는 이 기기의 사진이 포함됩니다.</p>
  {message && <p role="status">{message}</p>}{error && <p role="alert" className="cloud-error">{error}</p>}
  {user && conflicts.map(recordId => <form className="cloud-form" key={recordId} onSubmit={event => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                void operation(async () => { await resolveCloudConflict(recordId, String(fields.get('choice')) as 'server' | 'device', user, () => access.current.getState(), next => access.current.save(next)); setConflicts(value => value.filter(id => id !== recordId)); setMessage('선택한 내용을 반영했습니다. 지금 동기화를 눌러 서버 저장을 마무리하세요.'); });
            }}><fieldset disabled={busy}><legend>동시 수정: {data.records.find(record => record.id === recordId)?.site.name || recordId}</legend>
   <p className="hint">두 버전을 확인하고 기기 기록을 먼저 백업하세요. 선택하지 않은 내용은 덮어써질 수 있습니다.</p>
   <label>유지할 내용<select name="choice" required><option value="">선택하세요</option><option value="server">서버 내용으로 이 기기 기록 교체</option><option value="device">이 기기 내용으로 서버 기록 교체</option></select></label>
   <label><input type="checkbox" required/>교체할 내용과 백업을 확인했습니다.</label><button type="submit">선택한 내용 적용</button></fieldset></form>)}
  {!user ? <><form className="cloud-form" onSubmit={login}><fieldset disabled={busy}><legend>서버 로그인</legend>
   <label>서버 아이디<input name="username" autoComplete="username" required minLength={3}/></label>
   <label>서버 비밀번호<input name="password" type="password" autoComplete="current-password" required/></label>
   <button className="primary" type="submit">서버 로그인</button></fieldset></form>
   <button type="button" className="secondary" onClick={() => setSetup(value => !value)}>처음 서버를 설정하시나요?</button>
   {setup && <form className="cloud-form" onSubmit={event => {
                    event.preventDefault();
                    const form = event.currentTarget, fields = new FormData(form);
                    void operation(async () => { await post('setup', { setupToken: fields.get('token'), username: fields.get('username'), name: fields.get('name'), password: fields.get('password') }); setSetup(false); setMessage('관리자 계정이 생성되었습니다. 서버에 로그인해 주세요.'); form.reset(); });
                }}><fieldset disabled={busy}><legend>최초 관리자 만들기</legend>
    <p className="hint">초기 설정 코드는 서버의 SETUP_TOKEN입니다. 한 번만 사용할 수 있습니다.</p>
    <label>초기 설정 코드<input name="token" type="password" autoComplete="off" required minLength={32}/></label>
    <label>운영자 아이디<input name="username" defaultValue="ludmin" readOnly autoComplete="username" pattern="[a-z0-9][a-z0-9._-]{2,79}" required/></label>
    <label>표시할 이름<input name="name" required maxLength={100}/></label>
    <label>새 비밀번호<input name="password" type="password" autoComplete="new-password" minLength={12} required/></label>
    <button className="primary" type="submit">최초 관리자 생성</button></fieldset></form>}
  </> : <>
   <div className="cloud-status"><strong>{user.name}</strong><span>{user.role === 'owner' ? '최상위 운영자' : user.role === 'admin' ? '서버 관리자' : '서버 점검자'}</span></div>
   {user.role === 'inspector' && (!linked ? <div className="cloud-form"><label>이 서버 계정에 연결할 기기 점검자<select value={staffId} onChange={event => setStaffId(event.target.value)}>
    <option value="">선택하세요</option>{data.staff.filter(person => person.active).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="new">{user.name} 이름으로 새로 추가</option></select></label>
    <p className="hint">선택한 점검자의 기존 기록도 서버 동기화 대상에 포함됩니다.</p>
    <button type="button" className="primary" disabled={busy || !staffId} onClick={() => void operation(async () => {
                    let current = access.current.getState(), selected = staffId;
                    if (selected === 'new') {
                        const same = current.staff.find(person => person.name === user.name && person.active);
                        if (same)
                            selected = same.id;
                        else {
                            const person = await makeStaff(user.name, '');
                            current = { ...current, staff: [...current.staff, person] };
                            selected = person.id;
                        }
                    }
                    if (!current.staff.some(person => person.id === selected && person.active))
                        throw Error('기기 점검자를 다시 선택해 주세요.');
                    await access.current.save({ ...current, cloud: { userId: user.id, staffId: selected, automatic: false, records: {}, photoIds: {} } });
                    setMessage('연결했습니다. 먼저 지금 동기화를 눌러 내용을 확인하세요.');
                })}>이 점검자와 서버 계정 연결</button></div> : <>
    <p>연결된 기기 점검자: <strong>{data.staff.find(person => person.id === data.cloud?.staffId)?.name}</strong></p>
    <p className="hint">마지막 서버 동기화: {data.cloud?.lastSynced ? new Date(data.cloud.lastSynced).toLocaleString('ko-KR') : '아직 없음'}</p>
    <label><input type="checkbox" checked={!!data.cloud?.automatic} disabled={busy} onChange={event => {
                    const automatic = event.target.checked;
                    void operation(async () => { const current = access.current.getState(); await access.current.save({ ...current, cloud: { ...current.cloud!, automatic } }); });
                }}/>변경 후 자동 동기화</label>
    <div className="cloud-actions"><button type="button" className="primary" disabled={busy} onClick={() => void synchronize()}>{busy ? '서버와 동기화 중…' : '지금 동기화'}</button></div>
   </>)}
   {(user.role === 'admin' || user.role === 'owner') && <details><summary>서버 관리자 도구</summary>
    <div className="cloud-actions"><button disabled={busy} onClick={() => void operation(async () => setUsers((await request<{
                    users: ServerUser[];
                }>('accounts')).users))}>서버 점검자 목록</button>
    <button disabled={busy} onClick={() => void operation(async () => setRemoteRecords(await listRemoteRecords('admin/records')))}>전체 서버 점검 기록</button>
    <button disabled={busy} onClick={() => void operation(async () => setLogs((await request<{
                    events: Record<string, string>[];
                }>('audit')).events))}>서버 변경이력</button></div>
    <form className="cloud-form" onSubmit={event => {
                    event.preventDefault();
                    const form = event.currentTarget, fields = new FormData(form);
                    void operation(async () => {
                        await post('accounts', { username: fields.get('username'), name: fields.get('name'), password: fields.get('password'), role: fields.get('role') || 'inspector' });
                        setUsers((await request<{
                            users: ServerUser[];
                        }>('accounts')).users);
                        setMessage('서버 점검자를 추가했습니다.');
                        form.reset();
                    });
                }}><fieldset disabled={busy}><legend>서버 점검자 계정 추가</legend>
     <label>로그인 아이디<input name="username" required pattern="[a-z0-9][a-z0-9._-]{2,79}" autoComplete="off"/></label>
     <label>점검자 이름<input name="name" required maxLength={100}/></label>
     <label>초기 비밀번호<input name="password" required type="password" minLength={12} autoComplete="new-password"/></label>
     {user.role === 'owner' && <label>권한<select name="role"><option value="inspector">점검자</option><option value="admin">일반 관리자</option></select></label>}
     <button type="submit" className="primary">서버 점검자 등록</button></fieldset></form>
    {users.map(person => <div className="cloud-account" key={person.id}><span>{person.name} ({person.username}) · {person.active ? '사용 중' : '비활성'}</span>{person.id !== user.id && person.role === 'inspector' && <button disabled={busy} onClick={() => void operation(async () => {
                            await post('accounts/' + person.id, { active: !person.active }, 'PATCH');
                            setUsers((await request<{
                                users: ServerUser[];
                            }>('accounts')).users);
                        })}>{person.active ? '서버 접속 중지' : '다시 허용'}</button>}</div>)}
    <form className="cloud-form" onSubmit={event => {
                    event.preventDefault();
                    const form = event.currentTarget, fields = new FormData(form);
                    void operation(async () => { await post('accounts/' + fields.get('account'), { password: fields.get('password') }, 'PATCH'); setMessage('비밀번호를 초기화했습니다. 해당 계정은 다시 로그인해야 합니다.'); form.reset(); });
                }}><fieldset disabled={busy}><legend>점검자 비밀번호 초기화</legend>
     <label>대상 계정<select name="account" required><option value="">목록을 먼저 불러오세요</option>{users.filter(person => person.role === 'inspector').map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
     <label>새 비밀번호<input type="password" name="password" autoComplete="new-password" minLength={12} required/></label><button type="submit">비밀번호 초기화</button></fieldset></form>
    <form onSubmit={event => {
                    event.preventDefault();
                    void operation(async () => {
                        const current = access.current.getState(), existing = (await request<{
                            sites: {
                                site: {
                                    id: string;
                                };
                                revision: number;
                            }[];
                        }>('sites')).sites;
                        for (const site of current.sites) {
                            const old = existing.find(row => row.site.id === site.id);
                            await post('sites/' + site.id, { site, revision: old?.revision || 0 }, 'PUT');
                        }
                        setMessage('기기의 현장 목록 ' + current.sites.length + '개를 서버에 반영했습니다. 서버에만 있는 현장은 유지했습니다.');
                    });
                }}><fieldset disabled={busy}><legend>기기의 현장 목록을 서버에 반영</legend><label><input type="checkbox" required/>기기 현장 정보로 서버의 같은 현장을 갱신하겠습니다.</label><button type="submit">확인하고 현장 목록 전송</button></fieldset></form>
    {remoteRecords.map(row => <details className="cloud-record" key={row.id}><summary>{row.record?.site.name || '삭제된 점검표'} · {row.record?.date.replace('T', ' ') || row.id} · 버전 {row.revision}</summary><p>계정: {users.find(person => person.id === row.ownerId)?.name || row.ownerId}</p><p>종합평가: {row.record?.rating || '작성 중'}</p><pre>{row.record?.issues}</pre><pre>{row.record?.action}</pre></details>)}
    {logs.length > 0 && <details><summary>최근 변경이력 {logs.length}건</summary>{logs.map((entry, index) => <p key={index}>{new Date(entry.at).toLocaleString('ko-KR')} · {entry.action} · {users.find(person => person.id === entry.actor_id)?.name || entry.actor_id} · {entry.target_id}</p>)}</details>}
   </details>}
   {user.role === 'owner' && <OwnerRecordTools />}
   <details><summary>내 서버 비밀번호 변경</summary><form className="cloud-form" onSubmit={event => {
                event.preventDefault();
                const form = event.currentTarget, fields = new FormData(form);
                void operation(async () => { await post('password', { current: fields.get('current'), password: fields.get('password') }); setUser(null); onSession(null); setMessage('비밀번호를 변경했습니다. 다시 로그인해 주세요.'); form.reset(); });
            }}><fieldset disabled={busy}><legend>비밀번호 변경</legend><label>현재 비밀번호<input name="current" type="password" autoComplete="current-password" required/></label><label>새 비밀번호<input name="password" type="password" minLength={12} autoComplete="new-password" required/></label><button type="submit">비밀번호 변경</button></fieldset></form></details>
   <button className="secondary" disabled={busy} onClick={() => void operation(async () => { await post('logout', {}); setUser(null); onSession(null); setUsers([]); setLogs([]); setRemoteRecords([]); setMessage('서버에서 로그아웃했습니다. 기기 기록은 유지됩니다.'); })}>서버 로그아웃</button>
  </>}
 </section>;
}
