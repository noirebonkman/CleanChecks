import { useEffect, useRef, useState, type FormEvent } from 'react';
import { hasPermission, type PermissionOverrides } from '../access-control';
import { AccountPermissionsForm } from './AccountPermissionsForm';
import { post, request, type ServerUser } from './client';
import './user-management.css';

export const roleName = { owner:'어드민', admin:'관리자', inspector:'점검자' } as const;
type Action = { kind:'role'|'status'|'password'|'permissions'; person:ServerUser; permissions?:PermissionOverrides };

export function UserManagement({ user }: { user:ServerUser }) {
    const [users,setUsers] = useState<ServerUser[]>([]);
    const [loaded,setLoaded] = useState(false);
    const [query,setQuery] = useState('');
    const [role,setRole] = useState('');
    const [selected,setSelected] = useState('');
    const [tab,setTab] = useState<'permissions'|'password'|'status'>('permissions');
    const [action,setAction] = useState<Action|null>(null);
    const [busy,setBusy] = useState(false);
    const [error,setError] = useState('');
    const [success,setSuccess] = useState('');
    const [dialogError,setDialogError] = useState('');
    const dialog = useRef<HTMLDialogElement>(null);
    const result = useRef<HTMLParagraphElement>(null);
    const detail = useRef<HTMLElement>(null);
    const isOwner = user.role === 'owner';
    const refresh = async () => { setUsers((await request<{users:ServerUser[]}>('accounts')).users); setLoaded(true); setError(''); };
    useEffect(() => { void refresh().catch(cause => setError(cause.message)); }, []);
    useEffect(() => { if (action) dialog.current?.showModal(); }, [action]);
    useEffect(() => { if (success) result.current?.focus(); }, [success]);
    useEffect(() => { if (selected) detail.current?.focus(); }, [selected]);
    const person = users.find(person => person.id === selected);
    const manageable = !!person && person.id !== user.id && person.role !== 'owner' && (isOwner || person.role === 'inspector');
    const filtered = users.filter(person => (!role || person.role === role)
        && (person.name + ' ' + person.username).toLowerCase().includes(query.trim().toLowerCase()));
    function confirm(next:Action) { setDialogError(''); setSuccess(''); setAction(next); }
    const targetRole = action?.person.role === 'admin' ? 'inspector' : 'admin';
    const actionLabel = action?.kind === 'role' ? roleName[targetRole] + '로 변경' : action?.kind === 'status'
        ? action.person.active ? '사용 중지' : '사용 재개' : action?.kind === 'password' ? '임시 비밀번호 재발급' : '개인별 권한 저장';

    async function submit(event:FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !action) return;
        const fields = new FormData(event.currentTarget);
        const reason = String(fields.get('reason') || '').trim();
        if (!reason) { setDialogError('변경 사유를 입력해 주세요.'); return; }
        setBusy(true); setDialogError('');
        try {
            const patch = action.kind === 'role' ? {role:targetRole} : action.kind === 'status' ? {active:!action.person.active}
                : action.kind === 'password' ? {password:fields.get('password')} : {permissions:action.permissions,revision:action.person.permissionRevision || 0};
            const path = 'accounts/' + action.person.id + (action.kind === 'permissions' ? '/permissions' : '');
            const response = await post<{user?:ServerUser}>(path,{...patch,reason},'PATCH');
            if (response.user) setUsers(list => list.map(person => person.id === response.user!.id ? response.user! : person));
            else await refresh().catch(() => setError('변경사항은 저장되었습니다. 계정 목록을 다시 불러와 주세요.'));
            setAction(null);
            setSuccess(action.person.name + ' · ' + actionLabel + ' 완료');
        } catch (cause) { setDialogError(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.'); }
        finally { setBusy(false); }
    }

    async function create(event:FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget, fields = new FormData(form);
        setBusy(true); setError(''); setSuccess('');
        try {
            await post('accounts',{username:fields.get('username'),name:fields.get('name'),password:fields.get('password'),role:fields.get('role') || 'inspector'});
            form.reset();
            await refresh().catch(() => setError('계정은 생성되었습니다. 목록을 다시 불러와 주세요.'));
            setSuccess('계정을 생성했습니다. 임시 비밀번호는 7일간 유효합니다.');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '계정 생성에 실패했습니다.'); }
        finally { setBusy(false); }
    }

    return <section className="user-management" aria-labelledby="user-management-title">
        <header><div><h2 id="user-management-title">사용자 관리</h2><p>이름, 계정 등급, 사용 상태를 확인하고 관리할 계정을 선택하세요.</p></div>
            <button className="secondary" disabled={busy} onClick={() => void refresh().catch(cause => setError(cause.message))}>목록 새로고침</button></header>
        {success && <p className="account-success" role="status" ref={result} tabIndex={-1}>{success}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <details className="setting-card"><summary>사용자 계정 추가</summary>
            <form className="cloud-form" onSubmit={create}><fieldset disabled={busy}>
                <label>아이디<input name="username" autoCapitalize="none" autoComplete="off" pattern="[a-z0-9][a-z0-9._-]{2,79}" required/></label>
                <label>이름<input name="name" maxLength={100} required/></label>
                <label>임시 비밀번호<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required/></label>
                {isOwner && <label>등급<select name="role"><option value="inspector">점검자</option><option value="admin">관리자</option></select></label>}
                <button className="primary">{busy ? '처리 중…' : '계정 생성'}</button>
            </fieldset></form>
        </details>
        <div className="user-filters">
            <label>계정 검색<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름 또는 아이디"/></label>
            <label>등급<select value={role} onChange={event => setRole(event.target.value)}>
                <option value="">전체 등급</option>{Object.entries(roleName).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
        </div>
        <div className="user-grid" role="table" aria-label="사용자 목록">
            <div className="user-grid-row user-grid-header" role="row">{['이름','아이디','등급','상태','상세'].map(label => <span key={label} role="columnheader">{label}</span>)}</div>
            {filtered.map(person => <div className="user-grid-row" role="row" key={person.id} data-selected={selected === person.id}>
                <strong role="cell">{person.name || '미확인'}{person.id === user.id && <small> · 내 계정</small>}</strong>
                <span role="cell">{person.username || '미확인'}</span>
                <span role="cell"><span className="user-tag" data-tone={person.role}>{roleName[person.role]}</span></span>
                <span role="cell"><span className="user-tag" data-tone={person.active ? 'active' : 'inactive'}>{person.active ? '사용 중' : '사용 중지'}</span></span>
                <span role="cell"><button className="secondary" aria-expanded={selected === person.id} aria-label={person.name + ' 계정 상세'}
                    onClick={() => { setSelected(person.id === selected ? '' : person.id); setTab('permissions'); }}>상세</button></span>
            </div>)}
        </div>
        {!filtered.length && <p role="status">{loaded ? '조건에 맞는 계정이 없습니다.' : error ? '목록을 불러오지 못했습니다.' : '계정 목록을 불러오는 중입니다…'}</p>}
        {person && <section className="setting-card user-detail" ref={detail} tabIndex={-1}>
            <h3>{person.name || '미확인'} <span className="user-tag" data-tone={person.role}>{roleName[person.role]}</span></h3>
            <p>{person.username || '미확인'} · {person.active ? '사용 중' : '사용 중지'} · 캘린더 {hasPermission(person,'manageSites') ? '수정 가능' : '조회만 가능'}</p>
            {manageable && <>
                <nav aria-label="계정 관리 기능" className="settings-tabs">
                    {([['permissions','권한'],['password','비밀번호'],['status','등급·상태']] as const).map(([key,label]) =>
                        <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
                </nav>
                {tab === 'permissions' && (isOwner ? <AccountPermissionsForm key={person.id + ':' + person.permissionRevision + ':' + person.role}
                    person={person} disabled={busy} onSave={async permissions => confirm({kind:'permissions',person,permissions})}/>
                    : <p>개인별 권한은 어드민이 설정합니다.</p>)}
                {tab === 'password' && <button className="secondary" onClick={() => confirm({kind:'password',person})}>임시 비밀번호 재발급</button>}
                {tab === 'status' && <div className="user-action-row">
                    {isOwner && <button className="secondary" onClick={() => confirm({kind:'role',person})}>{person.role === 'admin' ? '점검자로 변경' : '관리자로 변경'}</button>}
                    <button className={person.active ? 'secondary danger' : 'secondary'} onClick={() => confirm({kind:'status',person})}>{person.active ? '사용 중지' : '사용 재개'}</button>
                </div>}
            </>}
        </section>}
        {action && <dialog ref={dialog} className="account-dialog" aria-labelledby="account-action-title"
            onCancel={event => {event.preventDefault(); if (!busy) setAction(null);}}>
            <form onSubmit={event => void submit(event)}>
                <h3 id="account-action-title">{actionLabel}</h3>
                <p><strong>{action.person.name}</strong> · {action.person.username}</p>
                {action.kind === 'role' && <p>{roleName[action.person.role]} → <strong>{roleName[targetRole]}</strong>. 개인별 권한이 새 등급의 기본값으로 초기화됩니다.</p>}
                <p>저장하면 대상 사용자의 기존 로그인이 해제됩니다.</p>
                <fieldset disabled={busy}>
                    {action.kind === 'password' && <label>새 임시 비밀번호<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required/></label>}
                    <label>변경 사유<input name="reason" required maxLength={1000} autoFocus/></label>
                    {dialogError && <p className="form-error" role="alert">{dialogError}</p>}
                    <footer><button type="button" className="secondary" onClick={() => setAction(null)}>취소</button>
                        <button className="primary" type="submit">변경 확인</button></footer>
                </fieldset>
                {busy && <p role="status">변경사항을 처리 중입니다…</p>}
            </form>
        </dialog>}
    </section>;
}
