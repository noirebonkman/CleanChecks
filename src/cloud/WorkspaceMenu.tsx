import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ClipboardCheck, LogOut } from 'lucide-react';
import { hasPermission } from '../access-control';
import { readTheme } from '../preferences';
import type { ServerUser } from './client';

export function WorkspaceMenu({ user, calendar, onInspection, onCalendar, onMenu, onLogout }: {
    user: ServerUser;
    calendar: boolean;
    onInspection: () => void;
    onCalendar: () => void;
    onMenu: () => void;
    onLogout: () => Promise<void>;
}) {
    const heading = useRef<HTMLHeadingElement>(null);
    const [loggingOut, setLoggingOut] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { heading.current?.focus(); }, [calendar]);

    async function logout() {
        setLoggingOut(true);
        setError('');
        try { await onLogout(); }
        catch { setError('로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'); }
        finally { setLoggingOut(false); }
    }

    return <div className="login-shell" data-theme={readTheme()}>
        <main className="login-card workspace-card" aria-labelledby="workspace-title">
            <header className="workspace-header">
                <img className="login-logo" src="./logo-black.svg" alt="루센트"/>
                <button className="text-button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={17}/>로그아웃</button>
            </header>
            {calendar && <button className="text-button" disabled={loggingOut} onClick={onMenu}><ArrowLeft size={17}/>서비스 선택</button>}
            <h1 id="workspace-title" ref={heading} tabIndex={-1}>{calendar ? '현장 일정 캘린더' : '서비스 선택'}</h1>
            {calendar ? <p>현장 방문 일정 등록과 조회 기능을 준비 중입니다.</p> : <>
                <p>{user.name}님, 이용할 서비스를 선택해 주세요.</p>
                <div className="workspace-options">
                    <button className="workspace-option" disabled={loggingOut} onClick={onInspection}>
                        <ClipboardCheck className="workspace-option-icon" aria-hidden="true"/>
                        <span><strong>현장점검</strong><small>{hasPermission(user, 'writeOwnRecords') ? '점검표를 작성하고 기록을 확인합니다.' : '작성된 점검 기록을 확인합니다.'}</small></span>
                        <ArrowRight size={17} aria-hidden="true"/>
                    </button>
                    <button className="workspace-option" disabled={loggingOut} onClick={onCalendar}>
                        <CalendarDays className="workspace-option-icon" aria-hidden="true"/>
                        <span><strong>현장 일정 캘린더</strong><small>현장 방문 일정을 관리할 공간입니다.</small></span>
                        <ArrowRight size={17} aria-hidden="true"/>
                    </button>
                </div>
            </>}
            {error && <p role="alert" className="form-error">{error}</p>}
        </main>
    </div>;
}
