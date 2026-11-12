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
    const marker = await env.DB.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(i.revision),0) AS revisions,MAX(i.updated_at) AS latest FROM inspections i JOIN accounts a ON a.id=i.account_id WHERE a.deleted_at IS NULL').first();
    const version = await digest(JSON.stringify(marker));
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
    const rows = await env.DB.prepare('SELECT i.*,a.display_name' + joined +
        (position?' AND (i.updated_at<? OR (i.updated_at=? AND i.id<?))':'') +
        ' ORDER BY i.updated_at DESC,i.id DESC LIMIT 21').bind(...(position?[position[0],position[0],position[1]]:[])).all<Row>();
    const page = rows.results.slice(0,20);
    return {version,items:await Promise.all(page.map(async row=>{
        const record = await open<SavedInspection>(row.payload,env);
        return {id:row.id,inspectorName:await open<string>(row.display_name,env),siteName:record.site.name,
            date:record.date,status:record.status,modified:record.modified,updated:row.updated_at,revision:row.revision};
    })),nextCursor:rows.results.length>20?base64(new TextEncoder().encode(JSON.stringify([page.at(-1)!.updated_at,page.at(-1)!.id]))):null};
}
