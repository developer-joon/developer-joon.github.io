# Breadlab 커뮤니티 설계

- 작성일: 2026-09-25
- 상태: 승인된 설계
- 대상 저장소: `developer-joon/developer-joon.github.io`
- 기준 브랜치: `origin/master`
- 공개 경로: `https://www.breadlab.ai/community/`

## 1. 목적

기존 Jekyll 기술 블로그에 개발자가 자유롭게 글을 쓰고 댓글로 대화할 수 있는 커뮤니티를 추가한다. 커뮤니티는 GitHub 계정으로 로그인한 모든 사용자가 글과 댓글을 작성할 수 있고, 비로그인 사용자도 공개 콘텐츠를 읽을 수 있어야 한다.

이 기능은 Q&A로 제한하지 않는다. 질문, 경험 공유, 프로젝트 소개, 짧은 의견을 동일한 게시글 모델로 다룬다. 기존 블로그 포스트와 사용자 콘텐츠는 분리하며, 메인 내비게이션에서 `커뮤니티` 메뉴로 연결한다.

## 2. 범위

### 포함

- GitHub OAuth 로그인
- 공개 게시글 목록과 상세 페이지
- Markdown 글 작성·수정·소프트 삭제
- JPEG·PNG·WebP 이미지 첨부
- 댓글과 한 단계 대댓글
- 게시글·댓글 좋아요
- 복수 태그
- 최신순·인기순·댓글순 정렬
- 제목·본문 검색
- 신고, 숨김, 복구, 잠금
- 관리자 신고 대기열과 감사 로그
- 로컬 초안 저장
- 커뮤니티 게시글 SEO snapshot과 sitemap
- staging·production 분리, 테스트, 배포 및 롤백

### 제외

- 익명 글쓰기
- 개인 메시지
- 사용자 팔로우
- 평판 점수와 배지
- 다단계 댓글 트리
- 실시간 알림
- 블로그 포스트와 커뮤니티 글의 통합 피드
- 사용자 HTML 입력
- SVG 및 일반 파일 첨부
- 자동 AI 윤문

사용자 콘텐츠에는 블로그 운영자의 `humanize-korean` 워크플로를 자동 적용하지 않는다. 작성자의 문체를 임의로 바꾸지 않고, 운영자가 별도로 작성하는 공지와 편집 콘텐츠에만 기존 블로그 윤문 절차를 적용한다.

## 3. 기술 결정

### 3.1 프런트엔드

- 기존 블로그: `master`에서 채택한 Jekyll 4.4.1과 GitHub Actions Pages 배포 유지
- 커뮤니티: React + TypeScript + Vite SPA
- 위치: 저장소의 `community-app/`
- Vite base path: `/community/`
- 공개 라우트:
  - `/community/`
  - `/community/write/`
  - `/community/post/?id=<uuid>`
  - `/community/edit/?id=<uuid>`
  - `/community/admin/reports/`
- Jekyll 헤더의 `Blog` 옆에 `커뮤니티` 메뉴를 추가한다.
- 제품 UI 문구는 한국어를 사용한다.

Jekyll과 React는 소스 단계에서 결합하지 않는다. 각각 독립 빌드하고 최종 Pages artifact에서만 `/community/` 경로로 합친다.

GitHub Pages는 임의 SPA 경로 rewrite를 제공하지 않으므로 고정 화면은 실제 `index.html` shell을 만들고, 게시글·수정 대상 ID는 query parameter로 전달한다. 정상 사용자 흐름을 custom 404 fallback에 의존시키지 않는다.

### 3.2 백엔드

Supabase를 사용한다.

- Auth: GitHub OAuth
- Postgres: 게시글, 댓글, 태그, 반응, 신고, 권한, 감사 로그
- Storage: 게시글 이미지
- Edge Functions: 파일 검증, 관리자 작업 등 service role이 필요한 경계
- staging과 production은 별도 Supabase 프로젝트를 사용한다.

### 3.3 배포

현재 `master`의 `.github/workflows/jekyll.yml`을 단일 배포 workflow로 확장한다. 커뮤니티 전용 Pages 배포 workflow를 추가하지 않는다.

배포 작업은 다음 순서를 따른다.

1. Ruby·Node 의존성 고정 설치
2. Jekyll 빌드
3. 커뮤니티 TypeScript·테스트·Vite 빌드
4. Vite 산출물을 Jekyll `_site/community/`에 결합
5. 기존 주요 URL과 커뮤니티 entry point 검증
6. 단일 Pages artifact 업로드
7. production 배포
8. 배포 후 health check

