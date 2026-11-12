import type { Inspection } from '../../src/inspection-model';
import type { Environment } from './bindings';
import { digest, fromBase64, open, base64 } from './security';
import { ApiError, id } from './validation';

type SavedInspection = Omit<Inspection, 'staffId'>;
type Row = { id:string;account_id:string;payload:string;revision:number;updated_at:string;display_name:string };
const joined = ' FROM inspections i JOIN accounts a ON a.id=i.account_id WHERE i.deleted=0 AND a.deleted_at IS NULL';

// A separate, authenticated read-only feed. It never changes the personal record
// list, writing permissions, or administrator access to management information.
export async function recentInspections(request: Request, env: Environment): Promise<unknown | Response> {
    if (request.method !== 'GET') throw new ApiError(405, '최근 점검은 조회만 가능합니다.');
    const url = new URL(request.url);
    const match = /^\/api\/recent-inspections(?:\/([\w-]+)(?:\/photos\/([\w-]+))?)?$/.exec(url.pathname);
    if (!match) throw new ApiError(404, '점검표를 찾지 못했습니다.');
    if (match[1]) {
        const recordId = id(match[1]);
        const row = await env.DB.prepare('SELECT i.*,a.display_name' + joined + ' AND i.id=?').bind(recordId).first<Row>();
        if (!row) throw new ApiError(404, '삭제되었거나 열 수 없는 점검표입니다.');
        const record = await open<SavedInspection>(row.payload,env);
        if (match[2]) {
            const photoId = id(match[2]);
            if (!record.photos?.some(photo => photo.id === photoId)) throw new ApiError(404, '사진을 열 수 없습니다.');
            const photo = await env.DB.prepare('SELECT payload FROM inspection_photos WHERE record_id=? AND account_id=? AND photo_id=? AND staged_at IS NULL').bind(recordId,row.account_id,photoId).first<{payload:string}>();
            if (!photo) throw new ApiError(404, '사진을 열 수 없습니다.');
            const data = await open<string>(photo.payload,env);
            const [header,encoded] = data.split(',');
            return new Response(fromBase64(encoded) as unknown as BodyInit,{headers:{
                'Content-Type':header.startsWith('data:image/webp')?'image/webp':'image/jpeg',
                'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
            }});
        }
        return { record:{...record,staffId:row.account_id,photos:(record.photos || []).map(photo=>({id:photo.id,name:photo.name,data:''}))},
            inspectorName:await open<string>(row.display_name,env),revision:row.revision,updated:row.updated_at };
    }

    const inspector = url.searchParams.get('inspector') || '';
    if (inspector) id(inspector);
    const search = (url.searchParams.get('q') || '').trim().normalize('NFKC').toLocaleLowerCase('ko-KR');
    const from = url.searchParams.get('from') || '', until = url.searchParams.get('until') || '';
    const status = url.searchParams.get('status') || '';
    if (search.length>100 || [from,until].some(value=>value&&!/^\d{4}-\d{2}-\d{2}$/.test(value)) || (from&&until&&from>until) || !['','draft','complete'].includes(status))
        throw new ApiError(400,'검색 조건과 기간을 확인해 주세요.');
    const marker = await env.DB.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(i.revision),0) AS revisions,MAX(i.updated_at) AS latest FROM inspections i JOIN accounts a ON a.id=i.account_id WHERE a.deleted_at IS NULL').first();
    const version = await digest(JSON.stringify([marker,inspector,search,from,until,status]));
    if (url.searchParams.get('since') === version) return {unchanged:true,version};
    const cursor = url.searchParams.get('cursor');
    let position: [string,string] | undefined;
    if (cursor) {
        if (cursor.length > 512) throw new ApiError(400, '목록 위치를 확인해 주세요.');
        try {
            const value = JSON.parse(new TextDecoder().decode(fromBase64(cursor)));
            if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || value[0].length > 40 || !Number.isFinite(Date.parse(value[0]))) throw Error();
            position = [value[0],id(value[1])];
        } catch { throw new ApiError(400, '목록 위치를 확인해 주세요.'); }
    }
    const matches: {row:Row;record:SavedInspection}[] = [];
    // Payloads stay encrypted at rest. Scan batches so search covers every record,
    // rather than filtering only the first downloaded page.
    while (matches.length<21) {
        const rows = await env.DB.prepare('SELECT i.*,a.display_name' + joined +
            (inspector?' AND i.account_id=?':'') +
            (position?' AND (i.updated_at<? OR (i.updated_at=? AND i.id<?))':'') +
            ' ORDER BY i.updated_at DESC,i.id DESC LIMIT 100')
            .bind(...(inspector?[inspector]:[]),...(position?[position[0],position[0],position[1]]:[])).all<Row>();
        for (const row of rows.results) {
            const record=await open<SavedInspection>(row.payload,env),date=record.date.slice(0,10);
            if ((!status||record.status===status)&&(!from||date>=from)&&(!until||date<=until)&&
                (!search||[record.site.name,record.site.zone,record.site.address].join(' ').normalize('NFKC').toLocaleLowerCase('ko-KR').includes(search)))
                matches.push({row,record});
            if(matches.length===21)break;
        }
        if(rows.results.length<100 || matches.length>=21)break;
        const last=rows.results.at(-1)!;position=[last.updated_at,last.id];
    }
    const people=await env.DB.prepare('SELECT DISTINCT a.id,a.display_name FROM accounts a JOIN inspections i ON i.account_id=a.id WHERE a.deleted_at IS NULL AND i.deleted=0').all<{id:string;display_name:string}>();
    const page=matches.slice(0,20),last=page.at(-1)?.row;
    return {version,inspectors:await Promise.all(people.results.map(async person=>({id:person.id,name:await open<string>(person.display_name,env)}))),
        items:await Promise.all(page.map(async({row,record})=>({id:row.id,inspectorId:row.account_id,
            inspectorName:await open<string>(row.display_name,env),siteName:record.site.name,date:record.date,status:record.status,
            modified:record.modified,rating:record.rating,issueCount:Object.values(record.answers||{}).filter(grade=>grade==='B'||grade==='C').length,
            updated:row.updated_at,revision:row.revision}))),
        nextCursor:matches.length>20&&last?base64(new TextEncoder().encode(JSON.stringify([last.updated_at,last.id]))):null};
}
