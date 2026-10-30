import type { State } from '../inspection-model';
import { uid } from '../inspection-model';
import { bootstrap } from '../app-bootstrap';
import { load, save, selectAccountStorage } from '../local-storage';
import { request, type ServerUser } from './client';
import { listRemoteRecords } from './synchronization';

export async function prepareAccountWorkspace(user: ServerUser): Promise<void> {
    await selectAccountStorage(user.id);
    let data = await load();
    if (!data) data = { version: 1, installId: uid(), sites: [], staff: [], records: [], logs: [], ...bootstrap, admin: undefined };
    const self = { id: user.id, name: user.name, active: true, salt: '', hash: '' };
    const staff = user.role === 'inspector'
        ? [self]
        : [...data.staff.filter(person => person.id !== user.id), self];
    // No legacy person/name matching: only this authenticated account's partition is loaded.
    await save({
        ...data, staff,
        records: user.role === 'inspector' ? data.records.filter(record => record.staffId === user.id) : data.records,
        cloud: data.cloud?.userId === user.id ? { ...data.cloud, staffId: user.id, automatic: true }
            : { userId: user.id, staffId: user.id, automatic: true, records: {} },
    });
}

export async function receiveManagementRecords(user: ServerUser, current: State): Promise<State> {
    if (user.role === 'inspector') return current;
    const [{ users }, rows] = await Promise.all([
        request<{ users: ServerUser[] }>('people'), listRemoteRecords('admin/records'),
    ]);
    const others = rows.filter(row => row.ownerId !== user.id && !row.deleted && row.record).map(row => ({
        ...row.record!, staffId: row.ownerId, photos: [], serverPhotoCount: row.record!.photoCount || 0,
    }));
    const owners = new Set(others.map(record => record.staffId));
    const people = users.map(person => ({ id: person.id, name: person.name, active: person.active || owners.has(person.id), salt: '', hash: '' }));
    if (!people.some(person => person.id === user.id)) people.push({ id: user.id, name: user.name, active: true, salt: '', hash: '' });
    return { ...current, staff: people, records: [...current.records.filter(record => record.staffId === user.id), ...others] };
}
