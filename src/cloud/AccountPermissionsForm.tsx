import { useState, type FormEvent } from 'react';
import { permissionKeys, permissionLabels, resolvePermissions, type PermissionOverrides } from '../access-control';
import type { ServerUser } from './client';

type Props = { person: ServerUser; disabled: boolean; onSave: (permissions: PermissionOverrides) => Promise<void> };
export function AccountPermissionsForm({ person, disabled, onSave }: Props) {
    const defaults = resolvePermissions(person.role);
    const [values, setValues] = useState<PermissionOverrides>(() => Object.fromEntries(
        permissionKeys.map(key => [key, person.permissionOverrides?.[key] ?? null])
    ) as PermissionOverrides);
    const submit = (event: FormEvent) => { event.preventDefault(); void onSave(values); };
    return <form className="permission-form" onSubmit={submit}>
        <fieldset disabled={disabled}>
            <legend>개인별 권한 · {person.name}</legend>
            <p className="hint">등급 기본값을 따르거나, 이 사용자에게만 허용·차단할 수 있습니다.</p>
            {permissionKeys.map(key => <label className="permission-row" key={key}>
                <span>{permissionLabels[key]}<small>저장 후 적용: {resolvePermissions(person.role, values)[key] ? '허용' : '차단'}</small></span>
                <select aria-label={person.name + ' ' + permissionLabels[key]} value={values[key] === null ? 'default' : values[key] ? 'allow' : 'deny'}
                    onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value === 'default' ? null : event.target.value === 'allow' }))}>
                    <option value="default">등급 기본값 ({defaults[key] ? '허용' : '차단'})</option>
                    <option value="allow">이 사용자 허용</option>
                    <option value="deny">이 사용자 차단</option>
                </select>
            </label>)}
            <p className="hint">위임한 계정 관리 권한은 일반 계정의 추가·사용 중지·임시 비밀번호 발급에 적용됩니다. 다른 사람의 기록은 조회만 가능합니다. 기록 삭제·관리자 승격·상세 관리 로그는 어드민 전용입니다. 저장하면 해당 사용자의 기존 로그인이 해제됩니다.</p>
            <button type="button" onClick={() => setValues(Object.fromEntries(permissionKeys.map(key => [key, null])) as PermissionOverrides)}>등급 기본값으로 되돌리기</button>
            <button className="primary" type="submit">개인별 권한 저장</button>
        </fieldset>
    </form>;
}
