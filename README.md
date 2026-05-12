# Ria & Seoa PaPa 블로그

이 저장소는 `developer-joon.github.io` 기반의 **Jekyll / GitHub Pages** 블로그입니다.

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

## 관리 메모

- 하드코딩된 글 수나 오래된 문구는 가능한 한 자동화된 값으로 교체하는 편이 좋습니다.
- 이미지 경로와 외부 폼 endpoint는 주기적으로 점검해야 합니다.
- 숨김 파일(`.`으로 시작하는 markdown)은 draft인지 확인 후 정리합니다.

## 참고

README는 사이트 설명용으로 유지하고, 세부 작업 메모는 필요하면 별도 문서로 분리하는 편이 좋습니다.
