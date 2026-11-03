import type { Inspection, Photo } from '../inspection-model';
import { compress } from '../site-import-and-photos';
import { post, request } from './client';

const path = (recordId: string, photoId?: string) =>
    'records/' + encodeURIComponent(recordId) + '/photos' + (photoId ? '/' + encodeURIComponent(photoId) : '');

export function photoSource(recordId: string, photo: Photo): string {
    return photo.data || '/api/' + path(recordId, photo.id) + '?image=1';
}

export async function photoBlob(recordId: string, photo: Photo): Promise<Blob> {
    const response = await fetch(photoSource(recordId, photo));
    if (!response.ok) throw Error('사진을 불러오지 못했습니다.');
    return response.blob();
}

export async function downloadInspectionPhotos(record: Inspection): Promise<Inspection> {
    const photos = await Promise.all(record.photos.map(async photo =>
        photo.data ? photo : { ...photo, ...(await request<{data:string}>(path(record.id, photo.id))) }));
    return { ...record, photos };
}

export async function stageInspectionPhotos(record: Inspection, progress?: (done: number, total: number) => void) {
    if (!record.photos.length) return;
    const { ids } = await request<{ids:string[]}>(path(record.id));
    const staged = new Set(ids);
    let done = 0;
    progress?.(done, record.photos.length);
    for (const photo of record.photos) {
        if (!staged.has(photo.id)) {
            if (!photo.data) throw Error('서버에서 사진이 사라졌습니다. 점검표를 다시 열어 주세요.');
            let data = photo.data;
            if (!/^data:image\/(webp|jpeg);base64,/.test(data) || data.split(',')[1].length > 400_000) {
                const blob = await (await fetch(data)).blob();
                data = (await compress(new File([blob], photo.name, {type:blob.type}))).data;
            }
            await post(path(record.id, photo.id), { data }, 'PUT');
        }
        progress?.(++done, record.photos.length);
    }
}
