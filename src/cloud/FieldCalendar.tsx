import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, Download, GripVertical, LogOut, MapPin, Plus, Search, Settings, SlidersHorizontal, MoreHorizontal, Upload } from 'lucide-react';
import { canManageCalendar } from '../access-control';
import type { Site } from '../inspection-model';
import { readTheme } from '../preferences';
import { APP_VERSION } from '../version';
import { dateKey, monthDays, occurrenceId, overlappingVisits, shiftDay, todayKey, visitLabel, visitsByDay, weekdays, workKinds, workStates, type SavedSchedule, type Schedule, type Visit } from './calendar-model';
import { CalendarImportDialog } from './CalendarImportDialog';
import { post, request, type ServerUser } from './client';
import { ScheduleEditor } from './ScheduleEditor';
import { knownValue } from '../site-details';
import { useCalendarLive } from './calendar-live';
import './field-calendar.css';

const newSchedule = (date: string): SavedSchedule => ({
    id:crypto.randomUUID(), siteId:'', siteName:'', address:'', title:'', date, kind:'자체 작업',
    start:'', end:'', assignee:'', notes:'', state:'예정', repeat:'none', until:'', seriesId:'', originalDate:'', revision:0,
});
function editOccurrence(visit: Visit, date = visit.occurrenceDate): SavedSchedule {
    if (visit.repeat === 'none') return { ...visit, date };
    return { ...visit, id:occurrenceId(visit.id, visit.occurrenceDate), seriesId:visit.id,
        originalDate:visit.occurrenceDate, date, repeat:'none', until:'', revision:0 };
}
const monthLabel = (month: string) => month.slice(0,4) + '년 ' + Number(month.slice(5)) + '월';
const dayLabel = (day: string) => Number(day.slice(5,7)) + '월 ' + Number(day.slice(8)) + '일';
const presenceKey = (visit: Pick<Visit,'id'|'occurrenceDate'>) => visit.id + '@' + visit.occurrenceDate;

