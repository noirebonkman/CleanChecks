import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { readTheme } from '../preferences';
import { APP_VERSION } from '../version';
import { ClipboardCheck } from 'lucide-react';
import { post, request, ServerError, type ServerUser } from './client';
import { Turnstile } from './Turnstile';
import { WorkspaceMenu } from './WorkspaceMenu';
import './login-and-access.css';

const FieldCalendar = lazy(() => import('./FieldCalendar').then(module => ({ default:module.FieldCalendar })));
const InspectionApplication = lazy(() => import('../App'));
type Session = { user:ServerUser; expiresAt?:number };

type Configuration = { setupRequired: boolean; turnstileSiteKey: string };
function AccessPrivacyNotice() {
    return <details className="access-privacy"><summary>자동 접속 검사 개인정보 안내</summary>
        <p>이 사이트는 자동화된 접속을 확인하기 위해 Cloudflare Turnstile을 사용합니다.
            검사 과정의 데이터 처리에 관한 사항은 <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener noreferrer">Turnstile 개인정보 부속정책</a>과
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer"> Cloudflare 개인정보처리방침</a>을 확인해 주세요.</p>
    </details>;
}
export function LoginApplication() {
    const [user, setUser] = useState<ServerUser | null>(null);
    const [workspace, setWorkspace] = useState<'menu' | 'inspection' | 'calendar'>('menu');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [temporaryUser, setTemporaryUser] = useState<ServerUser | null>(null);
    const [configuration, setConfiguration] = useState<Configuration | null>(null);
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
    const [setup, setSetup] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const [token, setToken] = useState(''), [challengeVersion, setChallengeVersion] = useState(0);
    const [entryVerified, setEntryVerified] = useState(false);
    const [entryError, setEntryError] = useState('');
    const [entryVersion, setEntryVersion] = useState(0);
    const entryChecking = useRef(false);
    const expiresAt = useRef<number | null>(null);
    const userRef = useRef<ServerUser | null>(null), changing = useRef(false);
    userRef.current = user;

    const clear = () => { setUser(null); setWorkspace('menu'); setSettingsOpen(false); setTemporaryUser(null); setError(''); setMessage('다시 로그인해 주세요. 작성한 내용은 해당 계정에 보존됩니다.'); };
    const enter = async (next: ServerUser, expiry?: number) => {
        expiresAt.current = typeof expiry === 'number' ? expiry : null;
        if (next.mustChangePassword) { setTemporaryUser(next); return; }
        const { prepareAccountWorkspace } = await import('./account-workspace');
        await prepareAccountWorkspace(next);
        setTemporaryUser(null); setUser(next);
    };
    const restore = async () => {
        setLoading(true); setError('');
        try {
            const [next, session] = await Promise.all([
                request<Configuration>('auth-config'),
                request<Session>('session').catch(cause => {
                    if (cause instanceof ServerError && cause.status === 401) return null;
                    throw cause;
                }),
            ]);
            setConfiguration(next);
            if (next.turnstileSiteKey && session) {
                setEntryVerified(false);
                setEntryError('');
                setEntryVersion(value => value+1);
            } else {
                setEntryVerified(true);
                if (session) await enter(session.user,session.expiresAt);
            }
        } catch (cause) { setError(cause instanceof Error ? cause.message : '서버에 연결하지 못했습니다.'); }
        finally { setLoading(false); }
    };
    const verifyEntry = async (challenge: string) => {
        if (!challenge || entryChecking.current || entryVerified) return;
        entryChecking.current = true;
        setEntryError('');
        try {
            const session = await post<{user:ServerUser | null;expiresAt?:number}>('access-check', { challenge });
            setLoading(true);
            setEntryVerified(true);
            try { if (session.user) await enter(session.user,session.expiresAt); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '서버에 연결하지 못했습니다.'); }
            finally { setLoading(false); }
        } catch (cause) {
            setEntryError(cause instanceof Error ? cause.message : '접속 확인을 다시 시도해 주세요.');
        } finally {
            entryChecking.current = false;
        }
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
                if (old && (value.user.id !== old.id || value.user.role !== old.role || JSON.stringify(value.user.permissions) !== JSON.stringify(old.permissions))) clear();
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
    if (configuration?.turnstileSiteKey && !entryVerified) {
        return <div className="login-shell access-screen" data-theme={readTheme()}>
            <main className="login-card access-verification" aria-labelledby="access-verification-title">
                <img className="login-logo" src="./logo-black.svg" alt="루센트"/>
                <h1 id="access-verification-title">기록을 여는 중입니다</h1>
                <p role="status">잠시만 기다려 주세요.</p>
                <Turnstile key={entryVersion} siteKey={configuration.turnstileSiteKey} action="access"
                    onToken={value => void verifyEntry(value)} onError={setEntryError}/>
                {entryError && <><p role="alert" className="form-error">{entryError}</p>
                    <button className="secondary" onClick={() => {
                        setEntryError(''); setEntryVersion(value => value+1);
                    }}>다시 확인</button></>}
                <small>루센트 현장 관리 · v{APP_VERSION}</small>
                <AccessPrivacyNotice/>
            </main>
        </div>;
    }
    if (user) {
        if (workspace === 'inspection' || settingsOpen)
            return <Suspense fallback={<div className="login-shell access-screen" data-theme={readTheme()}><p role="status">점검 화면을 여는 중입니다…</p></div>}><InspectionApplication key={user.id} session={user} onLogout={logout} onWorkspaceMenu={() => setWorkspace('menu')}
                settingsOpen={settingsOpen} onOpenSettings={() => setSettingsOpen(true)} onCloseSettings={inspect => {
                    if (inspect) setWorkspace('inspection');
                    setSettingsOpen(false);
                }}/></Suspense>;
        if (workspace === 'calendar')
            return <Suspense fallback={<div className="login-shell" data-theme={readTheme()}><p role="status">캘린더를 여는 중입니다…</p></div>}>
                <FieldCalendar user={user} onMenu={() => setWorkspace('menu')} onLogout={logout} onSettings={() => setSettingsOpen(true)}/>
            </Suspense>;
        return <WorkspaceMenu user={user} onInspection={() => setWorkspace('inspection')}
            onCalendar={() => setWorkspace('calendar')} onLogout={logout} onSettings={() => setSettingsOpen(true)}/>;
    }
    return <div className="login-shell access-screen" data-theme={readTheme()}>
        <main className="login-card sign-in-card" aria-busy={loading || busy}>
            <div className="sign-in-brand">
                <div className="sign-in-brandline">
                    <img className="login-logo" src="./logo-black.svg" alt="루센트"/>
                    <span className="release-badge">v{APP_VERSION}</span>
                </div>
                <div className="sign-in-brand-copy">
                    <ClipboardCheck size={25} aria-hidden="true"/>
                    <strong>루센트 현장 관리</strong>
                    <p>현장 점검과 일정 관리</p>
                </div>
            </div>
            <div className="sign-in-form">
            <h1>{temporaryUser ? '비밀번호 변경' : setup ? '어드민 계정 등록' : '로그인'}</h1>
            <p>{temporaryUser ? '임시 비밀번호를 본인 비밀번호로 변경해야 사용할 수 있습니다.' : setup ? '최초 한 번만 등록합니다. 서버를 새로 만드는 과정이 아닙니다.' : '내 계정으로 점검 기록을 이어가세요.'}</p>
            <>
                {error && <p role="alert" className="form-error">{error}</p>}
                {message && <p role="status">{message}</p>}
                {error && !token && configuration?.turnstileSiteKey && !loading &&
                    <button type="button" className="text-button" disabled={busy} onClick={() => {
                        setError(''); setChallengeVersion(value=>value+1);
                    }}>접속 다시 확인</button>}
                {!configuration && !loading ? <button className="primary full" onClick={() => void restore()}>연결 다시 확인</button> :
                <form key={temporaryUser ? 'password' : setup ? 'setup' : 'login'} onSubmit={submit}>
                    <fieldset disabled={busy}>
                        {temporaryUser ? <>
                            <label>임시 비밀번호<input name="current" type="password" autoComplete="current-password" required maxLength={128}/></label>
                            <label>새 비밀번호<input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="10자 이상"/></label>
                            <label>새 비밀번호 확인<input name="confirmation" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="10자 이상"/></label>
                        </> : setup ? <>
                            <label>초기 설정 코드<input name="setupToken" type="password" autoComplete="off" minLength={32} required/></label>
                            <label>아이디<input value="ludmin" readOnly autoComplete="username"/></label>
                            <label>표시할 이름<input name="name" required maxLength={100}/></label>
                            <label>비밀번호<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} placeholder="10자 이상" required/></label>
                        </> : <>
                            <label>아이디<input placeholder="발급받은 아이디" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={80}/></label>
                            <label>비밀번호<input placeholder="비밀번호 입력" name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
                            <label className="remember-option"><input type="checkbox" name="remember"/>자동로그인 <small>30일간 로그인 유지</small></label>
                        </>}
                        {!temporaryUser && !loading && configuration?.turnstileSiteKey && <Turnstile key={challengeVersion} siteKey={configuration.turnstileSiteKey} onToken={setToken} onError={setError}/>}
                        <button className="primary full" disabled={busy || loading || (!temporaryUser && !!configuration?.turnstileSiteKey && !token)}>{busy ? '처리 중…' : loading || (!temporaryUser && !!configuration?.turnstileSiteKey && !token) ? '접속 확인 중…' : temporaryUser ? '비밀번호 변경' : setup ? '어드민 계정 생성' : '로그인'}</button>
                    </fieldset>
                </form>}
                {!temporaryUser && <aside className="login-help"><strong>비밀번호를 잊으셨나요?</strong><span>관리자에게 임시 비밀번호를 요청해 주세요.</span></aside>}
                {configuration?.turnstileSiteKey && <AccessPrivacyNotice/>}
                {configuration?.setupRequired && !temporaryUser && <button className="text-button" onClick={() => { setSetup(value => !value); setError(''); }}>{setup ? '로그인으로 돌아가기' : '최초 어드민 계정 등록'}</button>}
                {temporaryUser && <button className="text-button" onClick={() => void logout().catch(cause => setError(cause.message))}>다른 계정으로 로그인</button>}
            </>
            </div>
        </main>
    </div>;
}
