import type { Site } from './inspection-model';

export const siteDetailFields = [
    { key: 'company', label: '구분', maxLength: 100 },
    { key: 'contractPeriod', label: '계약기간', maxLength: 100 },
    { key: 'workDays', label: '요일', maxLength: 100 },
    { key: 'contact', label: '현장 연락처', maxLength: 200 },
] as const;

export function isContractExpired(site: Site, now = new Date()): boolean {
    const match = /^\d{4}-?\d{2}-?\d{2}\s*(?:~|–|—|-)\s*(\d{4})-?(\d{2})-?(\d{2})$/.exec(site.contractPeriod?.trim() || '');
    if (!match) return false;
    const [, year, month, day] = match;
    const end = new Date(Number(year), Number(month) - 1, Number(day));
    if (end.getFullYear() !== Number(year) || end.getMonth() !== Number(month) - 1 || end.getDate() !== Number(day)) return false;
    return end.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function siteLocation(site: Site): string {
    return [site.zone, site.address].filter(Boolean).join(' · ');
}
