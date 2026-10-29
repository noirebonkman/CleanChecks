# CleanChecks 개발 파일 안내 — v0.93

## IntelliJ에서 열기
이 폴더의 package.json, src, public, vite.config.ts가 같은 위치에 있어야 합니다.
GitHub에서 Clone한 CleanChecks 폴더에 개발용 파일을 복사하고 newdev 브랜치에서 커밋하세요.
기존 JSON/site-directory.json은 덮어쓰지 마세요.

## 원본 수정 위치
- src/App.tsx: 주요 화면과 앱 흐름
- src/inspection-model.ts: 점검표·현장·점검자 자료 형식
- src/local-storage.ts: 휴대폰 저장·암호화
- src/site-import-and-photos.ts: 엑셀 불러오기·사진 압축
- src/site-directory.ts: 공통 현장 목록
- src/personal-data-transfer.ts: 개인 기록 내보내기·가져오기
- src/shared-ui.tsx: 공통 화면 요소
- src/base-layout.css: 기본 배치
- src/theme-and-components.css: 테마·공통 구성 요소
- src/inspection-workspace.css: 점검 화면 배치
- src/version.ts: 화면과 배포 파일 이름에 쓰는 버전

## 실행
처음 한 번 npm ci
개발 중 npm run dev
검사 npm test
배포 파일 생성 npm run build

dist는 자동으로 만드는 배포 결과입니다. 원본 수정은 src에서 합니다.
배포 파일은 application-v0.93.js, report-export-v0.93.js처럼 역할과 버전으로 생성됩니다.
다음 업데이트에서 src/version.ts와 package.json의 버전을 함께 올린 뒤 빌드하세요.
빌드 후에는 dist 안의 파일을 한 묶음으로 배포하세요. 파일 이름을 따로 고치지 마세요.
기존 데이터베이스 이름·백업 형식·공통 JSON 경로는 변경하지 않았습니다.
이 패키지에는 node_modules 및 실제 현장 JSON을 포함하지 않습니다.
newdev에 커밋하는 것만으로 현재 Pages 배포 브랜치가 바뀌지는 않습니다.

서버 구성과 배포 절차는 SERVER_GUIDE.md를 확인하세요.