생성된 Vite bundle은 소스 브랜치에 커밋하지 않는다.

## 4. 정보 구조와 UX

### 4.1 목록

`/community/`는 다음 요소를 제공한다.

- 커뮤니티 소개와 `글쓰기` 버튼
- 검색
- 태그 필터
- 최신순·인기순·댓글순 정렬
- 공지 글 고정
- 게시글 카드
  - 제목
  - 본문 요약
  - 작성자와 아바타
  - 작성·수정 시각
  - 최대 3개 태그
  - 댓글 수와 좋아요 수
- URL에 검색어, 태그, 정렬, 페이지 상태 보존
- 빈 결과, 로딩, 오류 상태

초기 추천 태그는 `AI·Agent`, `개발`, `인프라·클라우드`, `사이드 프로젝트`, `자유 이야기`다. 게시글은 최대 3개 태그를 갖는다. 사용자가 임의 태그를 생성하지 않고 운영자가 활성 태그 목록을 관리한다.

### 4.2 작성

`/community/write/`는 다음을 제공한다.

- 제목
- Markdown 편집기
- 미리보기
- 태그 선택
- 이미지 드래그앤드롭·진행 상태·재시도
- 브라우저 로컬 초안
- 게시 전 유효성 검사

비로그인 사용자가 글쓰기를 시작하면 현재 경로와 로컬 초안을 보존한 뒤 GitHub OAuth를 시작한다. 인증 후 원래 작성 화면으로 돌아온다.

### 4.3 상세와 댓글

`/community/post/?id=<uuid>`는 다음을 제공한다.

- sanitized Markdown 본문
- 작성자, 작성·수정 시각
- 태그
- 좋아요
- 작성자용 수정·삭제
- 신고
- 댓글과 한 단계 대댓글
- 운영자용 숨김·복구·잠금

잠긴 글은 읽기와 기존 댓글 열람은 가능하지만 새 댓글과 대댓글을 받지 않는다. 삭제된 게시글에 댓글이 있으면 자리와 댓글을 유지하고 본문을 `삭제된 글입니다`로 대체한다.

## 5. 데이터 모델

모든 기본 키는 UUID를 사용하고 모든 시각은 UTC `timestamptz`로 저장한다.

### `profiles`

- `id`: Auth user ID, PK
- `github_user_id`: GitHub의 불변 사용자 ID, unique
- `login`: GitHub login
- `display_name`
- `avatar_url`
- `created_at`, `updated_at`

### `user_roles`

- `user_id`
- `role`: `member` 또는 `admin`
- `granted_at`
- `granted_by`

클라이언트는 이 테이블을 수정할 수 없다. 관리자 판정은 이 테이블과 security-definer 함수를 통해 수행한다.

### `posts`

- `id`
- `author_id`
- `title`
- `body_markdown`
- `status`: `published`, `hidden`, `deleted`
- `is_locked`
- `is_pinned`
- `created_at`, `updated_at`, `deleted_at`

제목은 trim 후 2~120자, 본문은 trim 후 1~50,000자로 제한한다. UI validation과 DB constraint가 같은 값을 사용한다.

### `comments`

- `id`
- `post_id`
- `author_id`
- `parent_id`: null 또는 같은 게시글의 최상위 댓글 ID
- `body_markdown`
- `status`: `published`, `hidden`, `deleted`
- `created_at`, `updated_at`, `deleted_at`

DB constraint 또는 trigger로 대댓글의 부모가 다시 대댓글을 가리키지 못하게 한다.
댓글 본문은 trim 후 1~5,000자로 제한한다.

### `tags`와 `post_tags`

- `tags`: `id`, `slug`, `label`, `is_active`, `sort_order`
- `post_tags`: `post_id`, `tag_id`
- 게시글당 활성 태그 최대 3개를 DB에서 강제한다.

### `post_reactions`와 `comment_reactions`

- 공통 열: `id`, `user_id`, `created_at`
- `post_reactions`: `post_id`, 사용자·게시글 조합 unique
- `comment_reactions`: `comment_id`, 사용자·댓글 조합 unique
- 두 대상 열은 실제 대상에 foreign key를 갖는다.
- 존재하지 않거나 삭제·숨김 처리된 대상에는 reaction을 생성할 수 없다.

### `attachments`

- `id`
- `owner_id`
- `post_id`: 게시 전에는 null
- `storage_path`: unique
- `mime_type`
- `byte_size`
- `status`: `pending`, `attached`, `quarantined`, `deleted`
- `created_at`, `attached_at`, `deleted_at`

### `reports`

