import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Download, LogOut, MapPin, Plus, Search } from 'lucide-react';
import { hasPermission } from '../access-control';
import type { Site } from '../inspection-model';
import { readTheme } from '../preferences';
import { dateKey, monthDays, occurrenceId, shiftDay, todayKey, visitLabel, visitsByDay, weekdays, workKinds, workStates, type SavedSchedule, type Schedule, type Visit } from './calendar-model';
import { CalendarImportDialog } from './CalendarImportDialog';
import { post, request, type ServerUser } from './client';
import { ScheduleEditor } from './ScheduleEditor';
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

export function FieldCalendar({ user, onMenu, onLogout }: { user: ServerUser; onMenu: () => void; onLogout: () => Promise<void> }) {
    const canEdit = hasPermission(user, 'manageSites');
    const [month, setMonth] = useState(() => todayKey().slice(0,7));
    const [day, setDay] = useState(todayKey);
    const [view, setView] = useState<'month' | 'week' | 'list'>('month');
    const [rows, setRows] = useState<SavedSchedule[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('');
    const [assignee, setAssignee] = useState('');
    const [status, setStatus] = useState('');
    const [showUnassigned, setShowUnassigned] = useState(false);
    const [reminder, setReminder] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [active, setActive] = useState<Visit | null>(null);
    const [editor, setEditor] = useState<SavedSchedule | null>(null);
    const [effectiveDate, setEffectiveDate] = useState('');
    const [revision, refresh] = useState(0);
    const [loaded, setLoaded] = useState('');
    const [loadError, setLoadError] = useState('');
    const [notice, setNotice] = useState('');
    const [working, setWorking] = useState(false);
    const drag = useRef<Visit | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const details = useRef<HTMLDialogElement>(null);
    useEffect(() => { heading.current?.focus(); }, []);
    useEffect(() => {
        if (active && !editor && !details.current?.open) details.current?.showModal();
        if (editor && details.current?.open) details.current.close();
    }, [active,editor]);
    useEffect(() => {
        const controller = new AbortController();
        setLoadError('');
        void request<{schedules: SavedSchedule[]}>('calendar?month=' + month,{signal:controller.signal}).then(result => {
            if (!controller.signal.aborted) { setRows(result.schedules); setLoaded(month); }
        }).catch(cause => { if (!controller.signal.aborted) setLoadError(cause.message); });
        return () => controller.abort();
    }, [month,revision]);
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
    const visits = useMemo(() => visitsByDay(ready ? rows : [], days), [ready,rows,days]);
    const names = [...new Set([assignee,...(ready ? rows.flatMap(row => [row.assignee,...(row.previousRules || []).map(rule => rule.assignee)]) : [])]
        .filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'));
    const search = query.trim().toLowerCase();
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

    function selectDay(date: string) { setDay(date); setActive(null); }
    function goMonth(next: string) {
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(next)) return;
        setMonth(next);
        selectDay(next === todayKey().slice(0,7) ? todayKey() : next + '-01');
    }
    function movePeriod(step: number) {
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
    function openEditor(value: SavedSchedule, cutoff = '') { setEffectiveDate(cutoff); setEditor(value); }
    async function save(value: SavedSchedule, cutoff = '') {
        const result = await post<{revision:number;schedule?:Schedule}>('calendar/' + value.id,
            { schedule:value, revision:value.revision, effectiveDate:cutoff },'PUT');
        setRows(current => [...current.filter(row => row.id !== value.id), {...(result.schedule || value),revision:result.revision}]);
        if (value.date && value.date.slice(0,7) !== month) goMonth(value.date.slice(0,7));
        if (value.date) selectDay(value.date);
        setEditor(null);
        setActive(null);
        refresh(value => value + 1);
        setNotice('일정을 저장했습니다.');
    }
    async function remove() {
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

    return <div className="login-shell calendar-shell" data-theme={readTheme()}>
        <main className="field-calendar" aria-labelledby="field-calendar-title">
            <header className="calendar-header">
                <div>
                    <button className="calendar-plain" onClick={onMenu}><ArrowLeft size={17}/>서비스 선택</button>
                    <h1 id="field-calendar-title" ref={heading} tabIndex={-1}><CalendarDays size={24}/>현장 일정 캘린더</h1>
                </div>
                <div className="calendar-actions">
                    {canEdit && <button disabled={!ready} onClick={() => setImportOpen(true)}>엑셀 가져오기</button>}
                    {canEdit && <button className="schedule-primary" disabled={!ready} onClick={() => openEditor(newSchedule(day))}><Plus size={17}/>일정 추가</button>}
                    <button disabled={working} onClick={() => void act(onLogout)}><LogOut size={16}/>로그아웃</button>
                </div>
            </header>
            <div className="calendar-toolbar">
                <div className="calendar-actions">
                    <button aria-label={view === 'week' ? '이전 주' : '이전 달'} onClick={() => movePeriod(-1)}><ChevronLeft size={19}/></button>
                    <h2>{view === 'week' ? dayLabel(visibleDays[0]) + '–' + dayLabel(visibleDays[6]) : monthLabel(month)}</h2>
                    <button aria-label={view === 'week' ? '다음 주' : '다음 달'} onClick={() => movePeriod(1)}><ChevronRight size={19}/></button>
                    <button onClick={() => goMonth(todayKey().slice(0,7))}>오늘</button>
                    <label className="calendar-select"><span>월 이동</span><input type="month" min="2000-01" max="2099-12" value={month}
                        onChange={event => goMonth(event.target.value)}/></label>
                </div>
                <div className="calendar-actions">
                    <label className="calendar-select"><span>보기</span><select value={view} onChange={event => setView(event.target.value as typeof view)}>
                        <option value="month">월간</option><option value="week">주간</option><option value="list">목록</option>
                    </select></label>
                    <button disabled={!ready || working} onClick={() => download('xlsx')}><Download size={16}/>엑셀</button>
                    <button disabled={!ready || working} onClick={() => download('png')}><Download size={16}/>이미지</button>
                    <details className="calendar-export-options">
                        <summary>캘린더 파일</summary>
                        <div>
                            <label><input type="checkbox" checked={reminder} onChange={event => setReminder(event.target.checked)}/> 시작 1시간 전 알림 포함</label>
                            <button disabled={!ready || working} onClick={() => download('ics')}><Download size={16}/>ICS 내려받기</button>
                            <small>가져온 일정은 CleanChecks와 자동 동기화되지 않습니다.</small>
                        </div>
                    </details>
                </div>
            </div>
            <div className="calendar-filters">
                <label className="calendar-search"><Search size={17}/><input aria-label="일정 검색" placeholder="현장명, 작업명, 담당자" value={query} onChange={e => setQuery(e.target.value)}/></label>
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
                {(query || kind || assignee || status || showUnassigned) && <button onClick={() => {
                    setQuery(''); setKind(''); setAssignee(''); setStatus(''); setShowUnassigned(false);
                }}>필터 초기화</button>}
            </div>
            {ready && <div className="calendar-summary" aria-label="월간 일정 현황">
                <span>월간 일정 <strong>{monthVisits.length}</strong></span>
                <span>완료 <strong>{completed}</strong></span>
                <span>담당 미배정 <strong>{unassigned}</strong></span>
                <span>날짜 미정 <strong>{awaitingDate}</strong></span>
            </div>}
            {loadError ? <div role="alert" className="calendar-feedback">{loadError} <button onClick={() => refresh(value => value + 1)}>다시 불러오기</button></div> :
                !ready && <p role="status" className="calendar-feedback">일정을 불러오는 중입니다…</p>}
            {notice && <p role="status" className="calendar-feedback">{notice}</p>}
            <div className="calendar-workspace">
                {view === 'list' ? <div className="calendar-month-list">
                    {inMonth.filter(date => (visits.get(date) || []).some(filter)).map(date => <section key={date}>
                        <h3>{dayLabel(date)}</h3>{(visits.get(date) || []).filter(filter).map(visit =>
                            <button key={visit.id} className="visit-chip" data-kind={workKinds.indexOf(visit.kind)} onClick={() => openVisit(visit)}>{visitLabel(visit)}</button>)}
                    </section>)}
                    {ready && !inMonth.some(date => (visits.get(date) || []).some(filter)) && <p className="calendar-feedback">표시할 일정이 없습니다.</p>}
                </div> : <div className="calendar-grid" aria-label={monthLabel(month) + ' 일정표'}>
                    {weekdays.map(label => <div className="calendar-weekday" key={label}>{label}</div>)}
                    {visibleDays.map(date => {
                        const entries = (visits.get(date) || []).filter(filter);
                        return <div key={date} className="calendar-day" data-selected={date === day} data-other={!date.startsWith(month)}
                            onDragOver={event => { if (drag.current && canEdit) event.preventDefault(); }}
                            onDrop={event => {
                                event.preventDefault();
                                if (drag.current && canEdit) openEditor(editOccurrence(drag.current,date));
                                drag.current = null;
                            }}>
                            <button className="calendar-date" aria-pressed={date === day} aria-current={date === todayKey() ? 'date' : undefined}
                                aria-label={dayLabel(date) + ' 일정 ' + entries.length + '건'} onClick={() => selectDay(date)}>
                                <span>{Number(date.slice(8))}</span>{entries.length > 0 && <small>{entries.length}</small>}
                            </button>
                            <div className="calendar-day-visits">
                                {entries.slice(0,3).map(visit => <button key={visit.id} className="visit-chip" data-kind={workKinds.indexOf(visit.kind)}
                                    data-state={visit.state} onClick={() => openVisit(visit)} draggable={canEdit}
                                    onDragStart={event => { drag.current = visit; event.dataTransfer.setData('text/plain',visit.id); }}
                                    onDragEnd={() => { drag.current = null; }}>{visitLabel(visit)}</button>)}
                                {entries.length > 3 && <button className="calendar-more" onClick={() => selectDay(date)}>+{entries.length - 3}건</button>}
                            </div>
                        </div>;
                    })}
                </div>}
                <aside className="calendar-side" aria-label="선택 날짜와 날짜 미정 일정">
                    <section>
                        <div className="calendar-side-title"><h3>{dayLabel(day)} 일정</h3>
                            {canEdit && <button aria-label={dayLabel(day) + ' 일정 추가'} disabled={!ready} onClick={() => openEditor(newSchedule(day))}><Plus size={17}/></button>}
                        </div>
                        {selected.length ? selected.map(visit => <button key={visit.id} className="visit-card" data-kind={workKinds.indexOf(visit.kind)}
                            onClick={() => openVisit(visit)}><strong>{visit.siteName}</strong><span>{visit.title}</span>
                            <small>{visit.start ? visit.start + (visit.end ? '–' + visit.end : '') : '시간 미정'} · {visit.assignee || '담당 미정'} · {visit.state}</small></button>) :
                            <p>{ready ? '등록된 일정이 없습니다.' : '일정을 확인하는 중입니다.'}</p>}
                    </section>
                    <section>
                        <div className="calendar-side-title"><h3>날짜 미정 <small>{unscheduled.length}</small></h3>
                            {canEdit && <button aria-label="날짜 미정 일정 추가" disabled={!ready} onClick={() => openEditor(newSchedule(''))}><Plus size={17}/></button>}
                        </div>
                        {unscheduled.length ? unscheduled.map(row => <button key={row.id} className="visit-card" data-kind={workKinds.indexOf(row.kind)}
                            onClick={() => openVisit({...row,occurrenceDate:''})}><strong>{row.siteName}</strong><span>{row.title}</span><small>{row.assignee || '담당 미정'} · {row.state}</small></button>) :
                            <p>날짜를 정할 작업이 여기에 표시됩니다.</p>}
                    </section>
                </aside>
            </div>
            <div className="calendar-legend">{workKinds.map((label,index) => <span key={label} data-kind={index}>{label}</span>)}
                <small>엑셀과 이미지는 선택한 달의 전체 날짜 일정을 담습니다.</small>
            </div>
            {active && <dialog className="schedule-dialog calendar-details" aria-labelledby="visit-detail-title" ref={details}
                onCancel={event => { event.preventDefault(); setActive(null); }}>
                <div className="calendar-side-title"><h2 id="visit-detail-title">{active.siteName} · {active.title}</h2><button onClick={() => setActive(null)}>닫기</button></div>
                <p>{active.occurrenceDate ? dayLabel(active.occurrenceDate) : '날짜 미정'} · {active.start || '시간 미정'}{active.end && '–' + active.end} · {active.kind} · {active.state}</p>
                <p>담당 {active.assignee || '미배정'}</p>
                {active.address && <p><MapPin size={16}/> {active.address} <a href={'https://map.naver.com/p/search/' + encodeURIComponent(active.address)}
                    target="_blank" rel="noreferrer">지도 열기</a></p>}
                {active.notes && <p className="calendar-notes">{active.notes}</p>}
                {canEdit && <div className="calendar-actions"><button className="schedule-primary" disabled={working} onClick={() => openEditor(editOccurrence(active))}>일정 수정</button>
                    {!!active.occurrenceDate && active.state === '예정' && <button disabled={working}
                        onClick={() => void act(() => save({...editOccurrence(active),state:'완료'}))}>작업 완료</button>}
                    <button disabled={working} onClick={() => openEditor({ ...active, id:crypto.randomUUID(), date:active.occurrenceDate,
                        repeat:'none', until:'', seriesId:'', originalDate:'', state:'예정', revision:0 })}>복제</button></div>}
            </dialog>}
            {editor && <ScheduleEditor key={editor.id + effectiveDate} initial={editor} sites={sites} visits={visits} effectiveDate={effectiveDate}
                onClose={() => setEditor(null)} onSave={value => save(value,effectiveDate)} onDelete={remove}
                onSeries={editor.seriesId && parent ? () => openEditor(parent) : undefined}
                onFuture={editor.seriesId && parent && active && !active.seriesId ? editFuture : undefined}/>}
            {importOpen && <CalendarImportDialog sites={sites} month={month} onClose={() => setImportOpen(false)} onImported={(message, importedMonth) => {
                if (importedMonth && importedMonth !== month) goMonth(importedMonth);
                setImportOpen(false); setNotice(message); refresh(value => value + 1);
            }}/>}
        </main>
    </div>;
}
