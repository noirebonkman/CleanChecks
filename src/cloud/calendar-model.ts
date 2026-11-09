import { knownValue } from '../site-details';

export const workKinds = ['자체 작업', 'SBM 작업', '정기청소'] as const;
export const workColors = ['#dceaf8', '#fff0c8', '#e2efd8'];
export const workStates = ['예정', '완료', '취소'] as const;
export const repeatOptions = {
    none: '반복 없음', weekdays: '매주 평일', weekly: '매주 같은 요일', fortnightly: '격주 같은 요일',
    monthly: '매월 같은 날짜', monthlyWeekday: '매월 같은 순번의 요일', monthlyLastWeekday: '매월 마지막 같은 요일',
} as const;
export const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

export type ScheduleRule = {
    id: string;
    siteId: string;
    siteName: string;
    address: string;
    title: string;
    kind: typeof workKinds[number];
    date: string;
    start: string;
    end: string;
    assignee: string;
    notes: string;
    state: typeof workStates[number];
    repeat: keyof typeof repeatOptions;
    until: string;
    seriesId: string;
    originalDate: string;
};
export type Schedule = ScheduleRule & { previousRules?: ScheduleRule[] };
export type SavedSchedule = Schedule & { revision: number };
export type Visit = SavedSchedule & { occurrenceDate: string };

const asDate = (value: string) => new Date(value + 'T00:00:00Z');
const asKey = (value: Date) => value.toISOString().slice(0, 10);
export const todayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
export const dateKey = (year: number, month: number, day: number) => asKey(new Date(Date.UTC(year, month - 1, day)));
export function shiftDay(value: string, days: number) {
    const date = asDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return asKey(date);
}
export function monthDays(month: string) {
    const [year, number] = month.split('-').map(Number);
    const first = month + '-01';
    const start = shiftDay(first, -(asDate(first).getUTCDay() + 6) % 7);
    const end = dateKey(year, number + 1, 1);
    const days: string[] = [];
    for (let day = start; day < end || days.length % 7; day = shiftDay(day, 1)) days.push(day);
    return days;
}
function ruleOccursOn(schedule: ScheduleRule, day: string) {
    if (!schedule.date || day < schedule.date || (schedule.until && day > schedule.until)) return false;
    if (schedule.repeat === 'none') return schedule.date === day;
    if (schedule.repeat === 'monthly') return day.slice(8) === schedule.date.slice(8);
    const current = asDate(day), start = asDate(schedule.date);
    if (schedule.repeat === 'weekdays') return current.getUTCDay() >= 1 && current.getUTCDay() <= 5;
    if (schedule.repeat === 'monthlyWeekday')
        return current.getUTCDay() === start.getUTCDay() && Math.floor((current.getUTCDate() - 1) / 7) === Math.floor((start.getUTCDate() - 1) / 7);
    if (schedule.repeat === 'monthlyLastWeekday')
        return current.getUTCDay() === start.getUTCDay() && shiftDay(day,7).slice(0,7) !== day.slice(0,7);
    const days = (current.valueOf() - start.valueOf()) / 86_400_000;
    return days % (schedule.repeat === 'weekly' ? 7 : 14) === 0;
}
export function ruleForDate(schedule: Schedule, day: string): ScheduleRule | undefined {
    const rule = (schedule.previousRules || []).find(rule => day >= rule.date && day <= rule.until);
    const candidate = rule || schedule;
    return ruleOccursOn(candidate,day) ? candidate : undefined;
}
export const occursOn = (schedule: Schedule, day: string) => !!ruleForDate(schedule,day);
export const occurrenceId = (seriesId: string, day: string) => seriesId + '_' + day;

export function visitsByDay(rows: SavedSchedule[], days: string[]) {
    const exceptions = new Set(rows.filter(row => row.seriesId).map(row => row.id));
    return new Map(days.map(day => {
        const visits: Visit[] = [];
        for (const row of rows) {
            const rule = ruleForDate(row,day);
            if (!rule || (rule.repeat !== 'none' && exceptions.has(occurrenceId(row.id, day)))) continue;
            visits.push({ ...rule, revision:row.revision, occurrenceDate:day });
        }
        return [day, visits.sort((a,b) => a.start.localeCompare(b.start) || a.siteName.localeCompare(b.siteName, 'ko'))];
    }));
}
export const visitLabel = (visit: Schedule) =>
    [visit.start, knownValue(visit.siteName), knownValue(visit.title)].filter(Boolean).join(' ') + (visit.state === '예정' ? '' : ' [' + visit.state + ']');
export function sameAssignee(first: string, second: string) {
    return !!first.trim() && first.trim().toLowerCase() === second.trim().toLowerCase();
}

export function overlappingVisits(value: Schedule, visits: Visit[]) {
    if (value.state === '취소' || !value.start) return [];
    return visits.filter(visit => {
        if (visit.id === value.id || (visit.id === value.seriesId && visit.occurrenceDate === value.originalDate)
            || visit.state === '취소' || !visit.start || !sameAssignee(value.assignee, visit.assignee)) return false;
        return value.start === visit.start
            || (value.start < (visit.end || visit.start) && visit.start < (value.end || value.start));
    });
}