- `id`
- `reporter_id`
- `target_type`: `post`, `comment`
- `target_id`
- `reason_code`
- `detail`
- `status`: `open`, `reviewing`, `resolved`, `dismissed`
- `created_at`, `resolved_at`, `resolved_by`

동일 사용자의 동일 대상 중복 open 신고는 허용하지 않는다.

### `moderation_audit_logs`

- `id`
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `reason`
- `metadata`
- `created_at`

감사 로그는 일반 클라이언트가 수정·삭제할 수 없다.

## 6. 인증과 권한

### 공개 사용자

- `published` 게시글·댓글과 활성 태그를 읽을 수 있다.
- `hidden`, `deleted`, 신고, 권한, 감사 로그는 읽을 수 없다.

### 로그인 사용자

- GitHub OAuth로 생성된 `auth.users` row는 검증된 provider metadata를 통해 `public.profiles`로 자동 provision한다.
- 본인 이름으로 글·댓글·reaction·신고를 생성할 수 있다.
- 자신의 게시글·댓글만 수정·소프트 삭제할 수 있다.
- `author_id`는 요청 payload가 아니라 `auth.uid()`에서 결정한다.
- 다른 사용자의 pending 첨부파일을 읽거나 연결할 수 없다.

### 관리자

- 게시글·댓글 숨김·복구·잠금
- 공지 고정
- 신고 상태 변경
- 활성 태그 관리
- 감사 로그 조회

관리 기능은 클라이언트의 `is_admin` 값에 의존하지 않는다. RLS와 DB 함수가 권한을 재확인한다. service role key는 브라우저 bundle에 포함하지 않는다.

## 7. Markdown과 이미지 보안

- Markdown parser에서 raw HTML을 비활성화한다.
- 렌더링 결과를 allowlist sanitizer로 다시 정제한다.
- 링크는 안전한 프로토콜만 허용하고 외부 링크에 적절한 `rel` 속성을 적용한다.
- 코드 블록과 inline code를 지원한다.
- 허용 이미지: JPEG, PNG, WebP
- 파일당 최대 5MB
- 게시글당 최대 5개
- SVG, HTML, scriptable 문서, 임의 binary는 거부한다.
- 확장자나 브라우저 MIME만 믿지 않고 Edge Function이 파일 signature와 실제 크기를 검증한다.
- Storage 쓰기 경로는 사용자 ID와 무작위 ID를 포함하고 원본 파일명을 경로로 사용하지 않는다.
- bucket은 private으로 유지한다. 공개 게시글에 연결된 이미지는 게시 상태와 attachment 상태를 재검증하는 공개 전달 Edge Function을 통해서만 읽고, 숨김·삭제·격리 상태에서는 즉시 거부한다.
- pending 첨부는 글 생성 transaction 성공 후에만 게시글과 연결한다.
- 생성 후 24시간이 지난 연결되지 않은 pending 첨부는 정기 작업으로 정리한다.
- 소프트 삭제된 게시글의 이미지는 30일 복구 유예 기간 후 물리 삭제한다.

## 8. 남용 방지와 운영

- GitHub OAuth 로그인을 작성 조건으로 사용한다.
- 게시글 생성은 사용자당 10분 5회, 24시간 30회로 제한한다.
- 댓글·대댓글 생성은 사용자당 10분 20회, 24시간 200회로 제한한다.
- 신고는 사용자당 24시간 10회로 제한한다.
- 제한값은 DB 설정 테이블에서 운영자가 조정하되 일반 클라이언트는 읽거나 수정할 수 없다.
- 클라이언트는 글·댓글 생성 시 idempotency key를 전송하고 DB가 중복 생성을 막는다.
- 동일 사용자가 정규화된 동일 본문을 10분 안에 반복 등록하지 못하게 한다.
- 신고 수만으로 자동 숨김하거나 영구 삭제하지 않는다. 모든 숨김과 최종 처리는 관리자가 수행한다.
- 신고·숨김·복구·잠금·강제 삭제는 감사 로그를 남긴다.
- 개인정보 처리방침에 GitHub OAuth 프로필, 사용자 콘텐츠, 신고 기록, 보존·삭제 정책을 추가한다.

초기 운영자는 최소 인원으로 제한한다. 관리자 추가·삭제는 migration 또는 별도 보호된 운영 절차로 수행하고 일반 관리자 UI에서 역할을 부여하지 않는다.

## 9. 검색·정렬·성능

