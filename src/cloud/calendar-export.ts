import { download } from '../local-storage';
import { shiftDay, visitLabel, weekdays, workColors, workKinds, type Visit } from './calendar-model';

type Week = { days: string[]; entries: Visit[][] };
const templateHeaders = [5,11,20,27,32,38,44];

function makeWeeks(month: string, days: string[], visits: Map<string, Visit[]>): Week[] {
    const weeks: Week[] = [];
    for (let index = 0; index < days.length; index += 7) {
        const week = days.slice(index,index + 7);
        weeks.push({ days:week, entries:week.map(date => date.startsWith(month) ? visits.get(date) || [] : []) });
    }
    return weeks;
}

async function spreadsheet(title: string, month: string, weeks: Week[]) {
    const { default: Zip } = await import('jszip');
    const template = await fetch(new URL('./fm-calendar-template.xlsx',import.meta.url));
    if (!template.ok) throw Error('FM 엑셀 양식을 불러오지 못했습니다.');
    const zip = await Zip.loadAsync(await template.arrayBuffer());
    const parser = new DOMParser(), serializer = new XMLSerializer();
    const stylesPath = 'xl/styles.xml', pagePath = 'xl/worksheets/sheet1.xml', listPath = 'xl/worksheets/sheet2.xml';
    const read = async (path: string) => parser.parseFromString(await zip.file(path)!.async('string'),'application/xml');
    const [styles,page,list] = await Promise.all([read(stylesPath),read(pagePath),read(listPath)]);
    const ns = page.documentElement.namespaceURI;
    function add(parent: Element, name: string, attributes: Record<string,string> = {}) {
        const element = parent.ownerDocument.createElementNS(ns,name);
        for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,value);
        parent.append(element);
        return element;
    }
    function writeCell(cell: Element, value: string) {
        cell.replaceChildren();
        cell.removeAttribute('t');
        if (!value) return;
        cell.setAttribute('t','inlineStr');
        const text = add(add(cell,'is'),'t');
        text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
        text.textContent = value;
    }
    const data = page.getElementsByTagName('sheetData')[0];
    const originals = new Map([...data.children].map(row => [Number(row.getAttribute('r')),row]));
    const titleCell = originals.get(2)!.getElementsByTagName('c')[0];
    writeCell(titleCell,'                        ' + title.replace(/^FM PARTNERS · /,'').replaceAll(' ','   '));
    const xfs = styles.getElementsByTagName('cellXfs')[0];
    const palette = [25,26,435].map(index => xfs.children[index].getAttribute('fillId') || '0');
    const jobStyles = new Map<string,string>();
    function jobStyle(original: string, kind: number, hasLabel: boolean) {
        const key = original + ':' + kind + ':' + hasLabel;
        const cached = jobStyles.get(key);
        if (cached) return cached;
        const xf = xfs.children[Number(original) || 0].cloneNode(true) as Element;
        xf.setAttribute('fillId',kind < 0 ? '0' : palette[kind]);
        xf.setAttribute('applyFill','1');
        if (hasLabel) {
            const alignment = xf.getElementsByTagName('alignment')[0] || add(xf,'alignment');
            alignment.setAttribute('wrapText','0');
            alignment.setAttribute('shrinkToFit','1');
            xf.setAttribute('applyAlignment','1');
        }
        const index = String(xfs.children.length);
        xfs.append(xf);
        jobStyles.set(key,index);
        return index;
    }
    const details = [['날짜','시작','종료','현장명','작업명','구분','상태']];
    templateHeaders.slice(0,-1).forEach((heading,index) => {
        const week = weeks[index], slots = templateHeaders[index + 1] - heading - 1;
        const header = originals.get(heading)!;
        [...header.children].forEach((cell,day) => {
            const date = week?.days[day];
            writeCell(cell,date?.startsWith(month) ? date : '');
        });
        for (let job = 0; job < slots; job++) {
            const row = originals.get(heading + job + 1)!;
            [...row.children].forEach((cell,day) => {
                const entries = week?.entries[day] || [];
                const overflow = job === slots - 1 && entries.length > slots;
                const visit = overflow ? undefined : entries[job];
                const label = overflow ? `외 ${entries.length - job}건 · 일정 목록` : visit ? '*' + visitLabel(visit) : '';
                cell.setAttribute('s',jobStyle(cell.getAttribute('s') || '0',visit ? workKinds.indexOf(visit.kind) : -1,Boolean(label)));
                writeCell(cell,label);
            });
        }
        for (const visit of week?.entries.flat() || []) {
            details.push([visit.occurrenceDate,visit.start,visit.end,visit.siteName,visit.title,visit.kind,visit.state]);
        }
    });
    xfs.setAttribute('count',String(xfs.children.length));
    const listData = list.getElementsByTagName('sheetData')[0];
    details.forEach((values,index) => {
        const row = add(listData,'row',{r:String(index + 1)});
        values.forEach((value,column) => writeCell(add(row,'c',{r:'ABCDEFG'[column] + (index + 1)}),value));
    });
    zip.file(stylesPath,serializer.serializeToString(styles));
    zip.file(pagePath,serializer.serializeToString(page));
    zip.file(listPath,serializer.serializeToString(list));
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
    const layout = weeks.map((week,index) => {
        const columns = week.entries.map(entries => entries.map(visit => ({lines:wrap(visitLabel(visit)),color:workColors[workKinds.indexOf(visit.kind)]})));
        const slots = templateHeaders[index + 1] - templateHeaders[index] - 1;
        const rowHeights = Array.from({length:Math.max(slots,...columns.map(cells => cells.length))},(_,row) =>
            Math.max(1,...columns.map(cells => cells[row]?.lines.length || 0)) * lineHeight + 4
        );
        return { days:week.days, columns, rowHeights, height:dayHeight + rowHeights.reduce((sum,height) => sum + height,0) };
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
        ctx.strokeStyle = '#547078'; ctx.strokeRect(x+.5,84.5,column,26);
    });
    let top = heading;
    for (const week of layout) {
        week.days.forEach((date,index) => {
            const x = margin + index * column;
            ctx.fillStyle = '#edf3f7'; ctx.fillRect(x,top,column,dayHeight);
            ctx.fillStyle = index === 6 ? '#a02834' : index === 5 ? '#185691' : '#172e36';
            if (date.startsWith(month)) ctx.fillText(date,x + 8,top + dayHeight / 2);
            let y = top + dayHeight;
            week.rowHeights.forEach((blockHeight,row) => {
                const cell = week.columns[index][row];
                if (cell) {
                    ctx.fillStyle = cell.color; ctx.fillRect(x,y,column,blockHeight);
                    ctx.fillStyle = '#172e36';
                    cell.lines.forEach((line,number) => ctx.fillText(line,x + 8,y + 2 + lineHeight * (number + .5)));
                }
                ctx.strokeStyle = '#c0cdd2';
                ctx.fillStyle = ctx.strokeStyle;
                ctx.fillRect(x,y,column,1);
                y += blockHeight;
            });
            ctx.strokeStyle = '#547078'; ctx.strokeRect(x+.5,top+.5,column,week.height);
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
