export function historyLabel(action:string):string {
 const labels:Record<string,string>={
  login:'로그인', 'password-changed':'비밀번호 변경', 'password-reset':'임시 비밀번호 발급', 'account-name-changed':'본인 이름 변경',
  'account-created':'계정 생성', 'account-disabled':'계정 사용 중지', 'account-enabled':'계정 사용 재개',
  'account-permissions-changed':'개인별 권한 변경', 'account-role-changed':'계정 등급 변경', 'account-management':'계정 관리',
  'inspection-saved':'점검 저장', 'inspection-deleted':'점검 삭제', 'inspection-restored':'점검 복원',
  'owner-deleted-record':'어드민 점검 삭제', 'owner-deleted-account':'어드민 계정 삭제',
  'record-deleted':'점검 기록 삭제', 'account-deleted':'점검자 삭제', 'site-saved':'현장 저장',
  'server-initialized':'서버 최초 설정', 'calendar-created':'일정 추가', 'calendar-updated':'일정 변경',
  'calendar-deleted':'일정 삭제', 'calendar-imported':'엑셀 일정 등록'
 };
 return labels[action]||'관리 작업';
}
