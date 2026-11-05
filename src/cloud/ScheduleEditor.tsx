import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Site } from '../inspection-model';
import { repeatOptions, sameAssignee, visitLabel, workKinds, workStates, type SavedSchedule, type Visit } from './calendar-model';

export function ScheduleEditor({ initial, sites, visits, effectiveDate, onClose, onSave, onDelete, onSeries, onFuture }: {
    initial: SavedSchedule;
    sites: Site[];
    visits: Map<string, Visit[]>;
    effectiveDate?: string;
    onClose: () => void;
    onSave: (value: SavedSchedule) => Promise<void>;
    onDelete: () => Promise<void>;
    onSeries?: () => void;
    onFuture?: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [value, setValue] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    useEffect(() => { dialog.current?.showModal(); }, []);
    const change = <K extends keyof SavedSchedule>(key: K, next: SavedSchedule[K]) =>
        setValue(current => ({ ...current, [key]:next }));
    const overlapping = value.state === '취소' || !value.start ? [] : (visits.get(value.date) || []).filter(visit => {
        if (visit.id === value.id || (visit.id === value.seriesId && visit.occurrenceDate === value.originalDate)
            || visit.state === '취소' || !visit.start || !sameAssignee(value.assignee, visit.assignee)) return false;
        if (value.start === visit.start) return true;
        return value.start < (visit.end || visit.start) && visit.start < (value.end || value.start);
    });
    async function run(action: () => Promise<void>) {
        if (busy) return;
        setBusy(true);
        setError('');
        try { await action(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '일정을 저장하지 못했습니다.'); }
        finally { setBusy(false); }
    }
    function submit(event: FormEvent) {
        event.preventDefault();
        void run(() => onSave(value));
    }
    return <dialog className="schedule-dialog" ref={dialog} aria-labelledby="schedule-editor-title"
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <form onSubmit={submit}>
            <header>
                <h2 id="schedule-editor-title">{value.repeat !== 'none' && value.revision ? '반복 일정 수정' : value.revision || value.seriesId ? '일정 수정' : '새 일정'}</h2>
                <button type="button" disabled={busy} onClick={onClose}>닫기</button>
            </header>
            {onSeries && <p className="schedule-editor-note">이 날짜의 일정만 수정합니다. <button type="button" disabled={busy} onClick={onSeries}>현재 반복 규칙 편집</button>
                {onFuture && <button type="button" disabled={busy} onClick={onFuture}>이 날짜부터 변경</button>}</p>}
            {effectiveDate ? <p className="schedule-editor-note">{effectiveDate}부터 새 반복 규칙을 적용합니다. 이전 날짜와 개별 변경한 일정은 보존됩니다.</p> :
                initial.revision > 0 && initial.repeat !== 'none' && <p className="schedule-editor-note">현재 반복 규칙을 따르는 날짜에 적용됩니다.</p>}
            <fieldset disabled={busy} className="schedule-fields">
                <label className="schedule-field-wide">등록된 현장
                    <select value={value.siteId} onChange={event => {
                        const site = sites.find(site => site.id === event.target.value);
                        setValue(current => ({ ...current, siteId:site?.id || '', siteName:site?.name || current.siteName, address:site?.address || current.address }));
                    }}>
                        <option value="">직접 입력</option>
                        {value.siteId && !sites.some(site => site.id === value.siteId) && <option value={value.siteId}>{value.siteName}</option>}
                        {sites.map(site => <option key={site.id} value={site.id}>{site.name}{site.zone ? ' · ' + site.zone : ''}</option>)}
                    </select>
                </label>
                <label>현장명<input required maxLength={200} value={value.siteName} readOnly={!!value.siteId} onChange={e => change('siteName',e.target.value)}/></label>
                <label>작업명<input required maxLength={200} placeholder="예: 에어컨 4way 세척" value={value.title} onChange={e => change('title',e.target.value)}/></label>
                <label>구분<select value={value.kind} onChange={e => change('kind',e.target.value as SavedSchedule['kind'])}>
                    {workKinds.map(kind => <option key={kind}>{kind}</option>)}
                </select></label>
                <label>상태<select value={value.state} onChange={e => change('state',e.target.value as SavedSchedule['state'])}>
                    {workStates.map(state => <option key={state}>{state}</option>)}
                </select></label>
                <label>{value.repeat !== 'none' ? '반복 시작일' : '작업 날짜'}
                    <input type="date" min={effectiveDate || '2000-01-01'} max="2099-12-31" required={!!value.seriesId || value.repeat !== 'none'}
                        value={value.date} onChange={e => setValue(current => e.target.value ? { ...current, date:e.target.value } :
                            { ...current, date:'', start:'', end:'' })}/>
                </label>
                <label>담당자 / 팀<input maxLength={100} value={value.assignee} onChange={e => change('assignee',e.target.value)} placeholder="미배정"/></label>
                <label>시작 시간<input type="time" disabled={!value.date} value={value.start} onChange={e => {
                    const start = e.target.value;
                    setValue(current => ({ ...current, start, end:start ? current.end : '' }));
                }}/></label>
                <label>종료 시간<input type="time" disabled={!value.date || !value.start} value={value.end} onChange={e => change('end',e.target.value)}/></label>
                {!value.seriesId && (!value.revision || initial.repeat !== 'none') && <>
                    <label>반복<select disabled={!value.date} value={value.repeat} onChange={e => setValue(current => ({
                        ...current, repeat:e.target.value as SavedSchedule['repeat'], until:e.target.value === 'none' ? '' : current.until,
                    }))}>
                        {Object.entries(repeatOptions).filter(([key]) => key !== 'none' || !value.revision).map(([key,label]) => <option value={key} key={key}>{label}</option>)}
                    </select></label>
                    {value.repeat !== 'none' && <label>반복 종료일<input type="date" min={value.date} max="2099-12-31" value={value.until} onChange={e => change('until',e.target.value)}/></label>}
                </>}
                <label className="schedule-field-wide">주소<input maxLength={500} value={value.address} onChange={e => change('address',e.target.value)}/></label>
                <label className="schedule-field-wide">메모<textarea rows={2} maxLength={2000} placeholder="작업 수량, 준비물, 현장 전달 사항" value={value.notes} onChange={e => change('notes',e.target.value)}/></label>
            </fieldset>
            {!value.date && <p className="schedule-editor-note">날짜를 비워두면 날짜 미정 목록에 저장됩니다.</p>}
            {!!overlapping.length && <p role="status" className="schedule-warning">담당 시간이 겹칩니다. {overlapping.map(visitLabel).join(' / ')}</p>}
            {error && <p role="alert" className="schedule-warning">{error}</p>}
            <footer>
                {initial.revision > 0 && !initial.seriesId && !effectiveDate && <button type="button" disabled={busy} className="schedule-danger"
                    onClick={() => confirmDelete ? void run(onDelete) : setConfirmDelete(true)}>{confirmDelete ? '삭제 확정' : '삭제'}</button>}
                {confirmDelete && initial.repeat !== 'none' && <small>반복 일정 전체가 삭제됩니다.</small>}
                <button type="submit" className="schedule-primary" disabled={busy}>{busy ? '처리 중…' : '일정 저장'}</button>
            </footer>
        </form>
    </dialog>;
}
