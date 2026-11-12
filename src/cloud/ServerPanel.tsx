import { createPortal } from 'react-dom';
import { hasPermission } from '../access-control';
import { UserManagement, roleName } from './UserManagement';
import { useEffect, useRef, useState } from 'react';
import type { State } from '../inspection-model';
import { post, request, type ServerUser } from './client';
import { receiveManagementRecords } from './account-workspace';
import { synchronizeCloud, resolveCloudConflict, type RemoteRecord } from './synchronization';
import { OwnerRecordTools } from './OwnerRecordTools';
import { storageAccount } from '../local-storage';

type Props = { section?: 'general' | 'users' | 'owner'; settingsTarget?: HTMLElement | null; user: ServerUser; visible: boolean; data: State; getState: () => State; save: (value: State) => Promise<void> };
export async function publishSites(sites: State['sites']): Promise<void> {
    const remote = (await request<{ sites: { site: State['sites'][number]; revision: number }[] }>('sites')).sites;
    for (const site of sites) {
        const prior = remote.find(row => row.site.id === site.id);
        if (prior && JSON.stringify(prior.site) === JSON.stringify(site)) continue;
        await post('sites/' + site.id, { site, revision: prior?.revision || 0 }, 'PUT');
    }
}
export function ServerPanel({ user, visible, data, getState, save, settingsTarget, section = 'general' }: Props) {
    const [status, setStatus] = useState('서버 전송 대기'), [error, setError] = useState('');
    const [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
    const [conflicts, setConflicts] = useState<string[]>([]);
    const [trash, setTrash] = useState<(RemoteRecord & { expiresAt: number })[]>([]);
    const [trashLoaded, setTrashLoaded] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(null);
    const [storageUsage, setStorageUsage] = useState<{used:number;limit:number}|null>(null);
    const access = useRef({ getState, save }); access.current = { getState, save };
    const running = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const signature = data.records.filter(record => record.staffId === user.id).map(record => record.id + ':' + record.updated + ':' + record.photos.map(photo => photo.id).join(',')).sort().join('|');
    const run = async (action: () => Promise<void>) => {
        if (running.current) return;
        running.current = true; setBusy(true); setError('');
        try { await action(); }
        catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : '요청하지 못했습니다.'); setStatus('작업을 완료하지 못했습니다. 설정에서 내용을 확인해 주세요.'); } }
        finally { running.current = false; if (alive.current) setBusy(false); }
    };
    const sync = () => {
        if (!navigator.onLine) { setStatus('오프라인 · 기기에 보존 중'); return Promise.resolve(); }
        return run(async () => {
            setStatus('서버 전송 중…');
            const scopedSave = async (next: State) => {
                if (!alive.current || storageAccount() !== user.id) throw Error('계정이 변경되어 전송을 중단했습니다.');
                await access.current.save(next);
            };
            const result = await synchronizeCloud(user, () => access.current.getState(), scopedSave, undefined, (done,total) => {
                if (alive.current) setStatus(`기존 사진 이전 중 · ${done}/${total}장`);
            });
            if (hasPermission(user, 'viewAllRecords')) {
                const next = await receiveManagementRecords(user, access.current.getState());
                await scopedSave(next);
            }
            if (!alive.current) return;
            if (user.role === 'owner') {
                void request<{used:number;limit:number}>('owner/photo-storage').then(value => {
                    if (alive.current) setStorageUsage(value);
                }).catch(() => {});
            }
            setConflicts(result.conflictIds);
            if (!result.conflictIds.length) setLastSynced(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
            setStatus(result.conflictIds.length ? '동시 수정 확인 필요 · 설정에서 선택해 주세요' :
                access.current.getState().records.some(record=>record.staffId===user.id&&record.pendingCompletion)
                    ? '전송 대기 중인 점검이 있습니다.' : '서버 동기화 완료');
    });
    };
    useEffect(() => {
        const timer = setTimeout(() => { if (navigator.onLine) void sync(); else setStatus('오프라인 · 기기에 보존 중'); }, 1400);
        return () => clearTimeout(timer);
    }, [signature, tick, user.id]);
    useEffect(() => {
        const online = () => setTick(value => value + 1);
        const foreground = () => {
            if (document.visibilityState === 'visible' && navigator.onLine) online();
        };
        const timer = setInterval(foreground, 30000);
        const offline = () => setStatus('오프라인 · 기기에 보존 중');
        window.addEventListener('online', online); window.addEventListener('offline', offline);
        document.addEventListener('visibilitychange', foreground);
        return () => { clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', foreground); };
    }, []);
    const content = <>
        <div className="account-sync" role="status"><span>{status}{lastSynced && <small> · 마지막 저장 확인 {lastSynced}</small>}{storageUsage&&storageUsage.used>=storageUsage.limit*.8&&<strong> · 서버 저장 공간 80% 이상 사용 중</strong>}</span><button className="text-button" disabled={busy} onClick={() => void sync()}>전송 다시 확인</button></div>
        {visible && section === 'users' && hasPermission(user,'manageUsers') && <UserManagement user={user}/>}
        {visible && section !== 'users' && <section className="setting-card cloud-settings">
            {section === 'general' && <>
            <h2>계정 및 기록 저장</h2><p><strong>{user.name}</strong> · {user.username} · {roleName[user.role]}</p>
            <p className="hint">점검 내용과 사진은 서버에 저장됩니다. 전송 대기 중인 내용은 해당 기기에 임시 보관합니다.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            {conflicts.map(id => <div key={id} className="cloud-record"><h3>동시 수정: {data.records.find(record => record.id === id)?.site.name || id}</h3><p>서버와 이 기기에서 모두 수정했습니다. 유지할 내용을 선택하세요.</p>{(['server', 'device'] as const).filter(choice => choice === 'server' || hasPermission(user, 'writeOwnRecords')).map(choice => <button key={choice} disabled={busy} onClick={() => void run(async () => { await resolveCloudConflict(id, choice, user, () => access.current.getState(), next => access.current.save(next)); setConflicts(value => value.filter(item => item !== id)); setTick(value => value + 1); })}>{choice === 'server' ? '서버 내용 유지' : '이 기기 내용 유지'}</button>)}</div>)}
            <details><summary>내 비밀번호 변경</summary><form className="cloud-form" onSubmit={event => {
                event.preventDefault(); const fields = new FormData(event.currentTarget);
                void run(async () => { if (fields.get('password') !== fields.get('confirm')) throw Error('새 비밀번호가 서로 다릅니다.'); await post('password', { current: fields.get('current'), password: fields.get('password') }); window.dispatchEvent(new Event('cleanchecks:server-logout')); });
            }}><label>현재 비밀번호<input name="current" type="password" autoComplete="current-password" required/></label><label>새 비밀번호<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} placeholder="10자 이상" required/></label><label>새 비밀번호 확인<input name="confirm" type="password" autoComplete="new-password" minLength={10} required/></label><button disabled={busy}>변경 후 다시 로그인</button></form></details>
            </>}
            {section === 'owner' && user.role === 'owner' && <>
                <h2>어드민 전용 메뉴</h2><OwnerRecordTools/>
                <details><summary>삭제 유예함 · 7일</summary><button disabled={busy} onClick={() => void run(async () => { setTrash((await request<{ records: typeof trash }>('owner/trash')).records); setTrashLoaded(true); })}>삭제 기록 불러오기</button>
                    {trashLoaded && trash.length === 0 && <p className="hint" role="status">복원할 삭제 기록이 없습니다.</p>}
                    {trash.map(row => <form key={row.id} className="cloud-form" onSubmit={event => {
                        event.preventDefault(); const fields = new FormData(event.currentTarget);
                        void run(async () => { await post('owner/restore/' + row.id, { revision: row.revision, password: fields.get('password') }); setTrash(value => value.filter(item => item.id !== row.id)); setTick(value => value + 1); });
                    }}><strong>{row.record?.site.name} · {row.record?.date}</strong><p>복원 기한: {new Date(row.expiresAt).toLocaleString('ko-KR')}</p><label>어드민 비밀번호<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>기록 복원</button></form>)}
                    <p className="hint">작성자 계정이 삭제된 경우 해당 기록은 이 메뉴에서 복원할 수 없습니다.</p>
                </details>
            </>}
        </section>}
    </>;
    // Keep synchronization mounted while placing all settings in one shared page column.
    return visible ? settingsTarget ? createPortal(content, settingsTarget) : null : content;
}
