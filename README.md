# breadlab.ai

이 저장소는 `developer-joon.github.io` 기반의 **Jekyll / GitHub Pages** 기술 블로그입니다. AI 에이전트, 소프트웨어 개발, Kubernetes·인프라와 코드 기반 수익 실험을 기록합니다.

- 서비스 주소: https://www.breadlab.ai
- Apex 도메인: https://breadlab.ai
- 배포 브랜치: `master`
- 수익실험실: https://www.breadlab.ai/lab/

## 주요 구성

- `_posts/` — 블로그 글
- `_projects/` — 프로젝트 소개
- `_pages/` — 소개, 연락처, 수익실험실, 개인정보 처리방침 등 고정 페이지
- `_layouts/` — 공통 레이아웃
- `_includes/` — 재사용 컴포넌트
- `_data/` — 사이트 설정 데이터
- `images/` — 이미지 자산

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

## 배포

이 사이트는 GitHub Pages 기준으로 운영합니다.
수정 후에는 `master` 브랜치에 반영하면 배포 흐름에 맞게 갱신됩니다.

## 콘텐츠 원칙

- 제품 발표와 독립 검증 결과를 구분합니다.
- 성능 수치는 측정 조건과 출처를 함께 기록합니다.
- AI 에이전트와 자동화는 실패 모드, 권한, 복구 절차까지 다룹니다.
- 수익실험실은 확정 수익과 미실현 손익을 구분하며, 확인되지 않은 계좌 잔고를 임의로 합산하지 않습니다.
- 외부 이미지는 저작권과 사용 조건을 확인하고, 현재 포스트 커버는 재현 가능한 `picsum.photos` seed 규칙을 사용합니다.

## 변경 검증

콘텐츠를 추가하거나 페이지를 수정한 뒤 최소한 다음 검증을 실행합니다.

```bash
bundle exec jekyll build
git diff --check
git status --short
```

로컬에 Ruby/Bundler가 없다면 프로젝트 `Gemfile.lock`과 호환되는 환경 또는 컨테이너에서 빌드해야 합니다. 빌드하지 않은 변경을 검증 완료로 간주하지 않습니다.

## 관리 메모

- 페이지의 글 수는 `site.posts | size`처럼 Jekyll 데이터에서 계산하고 하드코딩하지 않습니다.
- 이미지 경로와 외부 폼 endpoint는 주기적으로 점검해야 합니다.
- 숨김 파일(`.`으로 시작하는 markdown)은 draft인지 확인 후 정리합니다.
- 수익실험실 스냅샷에는 기준일과 확인 범위를 명시합니다.

## 참고

README는 사이트 운영 기준만 유지합니다. 일회성 조사 기록과 포스팅 원고는 각각 별도 문서와 `_posts/`에서 관리합니다.
