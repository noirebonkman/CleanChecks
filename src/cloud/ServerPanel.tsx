import { historyLabel } from './history-labels';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { State } from '../inspection-model';
import { post, request, type ServerUser } from './client';
import { receiveManagementRecords } from './account-workspace';
import { synchronizeCloud, resolveCloudConflict, type RemoteRecord } from './synchronization';
import { OwnerRecordTools } from './OwnerRecordTools';
import { storageAccount } from '../local-storage';

type Props = { user: ServerUser; visible: boolean; data: State; getState: () => State; save: (value: State) => Promise<void> };
export async function publishSites(sites: State['sites']): Promise<void> {
    const remote = (await request<{ sites: { site: State['sites'][number]; revision: number }[] }>('sites')).sites;
    for (const site of sites) {
        const prior = remote.find(row => row.site.id === site.id);
        if (prior && JSON.stringify(prior.site) === JSON.stringify(site)) continue;
        await post('sites/' + site.id, { site, revision: prior?.revision || 0 }, 'PUT');
    }
}
export function ServerPanel({ user, visible, data, getState, save }: Props) {
    const [status, setStatus] = useState('서버 전송 대기'), [error, setError] = useState('');
    const [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
    const [users, setUsers] = useState<ServerUser[]>([]), [conflicts, setConflicts] = useState<string[]>([]);
    const [history, setHistory] = useState<Record<string, string>[]>([]);
    const [trash, setTrash] = useState<(RemoteRecord & { expiresAt: number })[]>([]);
    const [accountReasons, setAccountReasons] = useState<Record<string,string>>({});
    const [botConfigured, setBotConfigured] = useState<boolean | null>(null);
    const access = useRef({ getState, save }); access.current = { getState, save };
    const running = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const signature = data.records.filter(record => record.staffId === user.id).map(record => record.id + ':' + record.updated + ':' + record.photos.map(photo => photo.id).join(',')).sort().join('|');
    const run = async (action: () => Promise<void>) => {
        if (running.current) return;
        running.current = true; setBusy(true); setError('');
        try { await action(); }
        catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : '요청하지 못했습니다.'); setStatus('기기에 보존됨 · 서버 전송 실패'); } }
        finally { running.current = false; if (alive.current) setBusy(false); }
    };
    const refreshUsers = async () => setUsers((await request<{ users: ServerUser[] }>('accounts')).users);
    const sync = () => run(async () => {
        setStatus('서버 전송 중…');
        const scopedSave = async (next: State) => {
            if (!alive.current || storageAccount() !== user.id) throw Error('계정이 변경되어 전송을 중단했습니다.');
            await access.current.save(next);
        };
        const result = await synchronizeCloud(user, () => access.current.getState(), scopedSave);
        if (user.role !== 'inspector') {
            const next = await receiveManagementRecords(user, access.current.getState());
            await scopedSave(next);
        }
        if (!alive.current) return;
        setConflicts(result.conflictIds);
        setStatus(result.conflictIds.length ? '동시 수정 확인 필요 · 설정에서 선택해 주세요' : '서버 전송 완료 · 사진은 이 기기에만 보관');
    });
    useEffect(() => {
        const timer = setTimeout(() => { if (navigator.onLine) void sync(); else setStatus('오프라인 · 기기에 보존 중'); }, 1400);
        return () => clearTimeout(timer);
    }, [signature, tick, user.id]);
    useEffect(() => {
        const online = () => setTick(value => value + 1);
        const timer = setInterval(online, 30000);
        window.addEventListener('online', online);
        return () => { clearInterval(timer); window.removeEventListener('online', online); };
    }, []);
    useEffect(() => {
        if (!visible || user.role === 'inspector') return;
        void run(async () => {
            await refreshUsers();
            const config = await request<{ turnstileSiteKey: string; localDevelopment?: boolean }>('auth-config');
            setBotConfigured(!!config.turnstileSiteKey || !!config.localDevelopment);
        });
    }, [visible, user.role]);
    const changeAccount = (person: ServerUser, patch: Record<string, unknown>) => run(async () => {
        if (!accountReasons[person.id]?.trim()) throw Error('변경 사유를 먼저 입력해 주세요.');
        await post('accounts/' + person.id, { ...patch, reason: accountReasons[person.id] }, 'PATCH'); await refreshUsers(); setTick(value => value + 1);
    });
    const create = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
        void run(async () => {
            await post('accounts', { username: fields.get('username'), name: fields.get('name'), password: fields.get('password'), role: fields.get('role') || 'inspector' });
            await refreshUsers(); form.reset(); setStatus('계정을 만들었습니다. 임시 비밀번호는 7일 안에 사용해야 합니다.'); setTick(value => value + 1);
        });
    };
    return <>
        <div className="account-sync" role="status"><span>{status}</span><button className="text-button" disabled={busy} onClick={() => void sync()}>전송 다시 확인</button></div>
        {visible && <section className="setting-card cloud-settings">
            <h2>로그인 계정</h2><p><strong>{user.name}</strong> · {user.username} · {user.role === 'owner' ? '어드민' : user.role === 'admin' ? '관리자' : '일반 점검자'}</p>
            <p className="hint">서버에는 점검 내용만 저장합니다. 다른 기기에서는 첨부 사진을 볼 수 없습니다.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            {conflicts.map(id => <div key={id} className="cloud-record"><h3>동시 수정: {data.records.find(record => record.id === id)?.site.name || id}</h3><p>개인 백업 후 유지할 내용을 선택하세요.</p>{(['server', 'device'] as const).map(choice => <button key={choice} disabled={busy} onClick={() => void run(async () => { await resolveCloudConflict(id, choice, user, () => access.current.getState(), next => access.current.save(next)); setConflicts(value => value.filter(item => item !== id)); setTick(value => value + 1); })}>{choice === 'server' ? '서버 내용 유지' : '이 기기 내용 유지'}</button>)}</div>)}
            <details><summary>내 비밀번호 변경</summary><form className="cloud-form" onSubmit={event => {
                event.preventDefault(); const fields = new FormData(event.currentTarget);
                void run(async () => { if (fields.get('password') !== fields.get('confirm')) throw Error('새 비밀번호가 서로 다릅니다.'); await post('password', { current: fields.get('current'), password: fields.get('password') }); window.dispatchEvent(new Event('cleanchecks:server-logout')); });
            }}><label>현재 비밀번호<input name="current" type="password" autoComplete="current-password" required/></label><label>새 비밀번호<input name="password" type="password" autoComplete="new-password" minLength={12} required/></label><label>새 비밀번호 확인<input name="confirm" type="password" autoComplete="new-password" minLength={12} required/></label><button disabled={busy}>변경 후 다시 로그인</button></form></details>
            <button className="setting-row" onClick={() => void run(async () => setHistory((await request<{ events: Record<string,string>[] }>('my-history')).events))}>내 변경이력 보기</button>
            {history.map((item, index) => <p key={index}>{new Date(item.at).toLocaleString('ko-KR')} · {historyLabel(item.action)} · {data.records.find(record=>record.id===item.target_id)?.site.name || '계정 작업'}</p>)}
            {user.role !== 'inspector' && <>
                <h2>관리자 메뉴 · 계정 관리</h2>
                {botConfigured === false && <p className="hint">Turnstile 키가 아직 등록되지 않았습니다. 현재는 서버의 로그인 시도 제한만 적용됩니다.</p>}
                <details><summary>사용자 계정 추가</summary><form className="cloud-form" onSubmit={create}><fieldset disabled={busy}><legend>사용자 계정 추가</legend>
                    <label>아이디<input name="username" autoCapitalize="none" autoComplete="off" pattern="[a-z0-9][a-z0-9._-]{2,79}" required/></label>
                    <label>이름<input name="name" maxLength={100} required/></label>
                    <label>임시 비밀번호<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label>
                    {user.role === 'owner' && <label>계정 권한<select name="role"><option value="inspector">일반 점검자</option><option value="admin">관리자</option></select></label>}
                    <p className="hint">첫 로그인 때 본인 비밀번호로 변경해야 사용할 수 있습니다.</p><button className="primary">계정 생성</button>
                </fieldset></form></details>
                {users.filter(person => person.id !== user.id && person.role !== 'owner').map(person => <details className="cloud-account" key={person.id}>
                    <summary>{person.name} · {person.username} · {person.role === 'admin' ? '관리자' : '점검자'} · {person.active ? '사용 중' : '사용 중지'}</summary>
                    <label>변경 사유<input value={accountReasons[person.id]||''} maxLength={1000} onChange={event=>setAccountReasons(value=>({...value,[person.id]:event.target.value}))}/></label>
                    {(person.role === 'inspector' || user.role === 'owner') && <>
                        <button disabled={busy} onClick={() => void changeAccount(person, { active: !person.active })}>{person.active ? '사용 중지' : '사용 재개'}</button>
                        <form className="cloud-form" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void changeAccount(person, { password: fields.get('password') }); }}>
                            <label>재발급할 임시 비밀번호<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><button disabled={busy}>임시 비밀번호로 초기화</button>
                        </form>
                    </>}
                    {user.role === 'owner' && <button disabled={busy} onClick={() => void changeAccount(person, { role: person.role === 'admin' ? 'inspector' : 'admin' })}>{person.role === 'admin' ? '관리자 권한 회수' : '관리자 권한 부여'}</button>}
                </details>)}
            </>}
            {user.role === 'owner' && <>
                <h2>어드민 전용 메뉴</h2><OwnerRecordTools/>
                <details><summary>삭제 유예함 · 30일</summary><button disabled={busy} onClick={() => void run(async () => setTrash((await request<{ records: typeof trash }>('owner/trash')).records))}>삭제 기록 불러오기</button>
                    {trash.map(row => <form key={row.id} className="cloud-form" onSubmit={event => {
                        event.preventDefault(); const fields = new FormData(event.currentTarget);
                        void run(async () => { await post('owner/restore/' + row.id, { revision: row.revision, password: fields.get('password') }); setTrash(value => value.filter(item => item.id !== row.id)); setTick(value => value + 1); });
                    }}><strong>{row.record?.site.name} · {row.record?.date}</strong><p>복원 기한: {new Date(row.expiresAt).toLocaleString('ko-KR')}</p><label>어드민 비밀번호<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>기록 복원</button></form>)}
                    <p className="hint">작성자 계정이 삭제된 경우 해당 기록은 이 메뉴에서 복원할 수 없습니다.</p>
                </details>
            </>}
        </section>}
    </>;
}