- 검색은 Postgres full-text search를 사용한다.
- 제목과 본문에서 검색하되 제목 일치에 더 높은 가중치를 둔다.
- 공개·비숨김 데이터만 검색 결과에 포함한다.
- 목록은 offset이 아니라 안정적인 cursor pagination을 우선한다.
- 전체 후보 수가 5,000개를 넘더라도 목록을 중단하지 않는다. cursor와 정렬 인덱스로 요청한 page 범위만 조회한다.
- 최신순 cursor는 `(created_at, id)` 내림차순을 사용한다.
- 댓글순은 `(공개 댓글 수, created_at, id)`, 인기순은 최근 30일의 `(좋아요 수 × 2 + 댓글 수, created_at, id)` 내림차순을 사용한다. cursor에는 해당 정렬 키 전체를 포함한다.
- 정렬용 좋아요·댓글 수는 매 요청마다 전체 집계하지 않는다. 트리거나 안전한 비동기 집계로 counter를 유지하되 원본 reaction·comment가 진실의 원장이다.
- 공개 목록 쿼리, 태그 필터, 작성자별 조회, 신고 대기열에 필요한 인덱스를 migration에 명시한다.
- 목록과 상세 쿼리는 필요한 열만 조회하고 body 전체를 목록에서 전송하지 않는다.

## 10. SEO snapshot

커뮤니티의 실시간 UI는 SPA가 제공한다. 검색 엔진과 링크 미리보기를 위해 공개 게시글 snapshot을 정기 생성한다.

- 매시간과 수동 실행 시 GitHub Actions가 공개 게시글을 읽어 `/community/content/<id>/index.html`을 생성한다.
- snapshot은 제목, 요약, 작성자 표시명, canonical URL, Open Graph, 구조화된 데이터와 sanitized 본문을 포함한다.
- snapshot의 `커뮤니티에서 보기` 링크는 `/community/post/?id=<id>`로 연결한다.
- 숨김·삭제된 글은 다음 snapshot 빌드에서 HTML과 sitemap에서 제거한다.
- 새 글과 공유 URL은 `/community/post/?id=<id>`에서 즉시 동작한다. 검색 엔진용 snapshot 반영은 정기 빌드 주기만큼 지연될 수 있음을 운영 문서에 명시한다.
- sitemap과 검색 엔진의 canonical은 snapshot 경로를 사용한다. SPA 상세는 snapshot이 생성되기 전까지 self canonical을 사용하고, 생성 상태를 확인한 뒤 snapshot canonical로 전환한다.
- 공개 게시글이 5,000개를 넘거나 snapshot 빌드가 연속 3회 10분을 넘으면 SSR/ISR 서비스 분리를 재검토한다.

## 11. 오류 처리

- OAuth 실패: 원래 경로와 로컬 초안을 유지하고 재시도 제공
- 세션 만료: 입력 내용을 지우지 않고 재로그인 요청
- 이미지 일부 실패: 게시를 막고 실패 파일만 재시도
- 글 생성 성공·첨부 연결 실패: 운영자가 확인 가능한 상태로 기록하고 재연결 작업 수행
- 중복 제출: 동일 idempotency key의 기존 결과 반환
- 권한 오류: 일반 오류와 구분되는 한국어 안내
- Supabase 장애: 커뮤니티 전용 장애 화면 표시, Jekyll 블로그는 정상 제공
- 삭제·숨김·잠금 race: mutation 시 최신 상태와 소유권을 transaction 안에서 재검증
- 네트워크 응답 전에 성공 UI를 확정하지 않는다. optimistic UI는 안전하게 되돌릴 수 있는 좋아요에만 제한한다.

## 12. 관측성과 백업

- 프런트엔드 오류와 주요 API 실패율을 수집하되 Markdown 본문과 OAuth token은 로그에 기록하지 않는다.
- Edge Function은 request ID, 결과 코드, 처리 시간만 구조화해 기록한다.
- 신고 대기 수, pending 첨부 수, 고아 이미지 정리 실패를 운영 지표로 둔다.
- production DB는 매일 암호화된 논리 백업을 생성하고 30일 보관한다. Storage 객체 목록과 메타데이터도 같은 주기로 백업한다.
- 복구 절차를 분기마다 staging에서 실제 연습하고 결과를 운영 기록으로 남긴다.
- Supabase 요금제와 보존 정책은 프로젝트 생성 시점의 공식 조건을 확인하고 결정한다. 무료 한도를 영구 운영 전제로 삼지 않는다.

## 13. 테스트 전략

### 단위·컴포넌트

- Markdown 렌더링과 XSS fixture
- 작성 validation
- 정렬·필터 URL 상태
- 세션 만료와 로컬 초안 복구
- 업로드 상태 전이
- 접근성 검사

### DB·RLS

