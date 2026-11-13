import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardCheck, LogOut, Settings, UserRound } from 'lucide-react';
import { hasPermission } from '../access-control';
import { readTheme } from '../preferences';
import { APP_VERSION } from '../version';
import type { ServerUser } from './client';

export function WorkspaceMenu({ user, onInspection, onCalendar, onLogout, onSettings, onAccount }: {
    user: ServerUser;
    onInspection: () => void;
    onCalendar: () => void;
    onLogout: () => Promise<void>;
    onSettings: () => void;
    onAccount?: () => void;
}) {
    const heading = useRef<HTMLHeadingElement>(null);
    const [loggingOut, setLoggingOut] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { heading.current?.focus(); }, []);

    async function logout() {
        setLoggingOut(true);
        setError('');
        try { await onLogout(); }
        catch { setError('로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'); }
        finally { setLoggingOut(false); }
    }

    return <div className="login-shell access-screen" data-theme={readTheme()}>
        <main className="login-card workspace-card" aria-labelledby="workspace-title">
            <header className="workspace-header">
                <img className="login-logo" src="./logo-black.svg" alt="루센트"/>
                <div className="workspace-header-actions">
                    {onAccount && <button className="header-icon-button" aria-label="계정 설정" title="계정 설정" disabled={loggingOut} onClick={onAccount}><UserRound size={21}/></button>}
                    <button className="header-icon-button" aria-label="설정" title="설정" disabled={loggingOut} onClick={onSettings}><Settings size={21} aria-hidden="true"/></button>
                    <button className="header-icon-button" aria-label="로그아웃" title="로그아웃" disabled={loggingOut} onClick={() => void logout()}><LogOut size={21} aria-hidden="true"/></button>
                </div>
            </header>
            <div className="workspace-intro">
                <div className="workspace-title-line">
                    <h1 id="workspace-title" ref={heading} tabIndex={-1}>서비스 선택</h1>
                    <span className="release-badge">v{APP_VERSION}</span>
                </div>
                <p>{user.name}님, 이용할 서비스를 선택해 주세요.</p>
            </div>
            <div className="workspace-options">
                <button className="workspace-option" disabled={loggingOut} onClick={onInspection}>
                    <span className="workspace-option-icon"><ClipboardCheck size={22} aria-hidden="true"/></span>
                    <span><strong>현장점검</strong><small>{hasPermission(user, 'writeOwnRecords') ? '점검표를 작성하고 기록을 확인합니다.' : '작성된 점검 기록을 확인합니다.'}</small></span>
                    <ArrowRight size={17} aria-hidden="true"/>
                </button>
                <button className="workspace-option" disabled={loggingOut} onClick={onCalendar}>
                    <span className="workspace-option-icon"><CalendarDays size={22} aria-hidden="true"/></span>
                    <span><strong>현장 일정 캘린더</strong><small>현장 방문 일정을 확인합니다.</small></span>
                    <ArrowRight size={17} aria-hidden="true"/>
                </button>
            </div>
            {error && <p role="alert" className="form-error">{error}</p>}
        </main>
    </div>;
}
