import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { permissionKeys, permissionLabels, type PermissionOverrides } from '../access-control';
import type { Inspection } from '../inspection-model';
import { repeatOptions, type ScheduleRule } from './calendar-model';
import { request, type ServerUser } from './client';
import { historyLabel } from './history-labels';
import { roleName } from './UserManagement';
import './activity-log.css';

const scheduleFields = {
    siteName:'현장', title:'작업명', date:'날짜', start:'시작 시간', end:'종료 시간', kind:'작업 구분',
    state:'상태', assignee:'담당자', repeat:'반복', until:'반복 종료일',
} as const;
type Snapshot = Pick<ScheduleRule, keyof typeof scheduleFields>;
type CalendarDetail = {
    actorName: string;
    before: Snapshot | null;
    after: Snapshot | null;
    effectiveDate?: string;
    notesChanged?: boolean;
    addressChanged?: boolean;
};
type OwnerEvent<D> = { id: string; actorId: string; targetId: string; at: string; action: string; detail: D };
type ManagementDetail = {
    reason?: string;
    name?: string;
    recordCount?: number;
    before?: PermissionOverrides;
    after?: PermissionOverrides;
    beforeRole?: ServerUser['role'];
    afterRole?: ServerUser['role'];
};
type PersonalEvent = { at: string; action: string; target_id: string };
type Scope = 'personal' | 'calendar' | 'management';
type LogData =
    | { scope: 'personal'; events: PersonalEvent[] }
    | { scope: 'calendar'; events: OwnerEvent<CalendarDetail>[] }
    | { scope: 'management'; events: OwnerEvent<ManagementDetail>[]; users: ServerUser[] };

const dateTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit',
});
const fields = Object.keys(scheduleFields) as (keyof Snapshot)[];
const permission = (value: boolean | null) => value === null ? '등급 기본값' : value ? '허용' : '차단';
function fieldValue(snapshot: Snapshot | null, field: keyof Snapshot) {
    if (!snapshot) return '—';
    return field === 'repeat' ? repeatOptions[snapshot.repeat] : snapshot[field] || '미지정';
}

function CalendarEntry({ event }: { event: OwnerEvent<CalendarDetail> }) {
    const { before, after, actorName, effectiveDate, notesChanged, addressChanged } = event.detail;
    const schedule = after ?? before;
    const changedFields = fields.filter(field => before?.[field] !== after?.[field]);
    const dates = before && after && before.date !== after.date
        ? [before.date || '미정', after.date || '미정'].join(' → ') : schedule?.date || '날짜 미정';
    return <details className="activity-entry">
        <summary><span><strong>{historyLabel(event.action)}</strong> · {schedule?.siteName || '현장 미지정'}{schedule?.title ? ' · ' + schedule.title : ''}</span>
            <small>{dateTime.format(new Date(event.at))} · {actorName} · {dates}</small></summary>
        {changedFields.length > 0 && <dl>{changedFields.map(field => <div key={field}>
            <dt>{scheduleFields[field]}</dt>
            <dd>{before && <span>{fieldValue(before, field)}</span>}{before && after && <span aria-label="에서"> → </span>}{after && <span>{fieldValue(after, field)}</span>}</dd>
        </div>)}</dl>}
        {effectiveDate && <p>반복 변경 적용일 {effectiveDate}</p>}
        {notesChanged && <p>메모 변경</p>}{addressChanged && <p>주소 변경</p>}
    </details>;
}

