import type { Site } from '../inspection-model';
import { shiftDay, workKinds, workStates, type ScheduleRule } from './calendar-model';

export type ImportRow = Pick<ScheduleRule,'date'|'start'|'end'|'siteId'|'siteName'|'title'|'kind'|'state'|'address'|'assignee'|'notes'> & {
    source: string;
    review: string;
};
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
type WorkbookReader = typeof import('xlsx');
type Workbook = import('xlsx').WorkBook;
const clock = (value: string) => {
    const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
    return match && Number(match[1]) < 24 ? match[1].padStart(2,'0') + ':' + match[2] : '';
};
function dateCell(value: string) {
    const match = /^(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[일.]?$/.exec(value.trim());
    if (!match) return '';
    const key = match[1] + '-' + match[2].padStart(2,'0') + '-' + match[3].padStart(2,'0');
    const date = new Date(key + 'T00:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0,10) === key ? key : '';
}

export async function openScheduleWorkbook(file: File) {
    if (file.size > 5_000_000) throw Error('5MB 이하 엑셀 파일을 선택해 주세요.');
    const spreadsheet = await import('xlsx');
    const XLSX = spreadsheet.SSF ? spreadsheet : (spreadsheet as WorkbookReader & { default: WorkbookReader }).default;
    const workbook = XLSX.read(await file.arrayBuffer(),{type:'array',cellStyles:true,cellNF:true,sheetRows:1500});
    return {
        sheetNames:workbook.SheetNames,
        read:(sheetName: string, sites: Site[]) => readScheduleSheet(XLSX,workbook,sheetName,sites),
    };
}

export function preferredScheduleSheet(names: string[], month: string) {
    const [year, number] = month.split('-').map(Number);
    return names.find(name => name === '일정 목록')
        || names.find(name => {
            const match = /^(?:20)?(\d{2})-(\d{1,2})$/.exec(name.trim());
            return !!match && Number(match[1]) === year % 100 && Number(match[2]) === number;
        })
        || names[0] || '';
}

function readScheduleSheet(XLSX: WorkbookReader, workbook: Workbook, sheetName: string, sites: Site[]) {
    const output: ImportRow[] = [], issues: string[] = [];
    const add = (row: ImportRow) => {
        const matches = sites.filter(site => normalized(site.name) === normalized(row.siteName));
        if (matches.length === 1) {
            row.siteId = matches[0].id;
            row.siteName = matches[0].name;
            row.address ||= matches[0].address;
        } else if (matches.length > 1) row.review = [row.review,'같은 이름의 등록 현장이 여러 곳입니다.'].filter(Boolean).join(' ');
        output.push(row);
    };
    const names = workbook.SheetNames.filter(name => name === sheetName);
    for (const name of names) {
        const sheet = workbook.Sheets[name];
        if (!sheet['!ref']) continue;
        const fullRange = sheet['!fullref'];
        if (typeof fullRange === 'string' && XLSX.utils.decode_range(fullRange).e.r >= 1500)
            throw Error(name + ' 시트가 1,500행을 넘습니다. 파일을 나눠 주세요.');
        const range = XLSX.utils.decode_range(sheet['!ref']);
        range.s = {r:0,c:0};
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet,{header:1,raw:false,defval:'',blankrows:true,dateNF:'yyyy-mm-dd',range});
        const string = (value: unknown) => String(value ?? '').trim();
        const at = (row: number,column: number) => sheet[XLSX.utils.encode_cell({r:row,c:column})];
        const readDate = (row: number, column: number, display: string) => {
            const cell = at(row,column);
            if (cell?.t !== 'n' || !cell.z || !XLSX.SSF.is_date(cell.z)) return dateCell(display);
            const parts = XLSX.SSF.parse_date_code(cell.v,{date1904:!!workbook.Workbook?.WBProps?.date1904});
            return parts ? dateCell([parts.y,parts.m,parts.d].join('-')) : '';
        };
        const header = rows.findIndex(row => row.map(string).includes('날짜') && row.map(string).includes('현장명') && row.map(string).includes('작업명'));
        if (header >= 0) {
            const titles = rows[header].map(string);
            for (let index = header + 1; index < rows.length; index++) {
                const row = rows[index], cell = (name: string) => string(row[titles.indexOf(name)]);
                if (!row.some(value => string(value))) continue;
                const source = name + ' ' + (index + 1) + '행';
                const date = readDate(index,titles.indexOf('날짜'),cell('날짜')), start = clock(cell('시작')), end = clock(cell('종료'));
                const kind = workKinds.find(kind => normalized(kind) === normalized(cell('구분')));
                if ((cell('날짜') && !date) || (cell('시작') && !start) || (cell('종료') && (!end || !start || end <= start))
                    || (!date && start) || !cell('현장명') || !cell('작업명')) {
                    issues.push(source + '의 날짜·시간·현장명·작업명을 확인해 주세요.');
                    continue;
                }
                add({date,start,end,source,siteId:'',siteName:cell('현장명'),title:cell('작업명'),address:cell('주소'),assignee:cell('담당자'),
                    notes:cell('메모'),kind:kind || '자체 작업',state:workStates.find(state => state === cell('상태')) || '예정',
                    review:kind ? '' : '작업 구분을 확인해 주세요.'});
            }
            continue;
        }
        const weekday = (cell: unknown) => string(cell).replace(/요일$/,'');
        const weekdayRow = rows.findIndex(row => row.some((cell,column) =>
            weekday(cell) === '월' && ['화','수','목','금','토','일'].every((day,offset) => weekday(row[column + offset + 1]) === day)));
        if (weekdayRow < 0) { issues.push(name + ' 시트에서 일정표를 찾지 못했습니다.'); continue; }
        const first = rows[weekdayRow].findIndex(cell => weekday(cell) === '월');
        const fill = (row: number,column: number) => at(row,column)?.s?.fgColor?.rgb as string | undefined;
        const colors = new Map<string,ImportRow['kind']>();
        rows.slice(0,weekdayRow).forEach((row,index) => row.forEach((value,column) => {
            const kind = workKinds.find(kind => normalized(kind) === normalized(string(value)));
            const color = fill(index,column);
            if (color && kind) colors.set(color,kind);
        }));
        let dates = Array<string>(7).fill('');
        for (let index = weekdayRow + 1; index < rows.length; index++) {
            const row = rows[index];
            const cells = Array.from({length:7},(_,column) => string(row[first + column]));
            const dayKeys = cells.map((cell,column) => readDate(index,first + column,cell));
            // A week header can contain a holiday name after one date. Require other dates on that row.
            if (dayKeys.filter(Boolean).length >= 2) {
                cells.forEach((cell,column) => {
                    if (!dayKeys[column]) dayKeys[column] = dateCell(/^20\d{2}-\d{1,2}-\d{1,2}(?=\s|\()/.exec(cell)?.[0] || '');
                });
            }
            const anchor = dayKeys.findIndex(Boolean);
            if (anchor >= 0 && cells.every((cell,column) => !cell || dayKeys[column] === shiftDay(dayKeys[anchor],column - anchor))) {
                dates = dayKeys;
                continue;
            }
            cells.forEach((cell,column) => {
                if (!cell) return;
                const source = name + ' ' + XLSX.utils.encode_cell({r:index,c:first + column});
                if (dayKeys[column] || at(index,first + column)?.t === 'n') {
                    issues.push(source + '의 날짜 또는 시간 옆 작업 내용을 확인해 주세요.');
                    return;
                }
                if (!dates[column]) { issues.push(source + '의 날짜를 확인해 주세요.'); return; }
                const kind = colors.get(fill(index,first + column) || '');
                // One worksheet cell is one job. Keep multi-line descriptions together.
                const plain = cell.replace(/^[*•]\s*/,'');
                const match = /^(\d{1,2}:\d{2})\s+/.exec(plain);
                const start = match ? clock(match[1]) : '';
                const description = start ? plain.slice(match![0].length).trim() : plain;
                if (!description) { issues.push(source + '의 작업 내용을 확인해 주세요.'); return; }
                const site = sites.find(site => normalized(description) === normalized(site.name));
                add({date:dates[column],start,end:'',source,siteId:'',siteName:site?.name || description.slice(0,200),
                    title:kind || '현장 작업',address:'',assignee:'',notes:site ? '' : description.slice(0,2000),
                    kind:kind || '자체 작업',state:'예정',
                    review:kind ? '' : '작업 구분을 확인해 주세요.'});
            });
        }
    }
    if (output.length > 500) throw Error('한 파일에 일정이 500건을 넘습니다. 파일을 나눠 주세요.');
    return { rows:output, issues };
}

export async function importSchedule(row: ImportRow) {
    const { source, review, ...value } = row;
    const identity = [value.date,value.start,value.end,value.siteName,value.title,value.kind,value.assignee].map(normalized);
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)));
    const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
    return { ...value,id:'import-' + key,repeat:'none',until:'',seriesId:'',originalDate:'' };
}
