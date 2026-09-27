# Breadlab Community Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 기존 Jekyll 블로그에 GitHub OAuth 기반의 운영 가능한 한국어 커뮤니티를 `/community/` 경로로 추가한다.

**Architecture:** 기존 Jekyll 소스는 유지하고 `community-app/`을 React 19 + TypeScript + Vite MPA로 분리한다. 브라우저는 publishable key로 Supabase에 연결하지만 보호된 mutation은 `security definer` RPC가 `auth.uid()`와 상태를 재검증한다. GitHub Pages 배포 시 Jekyll 산출물과 Vite 산출물·SEO snapshot을 하나의 artifact로 합친다.

**Tech Stack:** Node 24, React 19.3, TypeScript 6.0, Vite 8.3, Vitest 5, Testing Library, Supabase JS 2.117, Supabase CLI 2.118/Postgres 17/pgTAP, Marked + DOMPurify, Playwright, Jekyll 4.4.1

**Design Direction:** 밝은 종이색과 짙은 잉크색을 기반으로 한 “개발자용 편집 매거진형 커뮤니티”. 기존 Breadlab의 파란색은 CTA와 상태에 제한하고, 흔한 dark SaaS 카드 스택보다 읽기 흐름·목록 위계·한국어 Markdown 가독성을 우선한다.

---

## Delivery rules

- 실제 Supabase URL과 publishable key는 `community-app/.env.local`에만 두고 커밋하지 않는다.
- `sb_secret_*`, service role, DB 비밀번호, GitHub OAuth secret은 브라우저·저장소·로그에 넣지 않는다.
- 사용자 쓰기 흐름은 직접 테이블 mutation보다 제한된 RPC를 사용한다. actor/owner/author는 입력값이 아니라 `auth.uid()`로 결정한다.
- 각 코드 작업은 RED → GREEN → 전체 회귀 검사 → 독립 명세 리뷰 → 품질 리뷰 순서로 끝낸다.
- GitHub Pages source 전환, 원격 migration 적용, Edge Function 배포, production push는 로컬 검증과 사용자 승인 전에는 실행하지 않는다.

### Task 1: React/Vite MPA 기반과 환경설정

**Objective:** 실제 Pages 경로를 생성하는 테스트 가능한 커뮤니티 앱 기반을 만든다.

