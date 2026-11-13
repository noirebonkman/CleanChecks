import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, LockKeyhole, UserRound } from 'lucide-react';
import { post, type ServerUser } from './client';
import { roleName } from './UserManagement';
import { readTheme } from '../preferences';

/** Reauthentication is local to this mounted page; no password goes into storage. */
export function AccountSettings({ user, onClose }: {
    user: ServerUser; onClose: () => void;
}) {
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const currentPassword = useRef('');
    const passwordInput = useRef<HTMLInputElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { passwordInput.current?.focus(); return () => { currentPassword.current = ''; }; }, []);
    useEffect(() => { if (verified) heading.current?.focus(); }, [verified]);

    async function submit(event: FormEvent<HTMLFormElement>, kind: 'verify' | 'password') {
        event.preventDefault(); if (busy) return;
        const form = event.currentTarget;
        const fields = new FormData(form);
        setBusy(true); setError('');
        try {
            if (kind === 'verify') {
                const current = String(fields.get('current') || '');
                await post('account/verify', { current });
                currentPassword.current = current;
                form.reset(); setVerified(true);
            } else {
                if (fields.get('password') !== fields.get('confirm')) throw Error('새 비밀번호가 서로 다릅니다.');
                await post('password', { current: currentPassword.current, password: fields.get('password') });
                currentPassword.current = ''; form.reset();
                window.dispatchEvent(new Event('cleanchecks:server-logout'));
            }
        } catch (cause) { setError(cause instanceof Error ? cause.message : '변경하지 못했습니다. 다시 시도해 주세요.'); }
        finally { setBusy(false); }
    }

    return <div className="login-shell access-screen account-settings-screen" data-theme={readTheme()}>
        <main className="login-card account-settings-card" aria-labelledby="account-settings-title">
            <header className="account-page-header"><button type="button" className="header-icon-button" aria-label="이전 화면" title="이전 화면" disabled={busy} onClick={onClose}><ArrowLeft size={20}/></button>
                <div><p className="eyebrow">내 계정</p><h1 id="account-settings-title" ref={heading} tabIndex={-1}>{verified ? '계정 설정' : '비밀번호 확인'}</h1></div></header>
            {!verified ? <>
                <p>계정 설정을 열려면 현재 비밀번호를 입력해 주세요.</p>
                <form onSubmit={event => void submit(event, 'verify')}><fieldset disabled={busy}>
                    <label>현재 비밀번호<input ref={passwordInput} name="current" type="password" maxLength={128} autoComplete="current-password" required/></label>
                    <button className="primary">{busy ? '확인 중…' : '계정 설정 열기'}</button>
                </fieldset></form>
            </> : <div className="account-settings-sections">
                <section className="account-identity-card" aria-label="내 계정 정보"><UserRound size={22}/><dl><div><dt>이름</dt><dd>{user.name}</dd></div><div><dt>아이디</dt><dd>{user.username}</dd></div><div><dt>권한</dt><dd><span className="user-tag" data-tone={user.role}>{roleName[user.role]}</span></dd></div></dl></section>
                <section><h2><KeyRound size={18}/>비밀번호 변경</h2><form onSubmit={event => void submit(event, 'password')}><fieldset disabled={busy}>
                    <label>새 비밀번호<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} placeholder="10자 이상" required/></label>
                    <label>새 비밀번호 확인<input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required/></label>
                    <p className="hint"><LockKeyhole size={15}/>변경하면 모든 기기에서 로그아웃됩니다.</p><button className="primary">변경 후 다시 로그인</button>
                </fieldset></form></section>
            </div>}
            {error && <p className="form-error" role="alert">{error}</p>}
        </main>
    </div>;
}