function ManagementEntry({ event, users }: { event: OwnerEvent<ManagementDetail>; users: ServerUser[] }) {
    const { detail } = event;
    const { before, after } = detail;
    const name = (id: string) => users.find(user => user.id === id)?.name || id;
    return <details className="activity-entry">
        <summary><span><strong>{historyLabel(event.action)}</strong> · {detail.name || name(event.targetId)}</span>
            <small>{dateTime.format(new Date(event.at))} · {name(event.actorId)}</small></summary>
        {detail.reason && <p>사유 {detail.reason}</p>}
        {detail.beforeRole && detail.afterRole && <p>등급 {roleName[detail.beforeRole]} → {roleName[detail.afterRole]} · 개인별 권한 초기화</p>}
        {before && after && <dl>{permissionKeys.map(key => <div key={key}><dt>{permissionLabels[key]}</dt><dd>{permission(before[key])} → {permission(after[key])}</dd></div>)}</dl>}
        {detail.recordCount !== undefined && <p>삭제 기록 {detail.recordCount}건</p>}
    </details>;
}

export function ActivityLog({ user, records }: { user: ServerUser; records: Inspection[] }) {
    const [scope, setScope] = useState<Scope>('personal');
    const [refresh, setRefresh] = useState(0);
    const [data, setData] = useState<LogData | null>(null);
    const [error, setError] = useState('');
    const heading = useRef<HTMLHeadingElement>(null);
    const owner = user.role === 'owner';
    const activeScope = owner ? scope : 'personal';
    useEffect(() => { heading.current?.focus(); }, []);
    useEffect(() => {
        const controller = new AbortController();
        const options = { signal:controller.signal };
        const load = async (): Promise<LogData> => {
            if (activeScope === 'personal')
                return { scope:activeScope, ...await request<{events:PersonalEvent[]}>('my-history',options) };
            if (activeScope === 'calendar')
                return { scope:activeScope, ...await request<{events:OwnerEvent<CalendarDetail>[]}>('owner/history?scope=calendar',options) };
            const [history, accounts] = await Promise.all([
                request<{events:OwnerEvent<ManagementDetail>[]}>('owner/history?scope=management',options),
                request<{users:ServerUser[]}>('accounts',options),
            ]);
            return { scope:activeScope, ...history, ...accounts };
        };
        void load().then(result => { if (!controller.signal.aborted) setData(result); }).catch(cause => {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '로그를 불러오지 못했습니다.');
        });
        return () => controller.abort();
    }, [activeScope, refresh, user.id]);

    const current = data?.scope === activeScope ? data : null;
    const changeScope = (next: Scope) => {
        if (activeScope !== next) { setData(null); setError(''); setScope(next); }
    };
    return <div className="content settings server-settings page-enter activity-log">
        <header className="page-heading">
            <div><h1 ref={heading} tabIndex={-1}>활동 로그</h1><p>최근 기록을 최신순으로 확인합니다.</p></div>
            <button type="button" className="secondary" disabled={!current && !error}
                onClick={() => { setData(null); setError(''); setRefresh(value => value+1); }}><RefreshCw size={17} aria-hidden="true"/>새로고침</button>
        </header>
        {owner && <nav className="settings-tabs" aria-label="로그 종류">
            <button aria-pressed={activeScope === 'personal'} onClick={() => changeScope('personal')}>내 변경이력</button>
            <button aria-pressed={activeScope === 'calendar'} onClick={() => changeScope('calendar')}>일정 변경</button>
            <button aria-pressed={activeScope === 'management'} onClick={() => changeScope('management')}>관리 작업</button>
        </nav>}
        <section className="setting-card" aria-label="로그 목록" aria-busy={!current && !error}>
            {error ? <p role="alert">{error}</p> : !current ? <p role="status">로그를 불러오는 중입니다…</p>
                : !current.events.length ? <p role="status">표시할 변경이력이 없습니다.</p>
                : current.scope === 'calendar' ? current.events.map(event => <CalendarEntry key={event.id} event={event}/>)
                : current.scope === 'management' ? current.events.map(event => <ManagementEntry key={event.id} event={event} users={current.users}/>)
                : <ul className="activity-personal">{current.events.map((event, index) => <li key={index}>
                    <strong>{historyLabel(event.action)}</strong> · {records.find(record => record.id === event.target_id)?.site.name || '계정 작업'}
                    <small>{dateTime.format(new Date(event.at))}</small>
                </li>)}</ul>}
        </section>
    </div>;
}
