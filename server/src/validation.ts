export class ApiError extends Error {
    constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export function text(value: unknown, label: string, max = 4000, required = false): string {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
        throw new ApiError(400, label + ' 값을 확인해 주세요.');
    return value;
}
export function id(value: unknown): string {
    const result = text(value, '식별번호', 100, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(result))
        throw new ApiError(400, '식별번호 형식이 잘못되었습니다.');
    return result;
}
export function revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new ApiError(400, '수정 버전이 잘못되었습니다.');
    return Number(value);
}
export function site(value: unknown) {
    if (!value || typeof value !== 'object')
        throw new ApiError(400, '현장 정보가 필요합니다.');
    const input = value as Record<string, unknown>;
    return { id: id(input.id), name: text(input.name, '현장명', 200, true), zone: text(input.zone, '구역', 200), address: text(input.address, '주소', 500, true), priority: text(input.priority, '우선도', 100), cycle: text(input.cycle, '작업주기', 200), inactive: input.inactive === true };
}
export function record(value: unknown) {
    if (!value || typeof value !== 'object')
        throw new ApiError(400, '점검표가 필요합니다.');
    const input = value as Record<string, unknown>, result: Record<string, unknown> = { id: id(input.id), site: site(input.site) };
    for (const key of ['date', 'type', 'cycle', 'technician', 'rating', 'issues', 'action', 'assignee', 'due', 'actionState', 'notes', 'updated'])
        result[key] = text(input[key], key);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(result.date)) || !Number.isFinite(Date.parse(String(result.date))))
        throw new ApiError(400, '점검 일시를 확인해 주세요.');
    if (input.status !== 'draft' && input.status !== 'complete')
        throw new ApiError(400, '점검 상태를 확인해 주세요.');
    result.status = input.status;
    result.modified = Boolean(input.modified);
    if (input.completed !== undefined)
        result.completed = text(input.completed, '완료일', 100);
    const answers = input.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers))
        throw new ApiError(400, '평가 항목을 확인해 주세요.');
    const counts = [5, 6, 6, 5, 5, 6, 5];
    const cleanAnswers: Record<string, string> = {};
    for (const [key, grade] of Object.entries(answers)) {
        const match = /^(\d)-(\d)$/.exec(key);
        if (!match || Number(match[1]) > 6 || Number(match[2]) >= counts[Number(match[1])] || !['A', 'B', 'C', 'N/A'].includes(String(grade)))
            throw new ApiError(400, '평가 항목을 확인해 주세요.');
        cleanAnswers[key] = String(grade);
    }
    if (input.status === 'complete' && (Object.keys(cleanAnswers).length !== 38 || !['양호', '보통', '개선 필요', '집중 관리'].includes(String(result.rating))))
        throw new ApiError(400, '점검 항목과 종합평가를 모두 확인해 주세요.');
    result.answers = cleanAnswers;
    if (!Array.isArray(input.photos) || input.photos.length !== 0)
        throw new ApiError(400, '사진 파일은 서버로 전송하지 않습니다. 앱을 최신 버전으로 업데이트해 주세요.');
    if (input.photoCount !== undefined && (!Number.isSafeInteger(input.photoCount) || Number(input.photoCount) < 0 || Number(input.photoCount) > 20))
        throw new ApiError(400, '사진 수량을 확인해 주세요.');
    result.photos = [];
    result.photoCount = Number(input.photoCount || 0);
    result.history = Array.isArray(input.history) ? input.history.slice(-200).map((entry: Record<string, unknown>) => ({ at: text(entry.at, '수정일', 100) })) : [];
    return result;
}
export async function readBody(request: Request, max = 512000): Promise<Uint8Array> {
    const reader = request.body?.getReader();
    if (!reader)
        return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const next = await reader.read();
        if (next.done)
            break;
        size += next.value.length;
        if (size > max) {
            // Drain without retaining additional bytes so the HTTP response can finish cleanly.
            while (!(await reader.read()).done) { }
            throw new ApiError(413, '파일 또는 입력 내용이 너무 큽니다.');
        }
        chunks.push(next.value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const value = JSON.parse(new TextDecoder().decode(await readBody(request)));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error();
        return value;
    }
    catch (error) {
        if (error instanceof ApiError)
            throw error;
        throw new ApiError(400, '입력 내용을 확인해 주세요.');
    }
}
