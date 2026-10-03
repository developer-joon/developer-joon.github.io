# Ria & Seoa PaPa 블로그

이 저장소는 `developer-joon.github.io` 기반의 **Jekyll / GitHub Pages** 블로그와 React 커뮤니티입니다.

- 사이트 주소: https://breadlab.ai
- 목적: 블로그, 프로젝트, 소개 페이지를 함께 운영하는 개인 사이트

## 주요 구성

- `_posts/` — 블로그 글
- `_projects/` — 프로젝트 소개
- `_pages/` — 소개, 연락처, 상점, 개인정보 처리방침 등 고정 페이지
- `_layouts/` — 공통 레이아웃
- `_includes/` — 재사용 컴포넌트
- `_data/` — 사이트 설정 데이터
- `images/` — 이미지 자산
- `community-app/` — `/community/`에 배포되는 React/Vite MPA
- `scripts/` — Jekyll과 커뮤니티를 단일 Pages artifact로 조립·검증하는 스크립트

## 로컬 실행

Jekyll 환경이 있다면 아래처럼 실행할 수 있습니다.

```bash
bundle install
bundle exec jekyll serve
```

브라우저에서 확인할 주소:

```text
http://localhost:4000
```

커뮤니티를 포함한 배포 artifact 전체를 빌드하려면 Node.js 24와 Ruby 3.3/Bundler가 필요합니다.

```bash
./scripts/build-site.sh
```

호스트에 Ruby가 없다면 저장소에 고정된 Node.js 24.11.1, Ruby 3.3.10, Bundler 2.5.22 및 `Gemfile.lock`을 사용하는 Docker 빌드를 실행합니다.

```bash
./scripts/build-site-docker.sh
```

Docker 빌드는 고정된 `linux/amd64` 이미지와 UID 10001의 비-root 사용자로 같은 `scripts/build-site.sh`를 실행하고 검증된 artifact를 `_site-docker/`에 복사합니다. 출력 경로를 바꾸려면 첫 번째 인수로 지정합니다(예: `./scripts/build-site-docker.sh /tmp/site-artifact`).

두 명령 모두 커뮤니티 의존성 설치·검사·Vite 빌드, production Jekyll 빌드, community 병합, 최종 artifact 검증을 순서대로 실행합니다. Jekyll의 빌드 시각은 현재 Git commit의 committer timestamp로 고정됩니다. Git metadata가 없는 환경은 명시적인 ISO 8601 값(예: `SITE_BUILD_TIME=2026-01-02T03:04:05+00:00 ./scripts/build-site.sh`)을 전달해야 하며, 값이 없거나 잘못되면 빌드가 중단됩니다. 이미 조립된 artifact만 다시 검사하려면 `node scripts/verify-site.mjs _site`를 실행합니다. 두 artifact의 byte 재현성을 확인하고 정렬된 SHA256 manifest를 남기려면 `./scripts/verify-site-reproducibility.sh BUILD_1_DIR BUILD_2_DIR EVIDENCE_DIR`를 실행합니다.

## 배포

이 사이트는 GitHub Pages 기준으로 운영합니다. 기존 `.github/workflows/jekyll.yml` 하나가 `master` push 또는 수동 실행 시 `_site` artifact를 한 번 업로드하고 배포합니다.

커뮤니티 릴리스 운영 문서:

- [릴리스 runbook](docs/operations/community-release-runbook.md)
- [Free Plan 백업·복구](docs/operations/community-backup-restore.md)
- [롤백·forward-fix](docs/operations/community-rollback.md)
- [검증된 릴리스 체크리스트](docs/operations/community-release-checklist.md)
- [GitHub OAuth 설정](docs/operations/community-oauth-setup.md)

커뮤니티 release gate는 검증과 외부 evidence 생성만 담당합니다. The release gate never deploys or performs a hosted mutation. 각 변경은 runbook의 별도 수동 승인 경계를 따릅니다.

## 관리 메모

- 하드코딩된 글 수나 오래된 문구는 가능한 한 자동화된 값으로 교체하는 편이 좋습니다.
- 이미지 경로와 외부 폼 endpoint는 주기적으로 점검해야 합니다.
- 숨김 파일(`.`으로 시작하는 markdown)은 draft인지 확인 후 정리합니다.

## 참고

README는 사이트 설명용으로 유지하고, 세부 작업 메모는 필요하면 별도 문서로 분리하는 편이 좋습니다.
