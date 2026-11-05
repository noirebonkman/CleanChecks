import { download } from '../local-storage';
import { shiftDay, visitLabel, weekdays, workColors, workKinds, type Visit } from './calendar-model';

type CalendarCell = { text: string; color: number };
type Week = { days: string[]; entries: Visit[][] };

function makeWeeks(month: string, days: string[], visits: Map<string, Visit[]>): Week[] {
    const weeks: Week[] = [];
    for (let index = 0; index < days.length; index += 7) {
        const week = days.slice(index,index + 7);
        weeks.push({ days:week, entries:week.map(date => date.startsWith(month) ? visits.get(date) || [] : []) });
    }
    return weeks;
}

async function spreadsheet(title: string, month: string, weeks: Week[]) {
    const XLSX = await import('xlsx');
    const { default: Zip } = await import('jszip');
    const rows: CalendarCell[][] = [
        [{ text:title, color:3 }],
        workKinds.map((text,color) => ({ text,color })),
        weekdays.map(text => ({ text,color:3 })),
    ];
    for (const week of weeks) {
        rows.push(week.days.map(date => ({text:date.startsWith(month) ? date : '',color:3})));
        const count = Math.max(3,...week.entries.map(entries => entries.length));
        for (let index = 0; index < count; index++) rows.push(week.entries.map(entries => {
            const visit = entries[index];
            return visit ? {text:visitLabel(visit),color:workKinds.indexOf(visit.kind)} : {text:'',color:4};
        }));
    }
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows.map(row => row.map(cell => cell.text)));
    sheet['!cols'] = weekdays.map(() => ({wch:31}));
    sheet['!merges'] = [XLSX.utils.decode_range('A1:G1')];
    sheet['!rows'] = rows.map((row,index) => ({
        hpt:index === 0 ? 30 : Math.max(18,...row.map(cell => Math.ceil([...cell.text].reduce((width,ch) => width + (ch.charCodeAt(0) > 127 ? 2 : 1),0) / 27) * 15)),
    }));
    XLSX.utils.book_append_sheet(workbook,sheet,'월간 스케줄표');
    const details = [['날짜','시작','종료','현장명','작업명','구분','상태']];
    for (const week of weeks) for (const entries of week.entries) for (const visit of entries)
        details.push([visit.occurrenceDate,visit.start,visit.end,visit.siteName,visit.title,visit.kind,visit.state]);
    const detailSheet = XLSX.utils.aoa_to_sheet(details);
    detailSheet['!cols'] = [14,9,9,27,30,16,12].map(wch => ({wch}));
    XLSX.utils.book_append_sheet(workbook,detailSheet,'일정 목록');
    const zip = await Zip.loadAsync(XLSX.write(workbook,{type:'array',bookType:'xlsx'}));
    const stylesPath = 'xl/styles.xml', sheetPath = 'xl/worksheets/sheet1.xml';
    const parser = new DOMParser(), serializer = new XMLSerializer();
    const styles = parser.parseFromString(await zip.file(stylesPath)!.async('string'),'application/xml');
    const page = parser.parseFromString(await zip.file(sheetPath)!.async('string'),'application/xml');
    const ns = styles.documentElement.namespaceURI;
    const add = (doc: Document, parent: Element, tag: string, attrs: Record<string,string>) => {
        const node = doc.createElementNS(ns,tag);
        for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
        parent.append(node);
        return node;
    };
    const fills = styles.getElementsByTagName('fills')[0], xfs = styles.getElementsByTagName('cellXfs')[0];
    const borders = styles.getElementsByTagName('borders')[0], borderId = borders.children.length;
    const border = add(styles,borders,'border',{});
    for (const side of ['left','right','top','bottom']) {
        const edge = add(styles,border,side,{style:'thin'});
        add(styles,edge,'color',{rgb:'FFCDD9E0'});
    }
    add(styles,border,'diagonal',{});
    borders.setAttribute('count',String(borders.children.length));
    const firstStyle = xfs.children.length;
    for (const color of [...workColors,'#e6eef4','#ffffff']) {
        const fillId = fills.children.length;
        const fill = add(styles,fills,'fill',{});
        const pattern = add(styles,fill,'patternFill',{patternType:'solid'});
        add(styles,pattern,'fgColor',{rgb:'FF' + color.slice(1).toUpperCase()});
        add(styles,pattern,'bgColor',{indexed:'64'});
        const xf = add(styles,xfs,'xf',{numFmtId:'0',fontId:'0',fillId:String(fillId),borderId:String(borderId),xfId:'0',
            applyFill:'1',applyBorder:'1',applyAlignment:'1'});
        add(styles,xf,'alignment',{wrapText:'1',vertical:'center'});
    }
    fills.setAttribute('count',String(fills.children.length));
    xfs.setAttribute('count',String(xfs.children.length));
    for (const cell of page.getElementsByTagName('c')) {
        const { r,c } = XLSX.utils.decode_cell(cell.getAttribute('r') || 'A1');
        cell.setAttribute('s',String(firstStyle + (rows[r]?.[c]?.color ?? 4)));
    }
    const properties = add(page,page.documentElement,'sheetPr',{});
    page.documentElement.prepend(properties);
    add(page,properties,'pageSetUpPr',{fitToPage:'1'});
    add(page,page.documentElement,'pageMargins',{left:'.25',right:'.25',top:'.35',bottom:'.35',header:'.15',footer:'.15'});
    add(page,page.documentElement,'pageSetup',{orientation:'landscape',paperSize:'9',fitToWidth:'1',fitToHeight:'0'});
    zip.file(stylesPath,serializer.serializeToString(styles));
    zip.file(sheetPath,serializer.serializeToString(page));
    return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

