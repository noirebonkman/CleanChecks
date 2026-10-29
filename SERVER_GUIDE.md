# v0.94 Cloudflare 배포 준비본 (R2 없음)

## 먼저 알아둘 것
- 서버에는 계정·권한·현장·점검 텍스트·로그만 저장합니다.
- 사진은 촬영한 기기에만 보관합니다. 다른 기기·관리자는 사진을 받지 않습니다.
- 이 기기에서 내보내는 JPG/PDF에는 이 기기의 사진을 포함합니다.
- 어드민 ludmin / 관리자 / 일반 사용자로 권한을 구분합니다.
- 어드민·관리자는 점검자 연결 없이 로그인 즉시 관리 기능을 사용할 수 있습니다.
- 다른 사람의 기록을 수정하는 기능은 없습니다. ludmin만 서버 기록·점검자를 삭제할 수 있습니다.
- 기존 기기의 오래된 암호화 로그는 그 기기의 로컬 PIN으로 별도 해제해야 합니다.
- 실제 Cloudflare 배포는 아직 수행하지 않았습니다.

## IntelliJ에 적용
기존 프로젝트에 파일을 덮어씁니다. JSON, .git, .idea, server/.dev.vars, server/.wrangler를 지우지 않습니다.
특히 기존 .dev.vars의 APP_DATA_KEY를 유지해야 로컬 자료를 읽을 수 있습니다.
루트에서 최초 한 번:
  npm.cmd ci
  npm.cmd run server:install
기존 실행 설정 tools/start-local-server.mjs를 그대로 Run 합니다.
서버 DB는 기존 state-v092를 이어 씁니다. 새 계정을 다시 만들 필요가 없습니다.
npm.cmd run server:test 로 서버 검사를 실행할 수 있습니다.

## Cloudflare 가입 이후 실제 배포 순서
아래는 사용자가 직접 실행하는 절차입니다. 이번 개발 작업에서는 실행하지 않았습니다.
Worker는 Free 요금제에서 시작하고 R2나 Workers 유료 요금제를 신청하지 않습니다.

### 1. 서버용 키 만들기 — 프로젝트 루트
  node tools/prepare-production-secrets.mjs
private/cloudflare-secrets.json에 실제 배포 전용 암호화 키와 초기 설정 코드를 만듭니다.
이미 파일이 있으면 덮어쓰지 않습니다. 내용은 콘솔에 출력하지 않습니다.
Git에는 올리지 않고 안전하게 별도 보관합니다. 로컬 테스트 키와는 별개입니다.
배포 후에는 APP_DATA_KEY를 새로 만들거나 바꾸지 않습니다. 기존 자료를 읽지 못하게 됩니다.

### 2. Cloudflare 로그인과 데이터베이스 생성 — server 폴더
  cd server
  npx.cmd wrangler login
  npx.cmd wrangler d1 create cleanchecks --location=apac
출력된 database_id를 server/wrangler.jsonc의 00000000-0000-0000-0000-000000000000 자리에 넣습니다.
apac는 아시아·태평양 위치 힌트이며 서울이나 국내 저장을 보장하지 않습니다.

### 3. 비밀 설정과 테이블 등록 — server 폴더
  npx.cmd wrangler secret bulk ../private/cloudflare-secrets.json
  npm.cmd run db:remote
비밀 설정은 Worker의 Secrets에 들어갑니다. 공개 vars나 VITE_ 변수에 넣지 않습니다.
원격 migration 확인 질문은 대상이 cleanchecks인지 확인하고 진행합니다.
로컬 계정과 로컬 테스트 기록은 실제 서버로 자동 이전되지 않습니다.

### 4. 배포 검사와 배포 — 프로젝트 루트
  cd ..
  npm.cmd run server:build
  npm.cmd run server:check
  npm.cmd run server:deploy