**Files:**
- Create: `community-app/package.json`, `community-app/package-lock.json`
- Create: `community-app/vite.config.ts`, `community-app/vitest.config.ts`, `community-app/tsconfig*.json`
- Create: `community-app/index.html`, `community-app/write/index.html`, `community-app/post/index.html`, `community-app/edit/index.html`, `community-app/admin/reports/index.html`, `community-app/auth/callback/index.html`
- Create: `community-app/src/main.tsx`, `community-app/src/App.tsx`, `community-app/src/config/env.ts`, `community-app/src/test/setup.ts`
- Create: `community-app/src/config/env.test.ts`, `community-app/src/App.test.tsx`
- Create: `community-app/.env.example` with blank `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
- Modify: `.gitignore`

**Steps:**
1. `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY` 누락, 잘못된 URL, secret key 거부와 `/community/` shell 렌더링 테스트를 작성한다.
2. `npm test -- --run`으로 모듈 부재 RED를 확인한다.
3. Vite `base: '/community/'`, MPA inputs, Zod 환경 검증, React root와 한국어 오류 화면을 최소 구현한다.
4. `.env*`는 무시하고 `.env.example`만 추적하며 실제 값은 `.env.local`에 둔다.
5. `npm run check`와 `find dist -name index.html` 대체 Node 검증 스크립트로 모든 shell 생성을 확인한다.
6. Commit: `chore: scaffold community application`.

### Task 2: Supabase 로컬 프로젝트와 핵심 스키마

**Objective:** 로컬에서 반복 적용 가능한 Postgres 17 schema와 seed를 만든다.

**Files:**
- Create: `supabase/config.toml`, `supabase/seed.sql`
- Create: `supabase/migrations/202609260001_core_schema.sql`
- Create: `supabase/tests/database/core_schema.test.sql`
- Modify: `community-app/package.json`

**Steps:**
1. profiles, roles, posts, comments, tags, post_tags, post/comment reactions, attachments, reports, moderation audit, idempotency/rate-limit 테이블의 구조·constraint pgTAP RED를 작성한다.
2. `npx supabase start` 후 `npx supabase test db`에서 RED를 확인한다.
3. UUID, UTC timestamptz, 길이, enum/check, FK, unique, 인덱스와 5개 초기 태그를 migration에 구현한다.
4. `npx supabase db reset`, `npx supabase test db`, `npx supabase db lint --level error`를 통과시킨다.
5. Commit: `feat: add community database schema`.

### Task 3: RLS와 mutation RPC 경계

**Objective:** anon/member/다른 사용자/admin 권한과 보호 필드 불변성을 DB에서 강제한다.

**Files:**
- Create: `supabase/migrations/202609260002_rls_and_rpcs.sql`
- Create: `supabase/tests/database/rls.test.sql`
- Create: `supabase/tests/database/mutations.test.sql`

**Steps:**
1. anon·user A·user B·admin JWT context fixture를 만들고 읽기/쓰기 허용·거부 RED를 작성한다.
2. 모든 public table RLS, 최소 grant/revoke, `is_admin()`, create/update/soft-delete post/comment, toggle reaction, create report RPC를 구현한다.
3. RPC는 `set search_path`, 고정 owner, 상태 재검증, idempotency, rate limit, 1단계 대댓글, 최대 3태그, hidden/deleted 대상 reaction 금지를 강제한다.
4. user_roles/audit_logs 일반 쓰기와 다른 사용자의 글·신고·첨부 조작이 실패하는지 pgTAP으로 검증한다.
5. Commit: `feat: enforce community row level security`.

### Task 4: Storage bucket과 안전한 첨부 lifecycle

**Objective:** 5MB JPEG/PNG/WebP만 사용자 소유 경로로 업로드·연결하게 한다.

**Files:**
- Create: `supabase/migrations/202609260003_storage.sql`
- Create: `supabase/tests/database/storage.test.sql`
- Create: `supabase/functions/validate-upload/index.ts`, `supabase/functions/validate-upload/index.test.ts`
- Create: `supabase/functions/cleanup-attachments/index.ts`

**Steps:**
1. bucket 제한, `${auth.uid()}/${uuid}` 경로, 타 사용자 object 차단, pending→attached 전이 테스트를 RED로 작성한다.
2. private `community-images` bucket, storage policies, attachment RPC와 signature/size 검증 Edge Function을 구현한다.
3. SVG·HTML·MIME 위장·초과 크기·6번째 이미지와 24시간 고아 파일을 검증한다.
4. DB/Edge Function 테스트와 lint를 통과시킨다.
5. Commit: `feat: secure community image uploads`.

### Task 5: 생성 타입·Supabase client·repository

**Objective:** UI가 DB 세부 구현에 직접 결합하지 않도록 typed repository를 만든다.

**Files:**
- Create: `community-app/src/types/database.ts`, `community-app/src/types/community.ts`
- Create: `community-app/src/lib/supabase.ts`
- Create: `community-app/src/data/communityRepository.ts`
- Create: `community-app/src/data/communityRepository.test.ts`

**Steps:**
1. 목록·상세·태그·mutation 오류 mapping 계약 테스트를 RED로 작성한다.
2. `supabase gen types typescript --local` 생성 타입과 단일 browser client를 연결한다.
3. 필요한 열만 선택하고 RPC를 호출하며 PostgREST/Auth 오류를 안정적인 한국어 domain error로 변환한다.
4. 테스트·typecheck·lint를 통과시킨다.
5. Commit: `feat: add typed community data client`.

### Task 5A: OAuth 프로필 자동 provision

**Objective:** GitHub OAuth로 생성된 신규 사용자가 첫 요청부터 보호된 mutation을 사용할 수 있게 한다.

**Files:**
- Create: `supabase/migrations/202609260005_profile_provisioning.sql`
- Create: `supabase/migrations/202609270002_trusted_github_profile_provisioning.sql`
- Modify: `supabase/tests/0005_profile_provisioning.test.sql`

**Steps:**
1. 신뢰 가능한 `auth.identities.provider_id`의 GitHub numeric ID와 provider 생성 `identity_data`를 사용한 생성·갱신, 잘못된 provider와 필수 metadata 거부 pgTAP RED를 작성한다.
2. 기존의 안전하지 않은 `auth.users.raw_user_meta_data` trigger를 제거하고 `auth.identities` insert/update trigger가 `public.profiles`를 transaction 안에서 idempotent하게 provision하도록 forward migration을 작성한다.
3. 직접 `raw_user_meta_data` 변경은 프로필을 생성·변경하지 못하고, trusted identity 갱신만 presentation metadata를 refresh하며, 선택 metadata의 blank/invalid 값은 null로 degrade함을 검증한다.
4. identity 재바인딩·충돌 방지, non-GitHub 무시, 양의 numeric ID 검증, browser profile write 거부, 기존 수동 fixture를 포함해 DB 전체 테스트·lint를 통과시킨다.
5. Commit: `fix: trust GitHub identity records for profiles`.

### Task 5B: 공개 이미지 전달 경계

**Objective:** private bucket을 유지하면서 공개 게시글에 연결된 정상 이미지만 익명 독자에게 전달한다.

**Files:**
- Create: `supabase/functions/public-attachment/index.ts`
- Create: `supabase/functions/public-attachment/index.test.ts`
- Modify: `supabase/config.toml`
- Modify: `community-app/src/data/communityRepository.ts`

**Steps:**
1. published+attached만 200, hidden/deleted/pending/quarantined/잘못된 UUID는 거부하는 Edge Function RED를 작성한다.
2. service role로 attachment와 post 상태를 필요한 열만 조회한 뒤 Storage object를 stream하고 MIME·크기·짧은 cache header를 고정한다.
3. 본문에는 raw storage path나 service credential을 노출하지 않고 attachment ID 기반 URL만 사용한다.
4. Deno 테스트와 DB/프런트 회귀 검사를 통과시킨다.
5. Commit: `fix: serve public community attachments safely`.

### Task 5C: 삭제 글 tombstone read model

**Objective:** 댓글이 남은 삭제 글을 본문·작성자 개인정보 없이 안전한 tombstone으로 읽게 한다.

**Files:**
- Create: `supabase/migrations/202609260006_post_tombstones.sql`
- Modify: `supabase/tests/database/public_post_read_model.test.sql`
- Modify: `community-app/src/types/community.ts`
- Modify: `community-app/src/data/communityRepository.ts`
- Modify: `community-app/src/data/communityRepository.test.ts`

**Steps:**
1. missing/hidden/deleted-with-comments/deleted-without-comments 상태 계약 RED를 작성한다.
2. read RPC가 허용된 tombstone에 상태와 최소 메타데이터만 반환하고 원문·작성자 정보는 반환하지 않도록 구현한다.
3. repository가 `not_found`, `hidden`, `deleted`를 구분하도록 타입과 mapping을 갱신한다.
4. DB·프런트 전체 검사를 통과시킨다.
5. Commit: `fix: add safe deleted-post tombstones`.

### Task 5D: 무제한 cursor 목록

**Objective:** 공개 게시글이 5,000개를 넘어도 목록이 중단되지 않게 한다.

**Files:**
- Create: `supabase/migrations/202609260007_unbounded_public_listing.sql`
- Modify: `supabase/tests/database/public_post_read_model.test.sql`

**Steps:**
1. 5,001개 이상 fixture에서 첫 page와 다음 cursor가 성공하는 RED를 작성한다.
2. 전체 후보 count와 SQLSTATE `54000` hard fail을 제거하고 기존 cursor·정렬 계약을 유지한다.
3. `EXPLAIN` fixture로 최신순·태그 필터가 의도한 인덱스 경로를 사용할 수 있는지 확인한다.
4. DB 전체 테스트·lint를 통과시킨다.
5. Commit: `fix: keep public post pagination available at scale`.

### Task 6: 공통 app shell과 read-only 목록

**Objective:** 비로그인 사용자가 검색·태그·정렬·cursor 상태가 보존되는 게시글 목록을 사용하게 한다.

**Files:**
- Create: `community-app/src/components/{AppHeader,SearchBar,TagFilter,SortTabs,PostList,PostCard,StatePanel}.tsx`
- Create: `community-app/src/pages/CommunityHomePage.tsx`
- Create: `community-app/src/lib/queryState.ts`
- Create: corresponding `*.test.tsx`
- Create: `community-app/src/styles/{tokens,global,community}.css`

**Steps:**
1. URL query parse/serialize, loading/error/empty, 공지 우선, 카드 의미 구조 테스트를 RED로 작성한다.
2. 편집 매거진형 반응형 shell과 목록을 구현한다.
3. 키보드 focus, accessible labels, 390px/desktop overflow를 컴포넌트 테스트로 확인한다.
4. `npm run check` 후 실제 local Supabase seed로 목록 smoke를 수행한다.
5. Commit: `feat: add community post listing`.

### Task 7: Markdown renderer와 게시글 상세

**Objective:** 안전하게 정제된 본문과 댓글 영역을 공개한다.

**Files:**
- Create: `community-app/src/lib/markdown.ts`, `community-app/src/lib/markdown.test.ts`
- Create: `community-app/src/pages/PostDetailPage.tsx`
- Create: `community-app/src/components/{MarkdownContent,PostMeta,ReactionButton,CommentList}.tsx`
- Create: corresponding tests

**Steps:**
1. raw HTML, script/data URL, event handler, SVG fixture 차단과 코드/링크 허용 RED를 작성한다.
2. Marked는 raw HTML을 허용하지 않는 설정으로 파싱하고 DOMPurify allowlist로 재정제한다.
3. UUID query validation, not-found/hidden/deleted/locked/detail 상태를 구현한다.
4. 테스트와 접근성 검사를 통과시킨다.
5. Commit: `feat: add safe community post detail`.

### Task 8: GitHub OAuth와 세션 복귀

**Objective:** 작성 중 상태를 잃지 않고 GitHub 로그인·로그아웃·callback을 처리한다.

**Files:**
- Create: `community-app/src/auth/AuthProvider.tsx`, `community-app/src/auth/auth.ts`
- Create: `community-app/src/pages/AuthCallbackPage.tsx`
- Create: `community-app/src/auth/*.test.tsx`
- Create: `docs/operations/community-oauth-setup.md`

**Steps:**
1. 안전한 same-origin return path, 외부 redirect 거부, callback 오류, 세션 만료 테스트를 RED로 작성한다.
2. `signInWithOAuth({provider:'github'})`, `/community/auth/callback/`, session subscription과 로그인 UI를 구현한다.
3. 정확한 설정값을 문서화한다: GitHub callback `https://<project-ref>.supabase.co/auth/v1/callback`, production/local Supabase redirect allowlist.
4. provider 비활성 상태를 친절한 한국어 오류로 표시한다.
5. Commit: `feat: add GitHub community sign in`.

### Task 9: 글 작성·수정·로컬 초안

**Objective:** 로그인 사용자가 Markdown 글과 최대 3개 태그를 작성·수정·소프트 삭제한다.

**Files:**
- Create: `community-app/src/pages/{WritePostPage,EditPostPage}.tsx`
- Create: `community-app/src/components/{PostEditor,MarkdownPreview,TagSelector,DraftNotice}.tsx`
- Create: `community-app/src/lib/{validation,draftStore}.ts`
- Create: corresponding tests

**Steps:**
1. 제목 2~120, 본문 1~50,000, 태그 1~3, 초안 버전/복구, 중복 제출 테스트를 RED로 작성한다.
2. localStorage 초안, 미리보기, RPC create/update/delete, 제출 잠금과 실패 복구를 구현한다.
3. 다른 작성자 수정·외부 return path·세션 만료를 UI/DB 양쪽에서 거부한다.
4. 테스트와 실제 local E2E를 통과시킨다.
5. Commit: `feat: add community post editor`.

### Task 10: 이미지 업로드 UX

**Objective:** 게시 전에 이미지 검증·업로드·재시도·본문 삽입·연결을 안전하게 제공한다.

**Files:**
- Create: `community-app/src/components/ImageUploader.tsx`
- Create: `community-app/src/data/uploadRepository.ts`
- Create: `community-app/src/lib/imageValidation.ts`
- Create: corresponding tests

**Steps:**
1. 허용 형식/크기/개수, 취소, 일부 실패 재시도, 성공 전 게시 차단 테스트를 RED로 작성한다.
2. 무작위 storage path와 pending attachment 생성, 진행 상태, Markdown URL 삽입, 게시 성공 후 attach RPC를 구현한다.
3. object URL 누수와 실패한 pending attachment cleanup을 검증한다.
4. Commit: `feat: add community image uploads`.

### Task 11: 댓글·대댓글·반응

**Objective:** 한 단계 댓글 트리와 안전하게 rollback 가능한 좋아요를 제공한다.

**Files:**
- Create: `community-app/src/components/{CommentComposer,CommentThread,ReplyComposer}.tsx`
- Modify: `community-app/src/pages/PostDetailPage.tsx`
- Create: corresponding tests

**Steps:**
1. 로그인 요구, 1~5,000자, 잠긴 글, 대댓글의 대댓글 거부, reaction 중복·rollback 테스트를 RED로 작성한다.
2. 댓글 RPC와 optimistic reaction을 구현하되 서버 실패 시 원상 복구한다.
3. 숨김·삭제 댓글 placeholder와 counter 정합성을 검증한다.
4. Commit: `feat: add community discussion interactions`.

### Task 12: 신고와 관리자 운영

**Objective:** 신고 queue, 숨김·복구·잠금·공지 고정과 불변 감사 로그를 제공한다.

**Files:**
- Create: `supabase/migrations/202609260005_moderation.sql`
- Create: `supabase/tests/database/moderation.test.sql`
- Create: `community-app/src/pages/AdminReportsPage.tsx`
- Create: `community-app/src/components/{ReportDialog,ReportQueue,ModerationActions}.tsx`
- Create: corresponding tests

**Steps:**
1. 일반 사용자 admin RPC 거부, 중복 open 신고, 상태 전이와 audit row 생성 RED를 작성한다.
2. 제한된 moderation RPC와 관리자 UI를 구현한다.
3. 관리자 판정은 client flag가 아니라 DB의 `is_admin()` 결과를 사용한다.
4. pgTAP·UI 테스트를 통과시킨다.
5. Commit: `feat: add community moderation workflow`.

### Task 13: Jekyll 통합·개인정보·단일 artifact 빌드

**Objective:** 기존 사이트 회귀 없이 메뉴와 커뮤니티 artifact를 결합한다.

**Files:**
- Modify: `_data/settings.yml`, `_pages/privacy.md`, `README.md`, `.gitignore`
- Create: `scripts/build-site.sh`, `scripts/verify-site.mjs`
- Create: `Dockerfile.build` or pinned Docker build script
- Modify: `.github/workflows/jekyll.yml`

**Steps:**
1. 최신 `origin/master`를 반영하고 기존 주요 URL/title/canonical과 6개 community shell 존재를 검사하는 실패 검증을 작성한다.
2. Jekyll build 후 `community-app/dist`를 `_site/community/`로 복사하고 CNAME/404/sitemap을 검증하며 `community-app`·`supabase` 소스가 artifact에 포함되지 않게 한다.
3. 기존 `.github/workflows/jekyll.yml`에 Node 설치·프런트 검사·Vite build·단일 artifact 조립 단계를 추가한다. 별도의 Pages deploy workflow는 만들지 않는다.
4. Docker에서 전체 build를 재현하고 artifact에 symlink나 비공개 소스가 없는지 확인한다.
5. Commit: `build: assemble community pages artifact`.

### Task 14: SEO snapshot과 sitemap

**Objective:** 공개 게시글의 정제된 정적 HTML·OG·canonical을 매시간 재생성한다.

**Files:**
- Create: `scripts/community-snapshots.mts`, `scripts/community-snapshots.test.ts`
- Create: `.github/workflows/community-snapshots.yml`
- Modify: `scripts/build-site.sh`, sitemap generation inputs

**Steps:**
1. published만 포함, hidden/deleted 제거, HTML 정제, canonical/OG/JSON-LD/sitemap 테스트를 RED로 작성한다.
2. `/community/content/<id>/index.html`과 SPA 링크를 생성한다.
3. secret key 없이 공개 read view만 사용하고 실제 콘텐츠 본문을 로그에 남기지 않는다.
4. fixture와 staging API 모두에서 snapshot build를 검증한다.
5. Commit: `feat: generate community search snapshots`.

### Task 15: 운영·백업·롤백 문서와 release gate

**Objective:** 배포 전 필요한 증거와 실패 복구 절차를 한 명령으로 검증한다.

**Files:**
- Create: `docs/operations/community-{runbook,backup-restore,rollback,release-checklist}.md`
- Create: `scripts/community-release-check.sh`
- Modify: root `README.md`, `community-app/package.json`

**Steps:**
1. release check가 env 누락, DB/RLS 실패, frontend 실패, Jekyll 회귀, snapshot 실패를 hard fail하는 테스트를 작성한다.
2. `npm run release:check` 또는 script 하나로 DB tests, app test/lint/typecheck/build, Jekyll artifact, E2E를 실행한다.
3. 매일 암호화 backup/30일 보관, Storage inventory, 분기 staging 복구 연습, 이전 Pages artifact·legacy source rollback을 문서화한다.
4. Commit: `docs: add community operations runbook`.

### Task 16: 실제 staging 검증과 보안·UI 독립 리뷰

**Objective:** 원격 staging과 브라우저에서 수용 기준을 검증하되 production write는 하지 않는다.

**Files:**
- Create: `community-app/e2e/community.spec.ts`
- Create: `artifacts/community-staging-verification.json` only if repository policy allows generated evidence; otherwise keep under ignored local verification directory.

**Steps:**
1. 로컬 Supabase 전체 reset/test/lint 후 migration diff가 비어 있는지 확인한다.
2. 관리자 인증은 CLI browser login 또는 로컬 shell secret으로만 수행하고 원격 migration을 staging에 적용한다.
3. GitHub provider/redirect가 설정된 뒤 익명 읽기, OAuth, 작성, 이미지, 댓글, 반응, 신고, 관리, 잠금을 E2E로 검증한다.
4. 390px와 desktop 스크린샷으로 hierarchy·clipping·Korean font·focus를 검토하고 dev server/ports를 종료한다.
5. 독립 보안 리뷰에서 Critical/Important 0건이 될 때까지 수정하고 전체 release check를 다시 실행한다.
6. production 배포 전 사용자 승인 지점에서 중단한다.
7. Commit: `test: verify community staging release`.

---

## Final acceptance command set

```bash
npx supabase db reset
npx supabase test db
npx supabase db lint --level error
npm --prefix community-app ci
npm --prefix community-app run check
npm --prefix community-app run build
./scripts/build-site.sh
node scripts/verify-site.mjs _site
npm --prefix community-app run e2e
./scripts/community-release-check.sh
```

Expected: 모든 명령 exit 0, pgTAP failure 0, Vitest failure 0, TypeScript/ESLint error 0, Jekyll/Vite build 성공, 여섯 community shell과 기존 주요 URL 존재, browser E2E 수용 흐름 통과, 잔여 dev server/port 없음.
