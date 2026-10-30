# CleanChecks v0.95

서버 로그인 기반 현장점검 앱입니다. 일반 사용자는 본인 기록만, 관리자·어드민은 전체 기록을 조회합니다.
변경 파일 적용 후 기존 IntelliJ 실행 설정을 사용하세요. 실제 업데이트는 프로젝트 루트에서 npm.cmd run server:update로 진행합니다.
이 명령은 원격 DB 백업 → 추가 스키마 적용 → 배포 순서입니다. 기존 D1 ID와 비밀키는 유지합니다.
자세한 적용·Turnstile 설정·이전 데이터 가져오기는 SERVER_GUIDE.md를 확인하세요.

Cloudflare Workers + D1 배포 준비본입니다. R2와 서버 사진 저장을 사용하지 않습니다.

실행·배포·보안·백업 절차는 [SERVER_GUIDE.md](SERVER_GUIDE.md)를 확인하세요.
파일 역할 안내는 [FILE_GUIDE.md](FILE_GUIDE.md)에 있습니다.