최소 다음 행위자를 분리해 테스트한다.

- anon
- 사용자 A
- 사용자 B
- admin

각 행위자에 대해 posts, comments, reactions, attachments, reports, roles, audit logs의 읽기·쓰기·수정·삭제 허용과 거부를 검증한다. 특히 사용자 A가 사용자 B의 글, 첨부, 신고, 역할을 조작하지 못하는지 확인한다.

### 통합·E2E

- GitHub OAuth callback과 원래 경로 복귀
- 글 작성, 이미지 업로드, 상세 조회
- 댓글과 대댓글
- 좋아요 중복 방지
- 수정과 소프트 삭제
- 신고와 관리자 처리
- 글 잠금
- 모바일·데스크톱
- 새로고침과 브라우저 뒤로가기
- Supabase 오류와 네트워크 재시도

OAuth E2E는 production GitHub 계정을 공유하지 않고 staging 전용 OAuth App과 테스트 계정을 사용한다.

### 기존 블로그 회귀

- Jekyll 전체 빌드
- `/`, `/blog/`, `/lab/`, 대표 포스트, sitemap, robots, 404 확인
- 기존 permalink 변화 검사
- 커뮤니티 추가 전후 주요 HTML 제목과 canonical 비교
- `git diff --check`

## 14. 배포와 롤백

현재 Actions 전환 결과를 기준선으로 삼고 커뮤니티 통합은 별도 배포 브랜치에서 검증한다.

1. 최신 `master`의 Jekyll-only Actions artifact를 기준선으로 저장한다.
2. 커뮤니티 통합 artifact와 기존 사이트 주요 URL·정적 asset을 비교한다.
3. staging Supabase로 커뮤니티 smoke test를 수행한다.
4. 단일 통합 artifact를 staging에서 검증한다.
5. production 승인 후 배포하고 smoke test를 수행한다.

롤백은 이전 정상 Pages artifact를 재배포한다. 필요하면 커뮤니티 조립 단계를 비활성화해 Jekyll-only Actions artifact로 복귀한다. DB migration은 초기에는 additive change만 허용한다. destructive migration은 백업·복구 검증과 별도 승인 없이는 실행하지 않는다.

## 15. 수용 기준

다음 조건을 모두 충족해야 초기 릴리스가 완료된 것으로 본다.

1. 비로그인 사용자가 공개 글과 댓글을 볼 수 있다.
2. GitHub 로그인 사용자가 Markdown 글과 허용 이미지를 게시할 수 있다.
3. 작성자가 자신의 글을 수정·소프트 삭제할 수 있고 다른 사용자의 글은 수정할 수 없다.
4. 로그인 사용자가 댓글과 한 단계 대댓글을 작성할 수 있다.
5. 좋아요가 사용자·대상당 한 번만 기록된다.
6. 검색, 태그, 최신순·인기순·댓글순과 cursor pagination이 동작한다.
7. 신고, 숨김, 복구, 잠금과 감사 로그가 동작한다.
8. raw HTML, script URL, SVG 위장, MIME 위장, 초과 크기 이미지가 차단된다.
9. anon·사용자 간·관리자 RLS 테스트가 모두 통과한다.
10. OAuth 실패와 세션 만료 시 작성 중인 내용이 보존된다.
11. Jekyll 기존 URL과 sitemap 회귀 검사가 통과한다.
12. `/community/`와 `/community/content/<id>/` 대표 snapshot에 title, canonical, Open Graph가 존재한다.
13. staging E2E와 production smoke test가 통과한다.
14. 롤백과 DB·Storage 복구 절차가 문서화되고 staging에서 실행 증거를 남긴다.
15. 개인정보 처리방침이 사용자 콘텐츠와 GitHub OAuth 데이터 처리를 반영한다.

## 16. 구현 순서

1. Pages Actions 전환을 별도 검증하고 기존 사이트 회귀 기준선 확보
2. Supabase 프로젝트, migration, GitHub OAuth, RLS 테스트 구성
3. 커뮤니티 read-only 목록·상세와 공통 UI 구성
4. 로그인·작성·Markdown·이미지 업로드
5. 댓글·대댓글·좋아요
6. 검색·태그·정렬·pagination
7. 신고·관리자 대기열·잠금·감사 로그
8. SEO snapshot과 sitemap
9. 개인정보 처리방침, 운영·백업·롤백 문서
10. staging 전체 E2E, 보안 검토, production 배포와 smoke test

각 단계는 독립적으로 테스트 가능해야 하며, production 데이터 쓰기는 RLS와 적대적 테스트가 통과한 뒤에만 활성화한다.
