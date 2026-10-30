import { useEffect, useRef, useState, type FormEvent } from 'react';
import App from '../App';
import { readTheme } from '../preferences';
import { post, request, ServerError, type ServerUser } from './client';
import { prepareAccountWorkspace } from './account-workspace';
import { Turnstile } from './Turnstile';
import './login-and-access.css';

type Configuration = { setupRequired: boolean; turnstileSiteKey: string };
export function LoginApplication() {
    const [user, setUser] = useState<ServerUser | null>(null);
    const [temporaryUser, setTemporaryUser] = useState<ServerUser | null>(null);
    const [configuration, setConfiguration] = useState<Configuration | null>(null);
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
    const [setup, setSetup] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const [token, setToken] = useState(''), [challengeVersion, setChallengeVersion] = useState(0);
    const expiresAt = useRef<number | null>(null);
    const userRef = useRef<ServerUser | null>(null), changing = useRef(false);
    userRef.current = user;

    const clear = () => { setUser(null); setTemporaryUser(null); setError(''); setMessage('다시 로그인해 주세요. 작성한 내용은 해당 계정에 보존됩니다.'); };
    const enter = async (next: ServerUser, expiry?: number) => {
        expiresAt.current = typeof expiry === 'number' ? expiry : null;
        if (next.mustChangePassword) { setTemporaryUser(next); return; }
        await prepareAccountWorkspace(next);
        setTemporaryUser(null); setUser(next);
    };
    const restore = async () => {
        setLoading(true); setError('');
        try {
            setConfiguration(await request<Configuration>('auth-config'));
            try { const result=await request<{user:ServerUser;expiresAt?:number}>('session');await enter(result.user,result.expiresAt); }
            catch (cause) { if (!(cause instanceof ServerError && cause.status === 401)) throw cause; }
        } catch (cause) { setError(cause instanceof Error ? cause.message : '서버에 연결하지 못했습니다.'); }
        finally { setLoading(false); }
    };
    useEffect(() => { void restore(); }, []);
    useEffect(() => {
        const expired = () => { if (!changing.current && userRef.current) clear(); };
        const check = () => {
            if (!userRef.current) return;
            if (expiresAt.current && Date.now() >= expiresAt.current) { clear(); return; }
            if (!navigator.onLine) return;
            void request<{ user: ServerUser }>('session').then(value => {
                const old = userRef.current;
                if (old && (value.user.id !== old.id || value.user.role !== old.role)) clear();
            }).catch(() => {});
        };
        const visible = () => { if (document.visibilityState === 'visible') check(); };
        const timer = setInterval(check, 60000);
        window.addEventListener('cleanchecks:server-logout', expired);
        window.addEventListener('online', check); document.addEventListener('visibilitychange', visible);
        return () => { clearInterval(timer); window.removeEventListener('cleanchecks:server-logout', expired); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', visible); };
    }, []);
    const logout = async () => { await post('logout', {}); clear(); };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); if (busy) return;
        const fields = new FormData(event.currentTarget);
        setBusy(true); setError(''); setMessage('');
        try {
            if (temporaryUser) {
                if (fields.get('password') !== fields.get('confirmation')) throw Error('새 비밀번호가 서로 다릅니다.');
                changing.current = true;
                await post('password', { current: fields.get('current'), password: fields.get('password') });
                setTemporaryUser(null);
                setMessage('비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.');
            } else if (setup) {
                await post('setup', { setupToken: fields.get('setupToken'), username: 'ludmin', name: fields.get('name'), password: fields.get('password'), challenge: token });
                setSetup(false); setConfiguration(value => value ? { ...value, setupRequired: false } : value);
                setMessage('어드민 계정을 생성했습니다. 로그인해 주세요.');
            } else {
                const result = await post<{ user: ServerUser; expiresAt?: number }>('login', { username: fields.get('username'), password: fields.get('password'), remember: fields.get('remember') === 'on', challenge: token });
                await enter(result.user, result.expiresAt);
            }
        } catch (cause) { setError(cause instanceof Error ? cause.message : '로그인하지 못했습니다.'); }
        finally { changing.current = false; setBusy(false); setToken(''); setChallengeVersion(value => value + 1); }
    };
    if (user) return <App key={user.id} session={user} onLogout={logout}/>;
    return <div className="login-shell" data-theme={readTheme()}>
        <main className="login-card" aria-busy={loading || busy}>
            <img className="login-logo" src="./logo-black.svg" alt="루센트"/>
            <p className="eyebrow">현장점검</p>
            <h1>{temporaryUser ? '비밀번호 변경' : setup ? '최초 어드민 설정' : '로그인'}</h1>
            <p>{temporaryUser ? '임시 비밀번호를 본인 비밀번호로 변경해야 사용할 수 있습니다.' : '발급받은 계정으로 로그인해 주세요.'}</p>
            {loading ? <p role="status">서버 연결을 확인하고 있습니다…</p> : <>
                {error && <p role="alert" className="form-error">{error}</p>}
                {message && <p role="status">{message}</p>}
                {!configuration ? <button className="primary full" onClick={() => void restore()}>연결 다시 확인</button> :
                <form key={temporaryUser ? 'password' : setup ? 'setup' : 'login'} onSubmit={submit}>
                    <fieldset disabled={busy}>
                        {temporaryUser ? <>
                            <label>임시 비밀번호<input name="current" type="password" autoComplete="current-password" required maxLength={128}/></label>
                            <label>새 비밀번호<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
                            <label>새 비밀번호 확인<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
                        </> : setup ? <>
                            <label>초기 설정 코드<input name="setupToken" type="password" autoComplete="off" minLength={32} required/></label>
                            <label>아이디<input value="ludmin" readOnly autoComplete="username"/></label>
                            <label>표시할 이름<input name="name" required maxLength={100}/></label>
                            <label>비밀번호<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
                        </> : <>
                            <label>아이디<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={80}/></label>
                            <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
                            <label className="remember-option"><input type="checkbox" name="remember"/>자동로그인 <small>30일 후 재로그인</small></label>
                        </>}
                        {!temporaryUser && configuration.turnstileSiteKey && <Turnstile key={challengeVersion} siteKey={configuration.turnstileSiteKey} onToken={setToken} onError={setError}/>}
                        <button className="primary full" disabled={busy || (!temporaryUser && !!configuration.turnstileSiteKey && !token)}>{busy ? '처리 중…' : temporaryUser ? '비밀번호 변경' : setup ? '어드민 계정 생성' : '로그인'}</button>
                    </fieldset>
                </form>}
                {!temporaryUser && <p className="login-help">비밀번호를 잊으셨나요?<br/>관리자에게 임시 비밀번호 발급을 요청해 주세요.</p>}
                {configuration?.setupRequired && !temporaryUser && <button className="text-button" onClick={() => { setSetup(value => !value); setError(''); }}>{setup ? '로그인으로 돌아가기' : '처음 서버를 설정하시나요?'}</button>}
                {temporaryUser && <button className="text-button" onClick={() => void logout().catch(cause => setError(cause.message))}>다른 계정으로 로그인</button>}
            </>}
        </main>
    </div>;
}