export function FieldCalendar({ user, onMenu, onLogout, onSettings }: { user: ServerUser; onMenu: () => void; onLogout: () => Promise<void>; onSettings?: () => void }) {
    const canEdit = canManageCalendar(user);
    const mayWrite = useRef(canEdit);
    useLayoutEffect(() => {
        mayWrite.current = canEdit;
        return () => { mayWrite.current = false; };
    }, [canEdit]);
    const [month, setMonth] = useState(() => todayKey().slice(0,7));
    const [periodDirection, setPeriodDirection] = useState<'forward' | 'back'>();
    const [day, setDay] = useState(todayKey);
    const [view, setView] = useState<'month' | 'week' | 'list'>('month');
    const [rows, setRows] = useState<SavedSchedule[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('');
    const [assignee, setAssignee] = useState('');
    const [status, setStatus] = useState('');
    const [showUnassigned, setShowUnassigned] = useState(false);
    const [utilityPanel, setUtilityPanel] = useState<'filters' | 'options' | null>(null);
    const [reminder, setReminder] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [active, setActive] = useState<Visit | null>(null);
    const [detailClosing, setDetailClosing] = useState(false);
    const [editor, setEditor] = useState<SavedSchedule | null>(null);
    const [effectiveDate, setEffectiveDate] = useState('');
    const [revision, refresh] = useState(0);
    const [loaded, setLoaded] = useState('');
    const [loadError, setLoadError] = useState('');
    const [syncWarning, setSyncWarning] = useState(false);
    const [notice, setNotice] = useState('');
    const [working, setWorking] = useState(false);
    const [dropTarget, setDropTarget] = useState('');
    const [pendingMove, setPendingMove] = useState<SavedSchedule | null>(null);
    const [arrival, setArrival] = useState<{id:string; date:string} | null>(null);
    const [moveMessage, setMoveMessage] = useState<{text:string; failed?:boolean} | null>(null);
    const [moveSelection, setMoveSelection] = useState<Visit | null>(null);
    const [dragSource, setDragSource] = useState<Visit | null>(null);
    const moveInFlight = useRef(false);
    const movingSource = useRef<Visit | null>(null);
    const drag = useRef<Visit | null>(null);
    const dragGhost = useRef<HTMLDivElement>(null);
    const pointerDrag = useRef<{visit:Visit; id:number; x:number; y:number; moved:boolean} | null>(null);
    const draggedHandle = useRef<HTMLButtonElement | null>(null);
    const writeEpoch = useRef(0);
    const heading = useRef<HTMLHeadingElement>(null);
    const details = useRef<HTMLDialogElement>(null);
    const requestLatest = useRef<() => void>(() => {});
    const editingVisit = editor && active && (editor.id === active.id || editor.id === active.seriesId ||
        (editor.seriesId === active.id && editor.originalDate === active.occurrenceDate)) ? active : null;
    const editingSource = editor ? editingVisit : dragSource || moveSelection || movingSource.current;
    const {connected:live,editors} = useCalendarLive(() => requestLatest.current(),
        canEdit && (editor || editingSource) ? (editingSource ? presenceKey(editingSource) : '') : null);
    const editorsByVisit = useMemo(() => {
        const result = new Map<string,string[]>();
        for (const {name,items} of editors) {
            for (const item of items) result.set(item,[...(result.get(item) || []),name]);
        }
        return result;
    },[editors]);
    function editingLabel(visit: Pick<Visit,'id'|'occurrenceDate'>) {
        const names = editorsByVisit.get(presenceKey(visit));
        if (!names?.length) return null;
        const label = names.join(' · ') + ' 편집 중';
        return <span className="calendar-visit-editors" title={label}>{label}</span>;
    }
    useEffect(() => { heading.current?.focus(); }, []);
    useEffect(() => {
        if (!arrival) return;
        const timer = window.setTimeout(() => setArrival(null),300);
        return () => window.clearTimeout(timer);
    }, [arrival]);
    useEffect(() => {
        if (!moveMessage) return;
        const timer = window.setTimeout(() => setMoveMessage(null),moveMessage.failed ? 6500 : 3200);
        return () => window.clearTimeout(timer);
    }, [moveMessage]);
    useEffect(() => {
        if (active && !editor && !details.current?.open) details.current?.showModal();
        if (editor && details.current?.open) details.current.close();
    }, [active,editor]);
    useEffect(() => {
        if (!detailClosing) return;
        const timer = window.setTimeout(() => {
            setActive(null);
            setDetailClosing(false);
        },240);
        return () => window.clearTimeout(timer);
    }, [detailClosing]);
    useEffect(() => {
        const controller = new AbortController();
        let version = '', pending = false, received = false, queued = false, lastCheck = 0;
        setLoadError('');
        async function pull() {
            if (document.visibilityState === 'hidden' || controller.signal.aborted) return;
            if (pending) { queued = true; return; }
            pending = true;
            lastCheck = Date.now();
            const epoch = writeEpoch.current;
            try {
                const result = await request<{schedules?: SavedSchedule[];version?:string}>(
                    'calendar?month=' + month + (version ? '&since=' + encodeURIComponent(version) : ''),{signal:controller.signal});
                if (controller.signal.aborted || epoch !== writeEpoch.current) return;
                if (result.schedules) setRows(result.schedules);
                version = result.version || '';
                received = true;
                setLoaded(month);
                setLoadError('');
                setSyncWarning(false);
            } catch (cause) {
                if (!controller.signal.aborted) {
                    if (received) setSyncWarning(true);
                    else setLoadError(cause instanceof Error ? cause.message : '일정을 불러오지 못했습니다.');
                }
            } finally {
                pending = false;
                if (queued) { queued = false; void pull(); }
            }
        }
        requestLatest.current = pull;
        void pull();
        const timer = window.setInterval(() => {
            if (!pending && (!live.current || Date.now() - lastCheck >= 30000)) void pull();
        },4000);
        document.addEventListener('visibilitychange',pull);
        window.addEventListener('online',pull);
        return () => {
            controller.abort();
            requestLatest.current = () => {};
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange',pull);
            window.removeEventListener('online',pull);
        };
    }, [month,revision,live]);
    useEffect(() => {
        if (!canEdit) return;
        const controller = new AbortController();
        void request<{sites: {site: Site}[]}>('sites',{signal:controller.signal}).then(result => {
            if (!controller.signal.aborted) setSites(result.sites.map(item => item.site).filter(site => !site.inactive).sort((a,b) => a.name.localeCompare(b.name,'ko')));
        }).catch(() => { if (!controller.signal.aborted) setNotice('현장 목록을 불러오지 못했습니다. 현장명을 직접 입력할 수 있습니다.'); });
        return () => controller.abort();
    }, [canEdit]);
    const days = useMemo(() => monthDays(month), [month]);
    const ready = loaded === month && !loadError;
    const visits = useMemo(() => {
        const displayed = pendingMove ? [...rows.filter(row => row.id !== pendingMove.id),pendingMove] : rows;
        return visitsByDay(ready ? displayed : [],days);
    }, [ready,rows,days,pendingMove]);
    useEffect(() => {
        if (!ready || !active || editor) return;
        const latest = active.occurrenceDate
            ? visits.get(active.occurrenceDate)?.find(visit => visit.id === active.id)
            : rows.find(row => row.id === active.id && !row.date);
        if (!latest) {
            setActive(null);
            setNotice('일정이 이동되었거나 삭제되었습니다. 최신 목록을 확인해 주세요.');
        } else if (latest.revision !== active.revision) {
            setActive({...latest,occurrenceDate:active.occurrenceDate});
        }
    }, [active,editor,ready,rows,visits]);
    const names = [...new Set([assignee,...(ready ? rows.flatMap(row => [row.assignee,...(row.previousRules || []).map(rule => rule.assignee)]) : [])]
        .filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'));
    const search = query.trim().toLowerCase();
    const filterCount = [search,kind,assignee,status,showUnassigned].filter(Boolean).length;
    const filter = (row: SavedSchedule) => (!kind || row.kind === kind) && (!assignee || row.assignee === assignee)
        && (!status || row.state === status) && (!showUnassigned || !row.assignee)
        && [row.siteName,row.title,row.assignee,row.address].some(value => value.toLowerCase().includes(search));
    const unscheduled = ready ? rows.filter(row => !row.date && filter(row)) : [];
    const weekStart = Math.max(0,Math.floor(days.indexOf(day) / 7) * 7);
    const visibleDays = view === 'week' ? days.slice(weekStart,weekStart + 7) : days;
    const inMonth = days.filter(date => date.startsWith(month));
    const selected = (visits.get(day) || []).filter(filter);
    const monthVisits = inMonth.flatMap(date => visits.get(date) || []);
    const completed = monthVisits.filter(visit => visit.state === '완료').length;
    const unassigned = monthVisits.filter(visit => !visit.assignee && visit.state === '예정').length;
    const awaitingDate = ready ? rows.filter(row => !row.date && row.state === '예정').length : 0;

    function selectDay(date: string) { setDay(date); setActive(null); setMoveSelection(null); }
    function goMonth(next: string) {
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(next)) return;
        if (next !== month) setPeriodDirection(next > month ? 'forward' : 'back');
        setMonth(next);
        selectDay(next === todayKey().slice(0,7) ? todayKey() : next + '-01');
    }
    function movePeriod(step: number) {
        setPeriodDirection(step > 0 ? 'forward' : 'back');
        if (view === 'week') {
            const next = shiftDay(day, step * 7);
            goMonth(next.slice(0,7));
            selectDay(next);
            return;
        }
        const [year, number] = month.split('-').map(Number);
        goMonth(dateKey(year, number + step, 1).slice(0,7));
    }
    function openVisit(visit: Visit) { setDay(visit.occurrenceDate || day); setActive(visit); }
    function closeVisit() {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) setActive(null);
        else setDetailClosing(true);
    }
    function requireCalendarWrite() {
        if (!mayWrite.current) throw Error('일정 조회만 가능한 계정입니다.');
    }
    function openEditor(value: SavedSchedule, cutoff = '') {
        if (!mayWrite.current) return;
        setEffectiveDate(cutoff);
        setEditor(value);
    }
    async function persistSchedule(value: SavedSchedule, cutoff = '') {
        requireCalendarWrite();
        const result = await post<{revision:number;schedule?:Schedule}>('calendar/' + value.id,
            { schedule:value, revision:value.revision, effectiveDate:cutoff },'PUT');
        writeEpoch.current++;
        setRows(current => {
            if (current.some(row => row.id === value.id && row.revision > result.revision)) return current;
            return [...current.filter(row => row.id !== value.id), {...(result.schedule || value),revision:result.revision}];
        });
    }
    async function save(value: SavedSchedule, cutoff = '') {
        await persistSchedule(value,cutoff);
        if (value.date && value.date.slice(0,7) !== month) goMonth(value.date.slice(0,7));
        if (value.date) selectDay(value.date);
        setEditor(null);
        setActive(null);
        refresh(value => value + 1);
        setNotice('일정을 저장했습니다.');
    }
    async function moveVisit(visit: Visit, date: string) {
        if (!mayWrite.current || moveInFlight.current || visit.occurrenceDate === date) return;
        const next = editOccurrence(visit,date);
        const overlaps = overlappingVisits(next,visits.get(date) || []);
        moveInFlight.current = true;
        movingSource.current = visit;
        setPendingMove(next);
        setArrival({id:next.id,date});
        selectDay(date);
        setMoveMessage(null);
        try {
            await persistSchedule(next);
            setMoveMessage({text:dayLabel(date) + '로 옮겼습니다.' + (overlaps.length ? ' 같은 담당자의 시간이 겹칩니다.' : '')});
        } catch (cause) {
            setArrival({id:visit.id,date:visit.occurrenceDate});
            setDay(current => current === date ? visit.occurrenceDate : current);
            setMoveMessage({failed:true,text:'일정을 옮기지 못했습니다. ' + (cause instanceof Error ? cause.message : '다시 시도해 주세요.')});
        } finally {
            moveInFlight.current = false;
            movingSource.current = null;
            setPendingMove(null);
            refresh(value => value + 1);
        }
    }
    function startPointerDrag(event: PointerEvent<HTMLButtonElement>, visit: Visit) {
        draggedHandle.current = null;
        if (!canEdit || moveInFlight.current || !event.isPrimary || event.button !== 0) return;
        pointerDrag.current = {visit,id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function updatePointerDrag(event: PointerEvent<HTMLButtonElement>) {
        const gesture = pointerDrag.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        if (!gesture.moved) {
            if (Math.hypot(event.clientX - gesture.x,event.clientY - gesture.y) < 7) return;
            gesture.moved = true;
            setMoveSelection(null);
            setDragSource(gesture.visit);
        }
        const target = dayAtPointer(event);
        setDropTarget(target === gesture.visit.occurrenceDate ? '' : target);
        const ghost = dragGhost.current;
        if (ghost) {
            ghost.textContent = visitLabel(gesture.visit);
            ghost.hidden = false;
            const left = Math.max(4,Math.min(event.clientX + 10,window.innerWidth - ghost.offsetWidth - 4));
            const top = Math.max(4,event.clientY - ghost.offsetHeight - 12);
            ghost.style.transform = `translate(${left}px,${top}px)`;
        }
    }
    function dayAtPointer(event: PointerEvent<HTMLButtonElement>) {
        return document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('.calendar-day[data-date]')?.dataset.date || '';
    }
    function endPointerDrag(event: PointerEvent<HTMLButtonElement>, drop = false) {
        const gesture = pointerDrag.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        pointerDrag.current = null;
        if (!gesture.moved) return;
        draggedHandle.current = event.currentTarget;
        setDropTarget('');
        setDragSource(null);
        if (dragGhost.current) dragGhost.current.hidden = true;
        const date = drop ? dayAtPointer(event) : '';
        if (date) void moveVisit(gesture.visit,date);
    }
    async function remove() {
        requireCalendarWrite();
        if (!editor) return;
        await post('calendar/' + editor.id, { revision:editor.revision },'DELETE');
        setRows(current => current.filter(row => row.id !== editor.id && row.seriesId !== editor.id));
        setActive(null);
        setEditor(null);
        refresh(value => value + 1);
        setNotice('일정을 삭제했습니다.');
    }
    async function act(action: () => Promise<void>) {
        if (working) return;
        setWorking(true);
        setNotice('');
        try { await action(); }
        catch (cause) { setNotice(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.'); }
        finally { setWorking(false); }
    }
    function download(format: 'xlsx' | 'png' | 'ics') {
        void act(async () => {
            const { exportCalendar } = await import('./calendar-export');
            await exportCalendar(format,month,days,visits,reminder);
        });
    }
    const parentId = active?.seriesId || (active?.repeat !== 'none' ? active?.id : '');
    const parent = rows.find(row => row.id === parentId);
    function editFuture() {
        if (!parent || !active) return;
        const cutoff = active.originalDate || active.occurrenceDate;
        openEditor({ ...parent,date:cutoff },cutoff);
    }

    const editorStatus = <div className="calendar-editors" role="status" hidden={!editors.length}>
        <span className="calendar-editor-dot" aria-hidden="true"/>
        <strong>편집 중 {editors.length}명</strong>
        <span>{editors.map(editor => editor.name).join(' · ')}</span>
    </div>;
    return <div className="login-shell calendar-shell" data-theme={readTheme()} onKeyDown={event => {
        if (event.key === 'Escape' && moveSelection) setMoveSelection(null);
    }}>
        <main className="field-calendar" aria-labelledby="field-calendar-title">
            <header className="calendar-header">
                <button className="header-icon-button" aria-label="서비스 선택" title="서비스 선택" onClick={onMenu}><ArrowLeft size={21} aria-hidden="true"/></button>
                <div className="calendar-heading">
                    <div className="calendar-heading-line">
                        <h1 id="field-calendar-title" ref={heading} tabIndex={-1}>현장 일정 캘린더</h1>
                        <span className="release-badge">v{APP_VERSION}</span>
                    </div>
                    {!canEdit && <small>조회 전용</small>}
                </div>
                <div className="calendar-actions">
                    {canEdit && <button className="header-icon-button schedule-primary" aria-label="일정 추가" title="일정 추가"
                        disabled={!ready} onClick={() => openEditor(newSchedule(day))}><Plus size={22} aria-hidden="true"/></button>}
                    {onSettings && <button className="header-icon-button" aria-label="설정" title="설정" disabled={working}
                        onClick={onSettings}><Settings size={21} aria-hidden="true"/></button>}
                </div>
            </header>
            {editorStatus}
            <div className="calendar-toolbar">
                <div className="calendar-actions calendar-period">
                    <button className="header-icon-button" aria-label={view === 'week' ? '이전 주' : '이전 달'} onClick={() => movePeriod(-1)}><ChevronLeft size={19} aria-hidden="true"/></button>
                    <h2>{view === 'week' ? dayLabel(visibleDays[0]) + '–' + dayLabel(visibleDays[6]) : monthLabel(month)}</h2>
                    <button className="header-icon-button" aria-label={view === 'week' ? '다음 주' : '다음 달'} onClick={() => movePeriod(1)}><ChevronRight size={19} aria-hidden="true"/></button>
                </div>
                <div className="calendar-actions calendar-utilities">
                    <label className="calendar-select calendar-view"><select aria-label="보기" value={view} onChange={event => setView(event.target.value as typeof view)}>
                        <option value="month">월간</option><option value="week">주간</option><option value="list">목록</option>
                    </select></label>
                    <button className="header-icon-button calendar-filter-toggle" aria-label="필터" title="필터" aria-expanded={utilityPanel === 'filters'} aria-controls="calendar-filter-panel"
                        aria-describedby={filterCount ? 'calendar-filter-count' : undefined}
                        onClick={() => setUtilityPanel(current => current === 'filters' ? null : 'filters')}>
                        <SlidersHorizontal size={20} aria-hidden="true"/>
                        {!!filterCount && <span id="calendar-filter-count" className="calendar-filter-count">{filterCount}</span>}
                    </button>
                    <button className="header-icon-button" aria-label="일정 옵션" title="일정 옵션" aria-expanded={utilityPanel === 'options'} aria-controls="calendar-option-panel"
                        onClick={() => setUtilityPanel(current => current === 'options' ? null : 'options')}><MoreHorizontal size={22} aria-hidden="true"/></button>
                </div>
            </div>
            <section id="calendar-option-panel" className="calendar-panel calendar-options" aria-label="일정 옵션"
                hidden={utilityPanel !== 'options'} inert={utilityPanel !== 'options'}>
                <button onClick={() => {goMonth(todayKey().slice(0,7));setUtilityPanel(null);}}><CalendarCheck size={19} aria-hidden="true"/>오늘</button>
                <label className="calendar-select"><span>월 이동</span><input type="month" min="2000-01" max="2099-12" value={month}
                    onChange={event => goMonth(event.target.value)}/></label>
                <div className="calendar-actions">
                    {canEdit && <button disabled={!ready} onClick={() => {setImportOpen(true);setUtilityPanel(null);}}><Upload size={16} aria-hidden="true"/>엑셀 가져오기</button>}
                    <button disabled={!ready || working || !!pendingMove} onClick={() => download('xlsx')}><Download size={16} aria-hidden="true"/>엑셀 저장</button>
                    <button disabled={!ready || working || !!pendingMove} onClick={() => download('png')}><Download size={16} aria-hidden="true"/>이미지 저장</button>
                    <button disabled={!ready || working || !!pendingMove} onClick={() => download('ics')}><Download size={16} aria-hidden="true"/>ICS 저장</button>
                </div>
                <label className="calendar-reminder"><input type="checkbox" checked={reminder} onChange={event => setReminder(event.target.checked)}/> ICS에 시작 1시간 전 알림 포함</label>
                <button className="calendar-option-logout" disabled={working} onClick={() => void act(onLogout)}><LogOut size={16} aria-hidden="true"/>로그아웃</button>
            </section>
            <section id="calendar-filter-panel" className="calendar-panel calendar-filters" aria-label="일정 필터"
                hidden={utilityPanel !== 'filters'} inert={utilityPanel !== 'filters'}>
                <label className="calendar-search"><Search size={17} aria-hidden="true"/><input aria-label="일정 검색" placeholder="현장명, 작업명, 담당자" value={query} onChange={e => setQuery(e.target.value)}/></label>
                <label className="calendar-select"><span>구분</span><select value={kind} onChange={e => setKind(e.target.value)}>
                    <option value="">전체</option>{workKinds.map(kind => <option key={kind}>{kind}</option>)}
                </select></label>
                <label className="calendar-select"><span>담당</span><select value={assignee} onChange={e => { setAssignee(e.target.value); setShowUnassigned(false); }}>
                    <option value="">전체</option>{names.map(name => <option key={name}>{name}</option>)}
                </select></label>
                <label className="calendar-select"><span>상태</span><select value={status} onChange={e => setStatus(e.target.value)}>
                    <option value="">전체</option>{workStates.map(state => <option key={state}>{state}</option>)}
                </select></label>
                <button aria-pressed={showUnassigned} onClick={() => { setAssignee(''); setShowUnassigned(value => !value); }}>담당 미배정</button>
                {!!filterCount && <button onClick={() => {
                    setQuery(''); setKind(''); setAssignee(''); setStatus(''); setShowUnassigned(false);
                }}>필터 초기화</button>}
            </section>
            {ready && <div className="calendar-summary" aria-label="월간 일정 현황">
                <span>월간 일정 <strong>{monthVisits.length}</strong></span>
                <span>완료 <strong>{completed}</strong></span>
                <span>담당 미배정 <strong>{unassigned}</strong></span>
                <span>날짜 미정 <strong>{awaitingDate}</strong></span>
            </div>}
            {loadError ? <div role="alert" className="calendar-feedback">{loadError} <button onClick={() => refresh(value => value + 1)}>다시 불러오기</button></div> :
                !ready && <p role="status" className="calendar-feedback">일정을 불러오는 중입니다…</p>}
            {notice && <p role="status" className="calendar-feedback">{notice}</p>}
            {syncWarning && <p role="status" className="calendar-feedback">연결을 다시 확인 중입니다. 마지막으로 받은 일정을 표시합니다.</p>}
            <div className="calendar-workspace">
                {view === 'list' ? <div className="calendar-month-list">
                    {inMonth.filter(date => (visits.get(date) || []).some(filter)).map(date => <section key={date}>
                        <h3>{dayLabel(date)}</h3>{(visits.get(date) || []).filter(filter).map(visit =>
                            <button key={visit.id} className="visit-chip" data-kind={workKinds.indexOf(visit.kind)} onClick={() => openVisit(visit)}>
                                <span className="calendar-visit-label">{visitLabel(visit)}</span>{editingLabel(visit)}
                            </button>)}
                    </section>)}
                    {ready && !inMonth.some(date => (visits.get(date) || []).some(filter)) && <p className="calendar-feedback">표시할 일정이 없습니다.</p>}
                </div> : <div className="calendar-grid" data-direction={periodDirection} key={view + month + (view === 'week' ? weekStart : '')} aria-label={monthLabel(month) + ' 일정표'}>
                    {weekdays.map(label => <div className="calendar-weekday" key={label}>{label}</div>)}
                    {visibleDays.map(date => {
                        const entries = (visits.get(date) || []).filter(filter);
                        const hasEditing = entries.some(visit => editorsByVisit.has(presenceKey(visit)));
                        return <div key={date} className="calendar-day" data-date={date} data-selected={date === day} data-other={!date.startsWith(month)}
                            data-drop-target={dropTarget === date}
                            onDragOver={canEdit ? event => {
                                if (!drag.current || drag.current.occurrenceDate === date) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                setDropTarget(date);
                            } : undefined}
                            onDragLeave={canEdit ? event => {
                                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                                setDropTarget(current => current === date ? '' : current);
                            } : undefined}
                            onDrop={canEdit ? event => {
                                const visit = drag.current;
                                if (!visit) return;
                                event.preventDefault();
                                drag.current = null;
                                setDragSource(null);
                                setDropTarget('');
                                void moveVisit(visit,date);
                            } : undefined}>
                            <button className="calendar-date" aria-pressed={date === day} aria-current={date === todayKey() ? 'date' : undefined}
                                aria-label={dayLabel(date) + ' 일정 ' + entries.length + '건' + (hasEditing ? ' · 편집 중인 일정 있음' : '')} onClick={() => {
                                    if (canEdit && moveSelection) {
                                        setMoveSelection(null);
                                        void moveVisit(moveSelection,date);
                                    } else selectDay(date);
                                }}>
                                <span>{Number(date.slice(8))}</span>{entries.length > 0 && <small>{entries.length}</small>}
                                {hasEditing && <i className="calendar-date-editing" aria-hidden="true"/>}
                            </button>
                            <div className="calendar-day-visits">
                                {entries.slice(0,3).map(visit => <button key={visit.id} className="visit-chip" data-kind={workKinds.indexOf(visit.kind)}
                                    data-state={visit.state} data-arriving={arrival?.id === visit.id && arrival.date === date}
                                    data-moving={pendingMove?.id === visit.id}
                                    onClick={() => openVisit(visit)} draggable={canEdit && !pendingMove}
                                    onDragStart={canEdit ? event => {
                                        if (moveInFlight.current) { event.preventDefault(); return; }
                                        drag.current = visit;
                                        setDragSource(visit);
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain',visit.id);
                                    } : undefined}
                                    onDragEnd={canEdit ? () => { drag.current = null; setDragSource(null); setDropTarget(''); } : undefined}>
                                    <span className="calendar-visit-label">{visitLabel(visit)}</span>{editingLabel(visit)}
                                </button>)}
                                {entries.length > 3 && <button className="calendar-more" onClick={() => selectDay(date)}>+{entries.length - 3}건</button>}
                            </div>
                        </div>;
                    })}
                </div>}
                <aside className="calendar-side" aria-label="선택 날짜와 날짜 미정 일정">
                    <section className="calendar-selected-day" key={day}>
                        <div className="calendar-side-title"><h3>{dayLabel(day)} 일정</h3>
                            {canEdit && <button aria-label={dayLabel(day) + ' 일정 추가'} disabled={!ready} onClick={() => openEditor(newSchedule(day))}><Plus size={17}/></button>}
                        </div>
                        {canEdit && moveSelection && <p className="calendar-move-guide" role="status">옮길 날짜를 달력에서 선택하세요.</p>}
                        {selected.length ? selected.map(visit => <div className="visit-card-row" key={visit.id} data-drag-source={dragSource?.id === visit.id}>
                            <button className="visit-card" data-kind={workKinds.indexOf(visit.kind)}
                            data-arriving={arrival?.id === visit.id && arrival.date === visit.occurrenceDate}
                            data-moving={pendingMove?.id === visit.id}
                            onClick={() => openVisit(visit)}>
                            <strong><span className="visit-time">{visit.start ? visit.start + (visit.end ? '–' + visit.end : '') : '시간 미확인'}</span>{knownValue(visit.siteName)}</strong>
                            <span>{knownValue(visit.title)}</span><small>{knownValue(visit.assignee)} · {visit.state}</small>{editingLabel(visit)}</button>
                            {canEdit && view !== 'list' && <button className="calendar-drag-handle" type="button"
                                aria-label={visitLabel(visit) + ' 날짜 이동'} aria-pressed={moveSelection?.id === visit.id}
                                disabled={!!pendingMove} onPointerDown={event => startPointerDrag(event,visit)}
                                onPointerMove={updatePointerDrag} onPointerUp={event => endPointerDrag(event,true)}
                                onPointerCancel={endPointerDrag} onLostPointerCapture={endPointerDrag}
                                onClick={event => {
                                    if (event.detail && draggedHandle.current === event.currentTarget) return;
                                    const next = moveSelection?.id === visit.id ? null : visit;
                                    setMoveSelection(next);
                                    if (next) document.querySelector<HTMLButtonElement>('.calendar-date[aria-pressed=true]')?.focus();
                                }}><GripVertical size={18} aria-hidden="true"/></button>}
                        </div>) :
                            <p>{ready ? '등록된 일정이 없습니다.' : '일정을 확인하는 중입니다.'}</p>}
                    </section>
                    <section>
                        <div className="calendar-side-title"><h3>날짜 미정 <small>{unscheduled.length}</small></h3>
                            {canEdit && <button aria-label="날짜 미정 일정 추가" disabled={!ready} onClick={() => openEditor(newSchedule(''))}><Plus size={17}/></button>}
                        </div>
                        {unscheduled.length ? unscheduled.map(row => <button key={row.id} className="visit-card" data-kind={workKinds.indexOf(row.kind)}
                            onClick={() => openVisit({...row,occurrenceDate:''})}><strong>{knownValue(row.siteName)}</strong><span>{knownValue(row.title)}</span><small>{knownValue(row.assignee)} · {row.state}</small>{editingLabel({...row,occurrenceDate:''})}</button>) :
                            <p>날짜를 정할 작업이 여기에 표시됩니다.</p>}
                    </section>
                </aside>
            </div>
            <div className="calendar-legend">{workKinds.map((label,index) => <span key={label} data-kind={index}>{label}</span>)}
                <small>엑셀과 이미지는 선택한 달의 전체 날짜 일정을 담습니다.</small>
            </div>
            {moveMessage && <div className="calendar-move-toast" role={moveMessage.failed ? 'alert' : 'status'}>{moveMessage.text}</div>}
            <div className="calendar-drag-ghost" aria-hidden="true" hidden ref={dragGhost}/>
            {active && <dialog className="schedule-dialog calendar-details" aria-labelledby="visit-detail-title" ref={details}
                data-closing={detailClosing} inert={detailClosing}
                onCancel={event => { event.preventDefault(); closeVisit(); }}>
                <div className="calendar-side-title"><h2 id="visit-detail-title">{knownValue(active.siteName)} · {knownValue(active.title)}</h2><button onClick={closeVisit}>닫기</button></div>
                {editingLabel(active)}
                <p>{active.occurrenceDate ? dayLabel(active.occurrenceDate) : '날짜 미확인'} · {active.start || '시간 미확인'}{active.end && '–' + active.end} · {active.kind} · {active.state}</p>
                <p>담당 {knownValue(active.assignee)}</p>
                <p><MapPin size={16}/> {knownValue(active.address)} {knownValue(active.address) !== '미확인' && <a href={'https://map.naver.com/p/search/' + encodeURIComponent(active.address)}
                    target="_blank" rel="noreferrer">지도 열기</a>}</p>
                <p className="calendar-notes">메모 {knownValue(active.notes)}</p>
                {canEdit && <div className="calendar-actions"><button className="schedule-primary" disabled={working || pendingMove?.id === active.id} onClick={() => openEditor(editOccurrence(active))}>일정 수정</button>
                    {!!active.occurrenceDate && active.state === '예정' && <button disabled={working || pendingMove?.id === active.id}
                        onClick={() => void act(() => save({...editOccurrence(active),state:'완료'}))}>작업 완료</button>}
                    <button disabled={working || pendingMove?.id === active.id} onClick={() => openEditor({ ...active, id:crypto.randomUUID(), date:active.occurrenceDate,
                        repeat:'none', until:'', seriesId:'', originalDate:'', state:'예정', revision:0 })}>복제</button></div>}
            </dialog>}
            {canEdit && editor && <ScheduleEditor key={editor.id + effectiveDate} initial={editor} sites={sites} visits={visits} effectiveDate={effectiveDate}
                editorStatus={editingVisit ? <div role="status">{editingLabel(editingVisit)}</div> : editorStatus}
                onClose={() => setEditor(null)} onSave={value => save(value,effectiveDate)} onDelete={remove}
                onSeries={editor.seriesId && parent ? () => openEditor(parent) : undefined}
                onFuture={editor.seriesId && parent && active && !active.seriesId ? editFuture : undefined}/>}
            {canEdit && importOpen && <CalendarImportDialog sites={sites} month={month} onClose={() => setImportOpen(false)} onImportBatch={schedules => {
                requireCalendarWrite();
                return post('calendar/import',{schedules});
            }} onImported={(message, importedMonth) => {
                if (importedMonth && importedMonth !== month) goMonth(importedMonth);
                setImportOpen(false); setNotice(message); refresh(value => value + 1);
            }}/>}
        </main>
    </div>;
}
