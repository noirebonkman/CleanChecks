import { useEffect, useRef, useState } from 'react';
import type { Site } from '../inspection-model';
import { workKinds } from './calendar-model';
import { importSchedule, readScheduleWorkbook, type ImportRow } from './calendar-import';
import { post } from './client';

type PreviewRow = ImportRow & { include: boolean };
const pageSize = 20;

export function CalendarImportDialog({ sites, onClose, onImported }: {
    sites: Site[];
    onClose: () => void;
    onImported: (message: string) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [rows, setRows] = useState<PreviewRow[]>([]);
    const [issues, setIssues] = useState<string[]>([]);
    const [page, setPage] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => { dialog.current?.showModal(); }, []);
    const selected = rows.filter(row => row.include);
    const unselected = rows.length - selected.length;
    const pageCount = Math.max(1,Math.ceil(rows.length / pageSize));
    const visible = rows.slice(page * pageSize,(page + 1) * pageSize);

    async function load(file: File) {
        setBusy(true);
        setMessage('');
        setRows([]);
        setIssues([]);
        setPage(0);
        try {
            const result = await readScheduleWorkbook(file,sites);
            setRows(result.rows.map(row => ({ ...row, include:!row.review })));
            setIssues(result.issues);
            if (!result.rows.length) setMessage('가져올 수 있는 일정이 없습니다.');
        } catch (error) { setMessage(error instanceof Error ? error.message : '엑셀을 읽지 못했습니다.'); }
        finally { setBusy(false); }
    }

    function update(index: number, change: Partial<PreviewRow>) {
        setRows(current => current.map((row,number) => number === index ? { ...row,...change } : row));
    }

    async function save() {
        if (busy || !selected.length) return;
        if (selected.some(row => !row.siteName.trim() || !row.title.trim())) {
            setMessage('선택한 일정의 현장명과 작업명을 입력해 주세요.');
            return;
        }
        setBusy(true);
        setMessage('');
        let added = 0, processed = 0;
        try {
            const schedules = await Promise.all(selected.map(row => importSchedule(row)));
            for (let index = 0; index < schedules.length; index += 50) {
                const batch = schedules.slice(index,index + 50);
                const result = await post<{added:number}>('calendar/import',{schedules:batch});
                added += result.added;
                processed += batch.length;
                setMessage(processed + ' / ' + selected.length + '건 확인했습니다.');
            }
            onImported(added + '건을 추가했습니다. 이미 등록된 일정 ' + (processed - added) + '건은 건너뛰었습니다.');
        } catch (error) {
            setMessage((added ? added + '건 저장 후 중단됐습니다. 다시 시도하면 기존 항목을 건너뜁니다. ' : '') +
                (error instanceof Error ? error.message : '가져오기에 실패했습니다.'));
        } finally { setBusy(false); }
    }

    return <dialog ref={dialog} className="schedule-dialog calendar-import-dialog" aria-labelledby="calendar-import-title"
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <header><h2 id="calendar-import-title">엑셀 일정 가져오기</h2><button disabled={busy} onClick={onClose}>닫기</button></header>
        <p>월~일 스케줄표 또는 날짜·현장명·작업명 열이 있는 파일을 선택하세요. 한 날짜의 일정으로 가져옵니다.</p>
        <label className="calendar-import-file">일정 엑셀
            <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={event => {
                const file = event.target.files?.[0];
                if (file) void load(file);
                event.target.value = '';
            }}/>
        </label>
        {!!issues.length && <details><summary>파일에서 확인할 항목 {issues.length}건</summary>
            <ul>{issues.map((issue,index) => <li key={index}>{issue}</li>)}</ul>
        </details>}
        {!!rows.length && <>
            <p>선택 {selected.length}건 · 제외 {unselected}건</p>
            <div className="calendar-import-list">
                {visible.map((row,offset) => {
                    const index = page * pageSize + offset;
                    return <section key={index}>
                        <label className="calendar-import-include"><input type="checkbox" checked={row.include} disabled={busy}
                            onChange={event => update(index,{include:event.target.checked})}/>
                            <strong>{row.date || '날짜 미정'} {row.start}</strong> <small>{row.source}</small></label>
                        {row.review && <p className="schedule-warning">{row.review} 내용을 확인한 뒤 선택하세요.</p>}
                        <div className="schedule-fields">
                            <label>현장명<input maxLength={200} disabled={busy} value={row.siteName} onChange={event => {
                                const siteName = event.target.value;
                                const matches = sites.filter(site => site.name === siteName);
                                const match = matches.length === 1 ? matches[0] : undefined;
                                update(index,{siteName,siteId:match?.id || '',address:match?.address || (row.siteId ? '' : row.address)});
                            }}/></label>
                            <label>작업명<input maxLength={200} disabled={busy} value={row.title} onChange={event => update(index,{title:event.target.value})}/></label>
                            <label>작업 구분<select disabled={busy} value={row.kind} onChange={event => update(index,{kind:event.target.value as ImportRow['kind']})}>
                                {workKinds.map(kind => <option key={kind}>{kind}</option>)}
                            </select></label>
                            {row.review && <label>등록 현장 연결<select disabled={busy} value={row.siteId} onChange={event => {
                                const site = sites.find(site => site.id === event.target.value);
                                update(index,{siteId:site?.id || '',siteName:site?.name || row.siteName,address:site?.address || ''});
                            }}>
                                <option value="">직접 입력</option>
                                {sites.map(site => <option key={site.id} value={site.id}>{site.name}{site.zone ? ' · ' + site.zone : ''}</option>)}
                            </select></label>}
                        </div>
                    </section>;
                })}
            </div>
            <footer>
                <button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>이전</button>
                <span>{page + 1} / {pageCount}</span>
                <button disabled={busy || page + 1 === pageCount} onClick={() => setPage(page + 1)}>다음</button>
                <button className="schedule-primary" disabled={busy || !selected.length} onClick={() => void save()}>선택 일정 가져오기</button>
            </footer>
        </>}
        {message && <p role="status" className="calendar-feedback">{message}</p>}
    </dialog>;
}
