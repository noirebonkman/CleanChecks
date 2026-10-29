import type { Inspection, State, Site } from '../inspection-model';
import { post, request, type ServerUser } from './client';
export type CloudLink = {
    userId: string;
    staffId: string;
    automatic: boolean;
    records: Record<string, {
        revision: number;
        fingerprint: string | null;
    }>;
    photoIds?: Record<string, string>;
    lastSynced?: string;
};
export type RemoteRecord = {
    id: string;
    ownerId: string;
    revision: number;
    deleted: boolean;
    record: Omit<Inspection, 'staffId' | 'photos'> & {
        photoCount?: number;
        photos: {
            id: string;
            name: string;
        }[];
    } | null;
};
export type Snapshot = {
    records: RemoteRecord[];
    sites: {
        site: Site;
        revision: number;
    }[];
};
export function canonical(value: unknown): string {
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
    return JSON.stringify(value);
}
export async function fingerprint(record: Inspection): Promise<string> {
    const bytes = new TextEncoder().encode(canonical(record));
    const value = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function listRemoteRecords(path = 'records'): Promise<RemoteRecord[]> {
    const result: RemoteRecord[] = [];
    let cursor: string | null = null;
    do {
        const page: {
            records: RemoteRecord[];
            nextCursor: string | null;
        } = await request<{
            records: RemoteRecord[];
            nextCursor: string | null;
        }>(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
        result.push(...page.records);
        cursor = page.nextCursor;
        if (result.length > 10000)
            throw Error('기록이 많아 관리자 확인이 필요합니다.');
    } while (cursor);
    return result;
}
async function hydrate(row: RemoteRecord, staffId: string, localPhotos: Inspection['photos'] = []): Promise<Inspection> {
    const { photoCount, ...value } = row.record!;
    return { ...value, staffId, photos: localPhotos, serverPhotoCount: photoCount || 0 };
}
function reference(record: Inspection, _link: CloudLink) {
    const { staffId, serverPhotoCount, photos, ...rest } = record;
    return { ...rest, photos: [], photoCount: photos.length || serverPhotoCount || 0 };
}
export async function synchronizeCloud(user: ServerUser, getState: () => State, save: (state: State) => Promise<void>): Promise<{
    sent: number;
    received: number;
    conflicts: string[];
    conflictIds: string[];
}> {
    if (user.role !== 'inspector')
        throw Error('관리 계정은 점검자 연결이 필요하지 않습니다.');
    const start = getState().cloud;
    if (!start || start.userId !== user.id)
        throw Error('동기화할 점검자를 먼저 연결해 주세요.');
    const remote = await listRemoteRecords();
    const rows = new Map(remote.map(row => [row.id, row]));
    const initial = getState();
    const ids = new Set([...initial.records.filter(record => record.staffId === start.staffId).map(record => record.id), ...Object.keys(start.records), ...rows.keys()]);
    const result = { sent: 0, received: 0, conflicts: [] as string[], conflictIds: [] as string[] };
    const updateLink = async (recordId: string, revision: number, value: string | null, local?: Inspection | null, expected?: string | null) => {
        const current = getState(), link = current.cloud;
        if (!link || link.userId !== user.id)
            throw Error('서버 연결이 변경되었습니다.');
        let records = current.records;
        if (local !== undefined) {
            const existing = records.find(record => record.id === recordId);
            if (existing && existing.staffId !== link.staffId)
                throw Error('다른 점검자의 동일한 기록 번호가 있습니다.');
            const currentPrint = existing ? await fingerprint(existing) : null;
            if (expected !== undefined && currentPrint !== expected)
                throw Error('동기화 중 기기 기록이 변경되었습니다. 다시 동기화해 주세요.');
            records = records.filter(record => record.id !== recordId);
            if (local)
                records = [...records, local];
        }
        await save({ ...current, records, cloud: { ...link, records: { ...link.records, [recordId]: { revision, fingerprint: value } } } });
    };
    for (const recordId of ids) {
        const current = getState(), link = current.cloud!;
        const local = current.records.find(record => record.id === recordId);
        if (local && local.staffId !== link.staffId) {
            result.conflicts.push(recordId);
            result.conflictIds.push(recordId);
            continue;
        }
        const row = rows.get(recordId), base = link.records[recordId], localPrint = local ? await fingerprint(local) : null;
        const localChanged = base ? localPrint !== base.fingerprint : !!local;
        const remoteChanged = !!row && (!base || row.revision !== base.revision);
        if (remoteChanged && localChanged) {
            if (local && !row!.deleted && canonical(reference(local, link)) === canonical(row!.record)) {
                await updateLink(recordId, row!.revision, localPrint);
                continue;
            }
            result.conflicts.push(local?.site.name || row?.record?.site.name || recordId);
            result.conflictIds.push(recordId);
            continue;
        }
        if (remoteChanged) {
            const value = row!.deleted ? null : await hydrate(row!, link.staffId, local?.photos || []);
            await updateLink(recordId, row!.revision, value ? await fingerprint(value) : null, value, localPrint);
            result.received++;
            continue;
        }
        if (!localChanged)
            continue;
        if (!local) {
            if (!base)
                continue;
            const response = await post<{
                revision: number;
            }>('records/' + recordId, { revision: base.revision }, 'DELETE');
            await updateLink(recordId, response.revision, null);
            result.sent++;
            continue;
        }
        const latestLink = getState().cloud!;
        const response = await post<{
            revision: number;
        }>('records/' + recordId, { revision: base?.revision || 0, record: reference(local, latestLink) }, 'PUT');
        await updateLink(recordId, response.revision, localPrint);
        result.sent++;
    }
    const catalog = await request<{
        sites: {
            site: Site;
            revision: number;
        }[];
    }>('sites');
    const current = getState(), link = current.cloud!;
    // Keep local-only catalog entries and historical snapshots. Unsaved administrator edits take priority.
    const sites = current.directoryDirty || !catalog.sites.length ? current.sites : [
        ...current.sites.filter(site => !catalog.sites.some(row => row.site.id === site.id)), ...catalog.sites.map(row => row.site)
    ];
    await save({ ...current, sites, cloud: { ...link, lastSynced: new Date().toISOString() } });
    return result;
}
export async function resolveCloudConflict(recordId: string, choice: 'server' | 'device', user: ServerUser, getState: () => State, save: (state: State) => Promise<void>): Promise<void> {
    const row = (await listRemoteRecords()).find(record => record.id === recordId);
    if (!row)
        throw Error('서버 기록을 다시 확인해 주세요.');
    const current = getState(), link = current.cloud;
    if (!link || link.userId !== user.id)
        throw Error('서버 계정 연결을 확인해 주세요.');
    const local = current.records.find(record => record.id === recordId);
    if (local && local.staffId !== link.staffId)
        throw Error('다른 점검자의 기록입니다.');
    const before = local ? await fingerprint(local) : null;
    if (choice === 'device') {
        await save({ ...current, cloud: { ...link, records: { ...link.records, [recordId]: { revision: row.revision, fingerprint: row.deleted ? null : 'server-version-selected-for-replacement' } } } });
        return;
    }
    const replacement = row.deleted ? null : await hydrate(row, link.staffId, local?.photos || []);
    const latest = getState(), latestLocal = latest.records.find(record => record.id === recordId);
    if ((latestLocal ? await fingerprint(latestLocal) : null) !== before)
        throw Error('처리 중 기기 기록이 변경되었습니다. 다시 선택해 주세요.');
    await save({ ...latest, records: [...latest.records.filter(record => record.id !== recordId), ...(replacement ? [replacement] : [])], cloud: { ...latest.cloud!, records: { ...latest.cloud!.records, [recordId]: { revision: row.revision, fingerprint: replacement ? await fingerprint(replacement) : null } } } });
}