server:check는 실제 업로드 없는 dry-run입니다. 실제 서버 접속·세션 동작까지 보증하는 검사는 아닙니다.
server:deploy는 검사 후 실제 업로드합니다. D1 ID가 기본값이면 중단합니다.
배포할 웹 파일은 .server-build/v0.94으로 분리합니다. 원본·현장 JSON·비밀 파일은 제외합니다.
기존 GitHub Pages 배포와 Cloudflare 서버 배포는 별개입니다.

### 5. 실제 주소에서 첫 설정
배포 출력의 HTTPS 주소로 접속합니다.
설정 → 서버 저장 → 처음 서버를 설정하시나요? 를 누릅니다.
private/cloudflare-secrets.json의 SETUP_TOKEN 값으로 ludmin을 한 번만 생성합니다.
비밀번호는 직접 정하고, 이전 대화의 예시 비밀번호를 기본값으로 사용하지 않습니다.
로그인 후 관리자 기능이 즉시 표시되는지 확인합니다.
일반 사용자 계정을 만들어 다른 계정의 데이터가 보이지 않는지 확인합니다.
현장 엑셀은 로그인한 관리자 메뉴로 가져오고 서버로 전송합니다.
민감한 현장 목록을 public/JSON으로 공개 배포하지 않습니다.

## 보안과 복구
- 이름·주소·점검 텍스트는 AES-GCM으로 암호화해 D1에 저장합니다.
- 비밀번호는 솔트 + PBKDF2 해시입니다. 서버 API에서 해시나 원문을 반환하지 않습니다.
- 로그인 세션은 DB에 토큰 해시로 저장합니다. 쿠키는 HttpOnly·SameSite=Strict, HTTPS에서는 Secure와 __Host- 접두사를 사용합니다.
- 서버에서도 어드민·관리자·일반 사용자 권한과 기록 소유자를 검사합니다.
- 외부 Origin 요청, 비JSON 변경 요청, 과도한 입력과 로그인 시도를 제한합니다.
- 로그아웃·계정 중지·비밀번호 변경 시 세션을 해제합니다.
- 사진 요청은 서버에서 거부합니다. R2 설정이 있으면 배포 검사에서 중단합니다.
- 서버 API 응답은 캐시하지 않습니다. 비밀키는 브라우저 번들에 넣지 않습니다.
- 로컬 저장은 서버 계정 보호와 별개입니다. 공용 기기의 기존 기록은 서버 로그아웃만으로 삭제되지 않습니다.
- 데이터베이스 백업과 APP_DATA_KEY를 함께 보관하되 공개 저장소에 올리지 않습니다.
- server 폴더에서 원격 DB 백업 예:
  npx.cmd wrangler d1 export cleanchecks --remote --output ../private/cleanchecks-backup.sql
  먼저 private 폴더가 있는지 확인합니다. 이 백업은 계정 해시도 포함하므로 민감 자료입니다.
- 앱 내 어드민 분실 복구·암호화 키 자동 교체는 제공하지 않습니다. 비밀번호와 키 백업이 필요합니다.
- Free 요금제 한도를 넘으면 서비스가 제한될 수 있습니다. 무료 운영의 무중단 보장은 아닙니다.

## 검증 범위
TypeScript, 기존 UI·내보내기 회귀 검사, 실제 로컬 Workers/D1에서 인증·권한·충돌·R2 미사용·암호문 변조 거부를 검사했습니다.
실제 Cloudflare 계정 배포와 휴대폰 실기기 검사는 배포 후 추가 확인해야 합니다.

## v0.94 추가 검사

- 배포에는 Vite 빌드 목록과 지정된 아이콘·로고만 포함합니다.
- 현장 JSON, 비밀 설정, 관계없는 파일은 배포 대상에서 제외합니다.
- 빌드 후 파일이 바뀌거나 다른 파일이 섞이면 배포 검사가 중단됩니다.
- 파일 해시 목록은 공개 웹 폴더 밖에 보관합니다.
- 로컬 사전 검사 통과는 실제 Cloudflare 배포 성공을 뜻하지 않습니다.
- 기존 .dev.vars와 .wrangler/state-v092는 유지하세요. 암호화 키를 새로 만들거나 로컬 DB를 지우지 마세요.