async function image(title: string, month: string, weeks: Week[]) {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('이미지를 만들 수 없습니다.');
    const column = 220, margin = 20, heading = 110, dayHeight = 26, lineHeight = 22;
    const bodyFont = '15px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    ctx.font = bodyFont;
    function wrap(text: string) {
        const lines: string[] = [];
        let line = '';
        for (const letter of text) {
            if (line && ctx!.measureText(line + letter).width > column - 18) { lines.push(line); line = ''; }
            line += letter;
        }
        if (line) lines.push(line);
        return lines;
    }
    const layout = weeks.map(week => {
        const columns = week.entries.map(entries => entries.map(visit => ({lines:wrap(visitLabel(visit)),color:workColors[workKinds.indexOf(visit.kind)]})));
        return { days:week.days, columns, height:dayHeight + Math.max(3 * lineHeight,...columns.map(cells => cells.reduce((sum,cell) => sum + cell.lines.length * lineHeight + 4,0))) };
    });
    const height = heading + margin + layout.reduce((sum,week) => sum + week.height,0);
    if (height > 12000) throw Error('일정이 많아 이미지가 너무 깁니다. 엑셀로 내려받아 주세요.');
    canvas.width = column * 7 + margin * 2;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,height);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#172e36';
    ctx.font = 'bold 26px "Malgun Gothic", sans-serif';
    ctx.fillText(title,margin,31);
    ctx.font = bodyFont;
    workKinds.forEach((kind,index) => {
        const x = margin + index * 115;
        ctx.fillStyle = workColors[index];
        ctx.fillRect(x,55,104,23);
        ctx.fillStyle = '#172e36';
        ctx.fillText(kind,x + 7,67);
    });
    weekdays.forEach((weekday,index) => {
        const x = margin + index * column;
        ctx.fillStyle = '#e6eef4'; ctx.fillRect(x,84,column,26);
        ctx.fillStyle = '#172e36'; ctx.fillText(weekday,x + column / 2 - 8,97);
    });
    let top = heading;
    for (const week of layout) {
        week.days.forEach((date,index) => {
            const x = margin + index * column;
            ctx.fillStyle = '#edf3f7'; ctx.fillRect(x,top,column,dayHeight);
            ctx.fillStyle = index === 6 ? '#a02834' : index === 5 ? '#185691' : '#172e36';
            if (date.startsWith(month)) ctx.fillText(date,x + 8,top + dayHeight / 2);
            let y = top + dayHeight;
            for (const cell of week.columns[index]) {
                const blockHeight = cell.lines.length * lineHeight + 4;
                ctx.fillStyle = cell.color; ctx.fillRect(x,y,column,blockHeight);
                ctx.fillStyle = '#172e36';
                cell.lines.forEach((line,number) => ctx.fillText(line,x + 8,y + 2 + lineHeight * (number + .5)));
                y += blockHeight;
            }
            ctx.strokeStyle = '#547078'; ctx.strokeRect(x,top,column,week.height);
        });
        top += week.height;
    }
    return new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('이미지를 만들 수 없습니다.')),'image/png'));
}

function icalendar(weeks: Week[], reminder: boolean) {
    const clean = (text: string) => text.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/[,;]/g,'\\$&').replace(/\r/g,'');
    const key = (date: string) => date.replace(/-/g,'');
    const clock = (date: string, time: string) => new Date(date + 'T' + time + ':00+09:00').toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
    const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CleanChecks//Field Schedule//KO','CALSCALE:GREGORIAN'];
    for (const week of weeks) for (const entries of week.entries) for (const visit of entries) {
        if (visit.state === '취소') continue;
        const date = visit.occurrenceDate;
        lines.push('BEGIN:VEVENT','UID:' + visit.id + '-' + date + '@cleanchecks','DTSTAMP:' + stamp,
            'SUMMARY:' + clean(visit.siteName + ' · ' + visit.title));
        if (visit.start) {
            lines.push('DTSTART:' + clock(date,visit.start));
            if (visit.end) lines.push('DTEND:' + clock(date,visit.end));
        } else lines.push('DTSTART;VALUE=DATE:' + key(date),'DTEND;VALUE=DATE:' + key(shiftDay(date,1)));
        if (visit.address) lines.push('LOCATION:' + clean(visit.address));
        if (reminder && visit.start && visit.state === '예정') lines.push('BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:현장 일정 알림','END:VALARM');
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const encoder = new TextEncoder();
    const folded = lines.map(line => {
        let result = '', bytes = 0;
        for (const char of line) {
            const size = encoder.encode(char).length;
            if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
            result += char;
            bytes += size;
        }
        return result;
    });
    return new Blob([folded.join('\r\n') + '\r\n'],{type:'text/calendar;charset=utf-8'});
}

export async function exportCalendar(format: 'xlsx' | 'png' | 'ics', month: string, days: string[], visits: Map<string, Visit[]>, reminder = false) {
    const title = 'FM PARTNERS · ' + month.slice(0,4) + '년 ' + Number(month.slice(5)) + '월 스케줄표';
    const weeks = makeWeeks(month,days,visits);
    const blob = await (format === 'xlsx' ? spreadsheet(title,month,weeks) : format === 'png' ? image(title,month,weeks) : icalendar(weeks,reminder));
    download(blob,'현장스케줄_' + month + '.' + format);
}
