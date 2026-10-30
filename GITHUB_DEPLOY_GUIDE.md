# GitHub → Cloudflare 자동배포 연결

이 파일 묶음은 v0.95 적용 후 덮어쓰는 자동배포 추가분입니다. 앱 버전은 변경하지 않습니다.
프로젝트 루트에 덮어쓰세요. .github 폴더도 포함해야 합니다.
기존 server/wrangler.jsonc의 실제 D1 ID와 Cloudflare의 APP_DATA_KEY·SETUP_TOKEN은 그대로 유지합니다.

## 처음 한 번 할 일

1. Cloudflare에서 현재 계정 전용 API 토큰을 만드세요.
   Workers Scripts 편집 및 D1 편집 권한을 지정하고 사용할 계정만 선택하세요.
   공식 안내: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
2. IntelliJ 터미널의 프로젝트 루트에서 실행하세요.
   node tools/github-backup.mjs keygen
   private/github-backup-key.txt 파일을 열고 값을 복사하세요. 이 키는 안전하게 별도 보관하세요.
   이미 키가 있다면 다시 만들지 않고 기존 값을 사용합니다.
3. GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret에 아래 세 개를 등록하세요.

| 이름 | 넣을 값 |
|---|---|
| CLOUDFLARE_API_TOKEN | 1번에서 만든 API 토큰 |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare 계정 ID 32자리. D1 ID가 아닙니다. |
| BACKUP_ENCRYPTION_KEY | private/github-backup-key.txt 내용 |

키와 토큰은 채팅이나 Git에 올리지 마세요. private 폴더는 기존 .gitignore에서 제외됩니다.
Cloudflare에 등록한 APP_DATA_KEY·SETUP_TOKEN을 GitHub에 복사할 필요는 없습니다.
server/wrangler.jsonc에는 실제 DB 연결 하나(binding: DB)가 필요합니다. D1 ID는 비밀번호가 아닙니다.

## 사용 방법

main에 푸시하면 검사 → 빌드 → DB 백업 암호화 → 백업 보관 → DB 마이그레이션 → 배포 순서로 실행합니다.
dev 등 다른 브랜치에서는 배포하지 않습니다. main 대상 Pull Request는 검사만 합니다.
dev에서 작업했다면 검토 후 main에 병합하세요.
GitHub Actions 탭에서 실행 결과를 확인하세요. 첫 실제 실행은 위 세 값 등록 후 확인해야 합니다.

기존 GitHub Pages용 deploy.yml을 교체합니다.
별도로 Settings → Pages에서 브랜치 배포를 켜 놓았다면 그 설정은 유지되므로, 필요 없으면 Source를 정리하세요.
Cloudflare가 GitHub 푸시를 직접 배포하는 Workers Builds를 별도로 연결했다면 중복 배포를 피하도록 한 방식만 사용하세요.

## 백업

DB를 SQL로 내보낸 뒤 AES-256-GCM으로 암호화합니다.
GitHub에는 암호화 파일만 14일 보관하며, 백업 업로드가 실패하면 DB 변경과 배포를 진행하지 않습니다.
Actions 실행의 Artifacts에서 백업을 내려받아 압축을 푸세요.
로컬 private/github-backup-key.txt를 보관한 상태에서 다음처럼 SQL 파일로 풀 수 있습니다.

node tools/github-backup.mjs decrypt "private/cloudflare-backup.encrypted" "private/restored-backup.sql"

이 명령은 SQL 파일만 만들며 실제 DB를 복원하거나 덮어쓰지 않습니다.
키를 잃으면 백업을 해독할 수 없습니다. 장기 보관이 필요하면 암호화 백업을 직접 내려받으세요.
마이그레이션 이후 배포가 실패해도 DB 변경은 자동으로 취소되지 않습니다.
스키마를 삭제하거나 호환성을 깨는 변경은 별도 검토해야 합니다.

## 확인 범위

로컬 테스트 및 배포 설정 검사를 제공합니다.
GitHub Secrets 등록·실제 GitHub 실행·Cloudflare 배포는 사용자가 진행합니다.
