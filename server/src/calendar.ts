import { monthDays, occursOn, occurrenceId, repeatOptions, shiftDay, workKinds, workStates, type Schedule } from '../../src/cloud/calendar-model';
import { requirePermission } from './account-permissions';
import type { Account, Environment } from './bindings';
import { digest, open, seal } from './security';
import { ApiError, id, jsonBody, revision, text } from './validation';

function dateValue(value: unknown) {
    const date = text(value ?? '', '날짜', 10);
    const parsed = new Date(date + 'T00:00:00Z');
    if (date && (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== date))
        throw new ApiError(400, '날짜를 확인해 주세요.');
    return date;
}
function timeValue(value: unknown) {
    const time = text(value ?? '', '시간', 5);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError(400, '시간을 확인해 주세요.');
    return time;
}
function schedule(value: unknown, key: string): Schedule {
    if (!value || typeof value !== 'object') throw new ApiError(400, '일정 내용을 입력해 주세요.');
    const input = value as Record<string, unknown>;
    const kind = workKinds.find(kind => kind === input.kind);
    const state = workStates.find(state => state === input.state);
    const repeat = (Object.keys(repeatOptions) as Schedule['repeat'][]).find(rule => rule === input.repeat);
    const date = dateValue(input.date), until = dateValue(input.until);
    const start = timeValue(input.start), end = timeValue(input.end);
    const seriesId = input.seriesId ? id(input.seriesId) : '', originalDate = dateValue(input.originalDate);
    if (!kind || !state || !repeat || (end && (!start || end <= start)) || (!date && (start || repeat !== 'none'))
        || (until && (repeat === 'none' || until < date)) || (!!seriesId !== !!originalDate)
        || (seriesId && (!date || repeat !== 'none' || key !== occurrenceId(seriesId, originalDate))))
        throw new ApiError(400, '일정 유형, 시작·종료 시간, 반복 설정을 확인해 주세요.');
    return { id:key, date, until, start, end, kind, state, repeat, seriesId, originalDate,
        siteId:input.siteId ? id(input.siteId) : '', siteName:text(input.siteName,'현장명',200,true).trim(),
        title:text(input.title,'작업명',200,true).trim(), address:text(input.address ?? '', '주소', 500),
        assignee:text(input.assignee ?? '', '담당자',100).trim(), notes:text(input.notes ?? '', '메모',2000) };
}

type ScheduleRow = { id: string; payload: string; revision: number; repeat_rule: string; series_id: string | null };

async function importSchedules(request: Request, env: Environment) {
    const { schedules } = await jsonBody(request);
    if (!Array.isArray(schedules) || schedules.length < 1 || schedules.length > 50)
        throw new ApiError(400, '한 번에 1~50건씩 가져올 수 있습니다.');
    const statements = await Promise.all(schedules.map(async input => {
        const key = id(input?.id);
        if (!/^import-[0-9a-f]{64}$/.test(key)) throw new ApiError(400, '가져오기 일정 번호를 확인해 주세요.');
        const value = schedule(input,key);
        if (value.seriesId || value.repeat !== 'none') throw new ApiError(400, '가져오기는 날짜별 일정을 지원합니다.');
        return env.DB.prepare(`INSERT INTO calendar_schedules VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING`)
            .bind(key,value.date,'','none',null,'',await seal(value,env));
    }));
    const results = await env.DB.batch(statements);
    return { added:results.reduce((total,result) => total + result.meta.changes,0) };
}

