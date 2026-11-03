import { permissionsFor, requirePermission } from './account-permissions';
import type { Account, Environment } from './bindings';
import { fromBase64, open, seal } from './security';
import { ApiError, id, jsonBody, text } from './validation';

export const trashDurationMs = 7 * 86400000;
export const photoStorageBudget = 450_000_000;
type PhotoScope = { account_id: string; deleted: number };

export async function photoBytes(env: Environment) {
    return (await env.DB.prepare('SELECT COALESCE(SUM(stored_bytes),0) AS total FROM inspection_photos').first<{total:number}>())?.total ?? 0;
}

export async function cleanExpiredPhotos(env: Environment, clock = Date.now()) {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM inspection_photos WHERE staged_at < ? OR (EXISTS(SELECT 1 FROM inspections i WHERE i.id=record_id AND i.account_id=inspection_photos.account_id AND i.deleted=1) AND NOT EXISTS(SELECT 1 FROM inspection_trash t WHERE t.record_id=inspection_photos.record_id AND t.expires_at>?))').bind(clock - trashDurationMs, clock),
        env.DB.prepare('DELETE FROM inspection_trash WHERE expires_at<=?').bind(clock),
    ]);
}

export async function inspectionPhoto(request: Request, env: Environment, account: Account, recordId: string, photoId?: string) {
    const row = await env.DB.prepare('SELECT account_id,deleted FROM inspections WHERE id=?').bind(recordId).first<PhotoScope>();
    if (request.method === 'GET' && photoId) {
        if (!row || row.deleted || (row.account_id !== account.id && !permissionsFor(account).viewAllRecords))
            throw new ApiError(404, '사진을 열 수 없습니다.');
        const photo = await env.DB.prepare('SELECT p.payload FROM inspection_photos p JOIN inspections i ON i.id=p.record_id AND i.account_id=p.account_id WHERE p.account_id=? AND p.record_id=? AND p.photo_id=? AND p.staged_at IS NULL AND i.deleted=0').bind(row.account_id, recordId, photoId).first<{payload:string}>();
        if (!photo) throw new ApiError(404, '사진을 열 수 없습니다.');
        return { data: await open<string>(photo.payload, env) };
    }
    requirePermission(account, 'writeOwnRecords');
    if (row && (row.account_id !== account.id || row.deleted)) throw new ApiError(404, '점검표에 사진을 추가할 수 없습니다.');
    if (request.method === 'GET' && !photoId) {
        const photos = await env.DB.prepare('SELECT photo_id FROM inspection_photos WHERE account_id=? AND record_id=?').bind(account.id, recordId).all<{photo_id:string}>();
        return { ids: photos.results.map(photo => photo.photo_id) };
    }
    if (request.method !== 'PUT' || !photoId) throw new ApiError(405, '지원하지 않는 사진 요청입니다.');
    const data = text((await jsonBody(request)).data, '사진', 400_030, true);
    const match = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
    if (!match) throw new ApiError(400, 'WebP 또는 JPEG 사진을 첨부해 주세요.');
    let bytes: Uint8Array;
    try { bytes = fromBase64(match[2]); } catch { throw new ApiError(400, '사진 파일을 확인해 주세요.'); }
    if (bytes.length > 300_000) throw new ApiError(413, '사진은 장당 300KB까지 저장할 수 있습니다.');
    const valid = match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!valid) throw new ApiError(400, '사진 파일 형식을 확인해 주세요.');
    const existing = await env.DB.prepare('SELECT photo_id FROM inspection_photos WHERE account_id=? AND record_id=? AND photo_id=?').bind(account.id, recordId, id(photoId)).first();
    if (existing) return { saved: true };
    const payload = await seal(data, env);
    const saved = await env.DB.prepare(`INSERT INTO inspection_photos(account_id,record_id,photo_id,payload,stored_bytes,staged_at)
        SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM inspections WHERE id=? AND (deleted=1 OR account_id<>?))
        AND (SELECT COUNT(*) FROM inspection_photos WHERE account_id=? AND record_id=? AND staged_at IS NOT NULL)<20
        AND (SELECT COALESCE(SUM(stored_bytes),0) FROM inspection_photos)+?<=?
        ON CONFLICT(account_id,record_id,photo_id) DO NOTHING`)
        .bind(account.id, recordId, photoId, payload, payload.length, Date.now(), recordId, account.id, account.id, recordId, payload.length, photoStorageBudget).run();
    if (!saved.meta.changes && !(await env.DB.prepare('SELECT photo_id FROM inspection_photos WHERE account_id=? AND record_id=? AND photo_id=?').bind(account.id, recordId, photoId).first()))
        throw new ApiError(409, '사진 저장 공간 또는 전송 대기 수량을 확인해 주세요. 점검은 기기에 보관됩니다.');
    return { saved: true };
}