export async function calendarRoute(request: Request, env: Environment, account: Account, url: URL) {
    if (url.pathname === '/api/calendar' && request.method === 'GET') {
        const month = url.searchParams.get('month') || '';
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, '조회할 월을 확인해 주세요.');
        const days = monthDays(month), first = days[0], last = days[days.length - 1];
        const { results } = await env.DB.prepare(`SELECT id,payload,revision FROM calendar_schedules
            WHERE scheduled_date='' OR scheduled_date BETWEEN ? AND ? OR original_date BETWEEN ? AND ?
            OR (repeat_rule<>'none' AND scheduled_date<=? AND (until_date='' OR until_date>=?))
            ORDER BY scheduled_date,id LIMIT 2001`).bind(first,last,first,last,last,first).all<ScheduleRow>();
        if (results.length > 2000) throw new ApiError(413, '해당 월에 조회할 일정이 너무 많습니다.');
        const version = await digest(JSON.stringify(results.map(row => [row.id,row.revision])));
        if (url.searchParams.get('since') === version) return { version, unchanged:true };
        return { version, schedules: await Promise.all(results.map(async row => ({ ...await open<Schedule>(row.payload,env), revision:row.revision }))) };
    }

    if (url.pathname === '/api/calendar/import' && request.method === 'POST') {
        requirePermission(account, 'manageSites');
        return importSchedules(request,env);
    }
    const match = /^\/api\/calendar\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
    if (!match || !['PUT','DELETE'].includes(request.method)) throw new ApiError(404, '지원하지 않는 일정 요청입니다.');
    requirePermission(account, 'manageSites');
    const key = id(match[1]), body = await jsonBody(request), expected = revision(body.revision);
    const conflict = () => new ApiError(409, '다른 기기에서 일정이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
    if (request.method === 'DELETE') {
        const result = await env.DB.prepare('DELETE FROM calendar_schedules WHERE id=? AND revision=? AND series_id IS NULL')
            .bind(key,expected).run();
        if (result.meta.changes !== 1) throw conflict();
        return { ok:true };
    }
    const value = schedule(body.schedule,key);
    const existing = await env.DB.prepare('SELECT payload,revision,repeat_rule,series_id FROM calendar_schedules WHERE id=?')
        .bind(key).first<ScheduleRow>();
    if ((existing?.revision ?? 0) !== expected) throw conflict();
    if (existing && (existing.series_id !== (value.seriesId || null) || (existing.repeat_rule === 'none') !== (value.repeat === 'none')))
        throw new ApiError(400, '저장된 일정의 단발·반복 유형은 변경할 수 없습니다.');
    const effectiveDate = dateValue(body.effectiveDate);
    if (existing && value.repeat !== 'none') {
        const previous = await open<Schedule>(existing.payload,env);
        const { previousRules = [], ...currentRule } = previous;
        if (effectiveDate) {
            if (value.date < effectiveDate || !occursOn(previous,effectiveDate))
                throw new ApiError(400, '선택한 반복 일정 날짜 이후부터 변경해 주세요.');
            const cutoff = shiftDay(effectiveDate,-1);
            value.previousRules = [...previousRules,currentRule].filter(rule => rule.date <= cutoff).map(rule => ({
                ...rule, until:rule.until && rule.until < cutoff ? rule.until : cutoff,
            }));
            if (value.previousRules.length > 100) throw new ApiError(400, '반복 규칙 변경 이력이 너무 많습니다.');
        } else {
            const last = previousRules.at(-1);
            if (last && value.date <= last.until) throw new ApiError(400, '반복 시작일은 보존된 이전 규칙의 종료일 이후여야 합니다.');
            if (previousRules.length) value.previousRules = previousRules;
        }
    } else if (effectiveDate) {
        throw new ApiError(400, '반복 일정의 날짜를 확인해 주세요.');
    }
    if (value.seriesId && !existing) {
        const parent = await env.DB.prepare('SELECT payload FROM calendar_schedules WHERE id=? AND repeat_rule<>?')
            .bind(value.seriesId,'none').first<ScheduleRow>();
        if (!parent || !occursOn(await open<Schedule>(parent.payload,env),value.originalDate)) throw conflict();
    }
    const encrypted = await seal(value,env);
    const result = expected === 0
        ? await env.DB.prepare(`INSERT INTO calendar_schedules VALUES(?,?,?,?,?,?,?,1)
            ON CONFLICT(id) DO NOTHING`).bind(key,value.date,value.until,value.repeat,value.seriesId || null,value.originalDate,encrypted).run()
        : await env.DB.prepare(`UPDATE calendar_schedules SET scheduled_date=?,until_date=?,repeat_rule=?,payload=?,revision=revision+1
            WHERE id=? AND revision=?`).bind(value.previousRules?.[0]?.date || value.date,value.until,value.repeat,encrypted,key,expected).run();
    if (result.meta.changes !== 1) throw conflict();
    return { revision:expected+1, schedule:value };
}
