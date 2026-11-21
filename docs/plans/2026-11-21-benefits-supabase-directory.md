# 기업 복지 Supabase 동적 디렉터리 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 현재 40,053개 국내 검색 ID를 Supabase에서 검색하고, 검수된 공식 혜택과 사용자 제보를 단순한 목록·상세 화면에서 조회하며, 로그인 사용자의 제보와 관리자 승인을 안전하게 운영한다.

**Architecture:** 기존 검증 artifact는 공식 정보의 권위 원본으로 유지하고, deterministic importer가 Supabase read model을 갱신한다. 공개 브라우저는 원본 table이 아니라 bounded RPC만 호출한다. 사용자 제출·감사 event·공개 publication을 분리하고 관리자 승인 transaction이 `community_reviewed` publication과 audit event를 함께 만든다.

**Tech Stack:** PostgreSQL/Supabase migrations·RLS·`SECURITY DEFINER` RPC, pgTAP, React 19, TypeScript 6, Supabase JS 2, Zod 4, Vitest 5, Node 24 scripts, Jekyll/Vite release gate.

---

## 공통 구현 규칙

- 작업 경로: `/home/bread/.hermes/profiles/conan/worktrees/developer-joon.github.io/benefits-supabase-directory`
- 브랜치: `feat/benefits-supabase-directory`
- 기존 40,053개 정적 artifact와 검증기는 삭제하지 않는다.
- 사용자에게 보이는 혜택 수는 활성 publication 수이며 evidence·research row 수가 아니다.
- 공개 projection에는 source URL, source type 원문, 확인 시각, submitter/reviewer ID를 넣지 않는다.
- `KR-CRN-*`, `KR-BIZ-*` 등 기존 ID를 수정하거나 이름으로 합치지 않는다.
- 각 코드 task는 RED test → 최소 구현 → targeted test → commit 순서로 수행한다.

### Task 1: 공개 read model 스키마와 검색 RPC

**Objective:** 40,053개 검색 ID와 활성 혜택을 저장하고 공개 목록·상세를 bounded RPC로만 읽게 한다.

**Files:**
- Create: `supabase/migrations/202611210001_benefit_directory_read_model.sql`
- Create: `supabase/tests/database/benefit_directory_read_model.test.sql`
- Modify: `community-app/src/types/database.ts`

**Step 1: RED pgTAP 작성**

다음을 검증한다.

```sql
select has_table('public', 'benefit_companies');
select has_table('public', 'benefit_publications');
select function_privs_are(
  'public', 'search_benefit_companies_v1',
  array['text','text[]','text','text','boolean','integer','text','text'],
  'anon', array['EXECUTE']
);
select throws_ok(
  $$select * from public.benefit_companies limit 1$$,
  '42501'
);
```

검색 fixture는 혜택 0개 기업, 공식 1개 기업, 사용자 제보 1개 기업, withdrawn publication을 포함한다. `has_benefits_only=true`가 활성 publication이 있는 두 기업만 반환하고, count가 evidence가 아니라 publication 기준인지 검증한다.

**Step 2: RED 확인**

Run: `npm run db:reset && npm run db:test`

Expected: 새 table/RPC가 없어 pgTAP 실패.

**Step 3: 최소 스키마 구현**

- `benefit_companies`: canonical text PK, identity class, display/normalized name, industry/size/region, summary, searchable flag, source edition, private provenance JSONB, timestamps.
- `benefit_publications`: UUID PK, company FK, category, title/description, eligibility/condition, trust tier, status, dedupe key, revision, private source fields, review/import binding.
- `(company_id, dedupe_key, revision)` unique 및 한 publication lineage의 active revision 하나만 허용하는 partial unique index.
- 원본 table RLS 활성화 후 public/anon/authenticated 권한 전부 revoke.
- `search_benefit_companies_v1`은 query/category/industry/size/has-benefits/cursor/page-size를 검증하고 최대 50개만 반환.
- `get_benefit_company_v1`은 공개 기업 필드와 active publication만 반환.
- 공개 JSON key를 SQL에서 명시하고 private 열을 절대 병합하지 않는다.

RPC 반환 shape 예시:

```json
{
  "items": [{
    "company_id": "KR-CRN-1234567890123",
    "display_name": "예시기업",
    "identity_label": "법인",
    "industry": null,
    "size_label": "분류 미확인",
    "region": null,
    "summary": null,
    "benefit_count": 1,
    "official_count": 1,
    "community_count": 0,
    "categories": ["health"]
  }],
  "has_more": false,
  "next_cursor": null,
  "total": 1
}
```

**Step 4: GREEN 확인**

Run: `npm run db:reset && npm run db:test`

Expected: read model tests 포함 전체 pgTAP PASS.

**Step 5: 타입 갱신과 커밋**

Run: `supabase gen types typescript --local > community-app/src/types/database.ts`

```bash
git add supabase/migrations/202611210001_benefit_directory_read_model.sql supabase/tests/database/benefit_directory_read_model.test.sql community-app/src/types/database.ts
git commit -m "feat: add benefits directory read model"
```

### Task 2: 사용자 제보·감사·승인 transaction

**Objective:** 출처 URL이 선택인 새 혜택 제보를 기존 정정 workflow와 분리하고 승인 시 즉시 사용자 제보 publication을 만든다.

**Files:**
- Create: `supabase/migrations/202611210002_benefit_submissions.sql`
- Create: `supabase/tests/database/benefit_submissions.test.sql`
- Create: `supabase/tests/database/zz_benefit_submissions_concurrency.test.sql`
- Modify: `community-app/src/types/database.ts`

**Step 1: RED pgTAP 작성**

- direct table read/write 거부
- 로그인 사용자만 `create_benefit_submission_v1` 실행
- source URL `null` 제출 성공
- owner는 자기 제출만 조회
- 다른 사용자의 제출·상태 조회 거부
- client key 재사용+다른 payload 거부
- 시간당 rate limit
- `submitted → reviewing → approved|rejected` CAS
- forged admin metadata 거부, `user_roles`만 인정
- 승인 시 publication과 append-only event가 함께 생성
- concurrent approve는 하나만 성공
- 승인 실패 시 publication 0건과 상태 원복

**Step 2: RED 확인**

Run: `npm run db:reset && npm run db:test`

Expected: submission table/RPC 부재로 실패.

**Step 3: migration 구현**

- `benefit_submissions`, `benefit_submission_events`, rate event table 생성.
- immutable 제출 payload와 append-only event trigger 추가.
- source URL은 `null` 또는 strict credential-free HTTPS만 허용.
- `create_benefit_submission_v1`, `list_my_benefit_submissions_v1`, `list_benefit_submission_queue_v1`, `list_benefit_submission_audit_v1`, `review_benefit_submission_v1` 구현.
- 승인 action은 `community_reviewed` publication 생성과 audit event를 같은 transaction에서 수행.
- 공개 publication description은 검토된 관리자 projection을 사용하고 제출 원문을 그대로 HTML로 실행하지 않는다.

**Step 4: GREEN·동시성 확인**

Run: `npm run db:reset && npm run db:test`

Expected: ownership, CAS, concurrency와 rollback test PASS.

**Step 5: 타입 갱신과 커밋**

Run: `supabase gen types typescript --local > community-app/src/types/database.ts`

```bash
git add supabase/migrations/202611210002_benefit_submissions.sql supabase/tests/database/benefit_submissions.test.sql supabase/tests/database/zz_benefit_submissions_concurrency.test.sql community-app/src/types/database.ts
git commit -m "feat: add moderated benefit submissions"
```

### Task 3: 40,053개 deterministic import bundle

**Objective:** 기존 해시 검증 artifact를 40,053개 Supabase company seed bundle로 변환하고 drift를 fail-closed한다.

**Files:**
- Create: `scripts/generate-benefit-directory-seed.mjs`
- Create: `scripts/generate-benefit-directory-seed.test.mjs`
- Create: `scripts/apply-benefit-directory-seed.mjs`
- Create: `docs/operations/benefit-directory-seed-import.md`
- Create (generated): `supabase/fixtures/benefit-directory/manifest.json`
- Create (generated): `supabase/fixtures/benefit-directory/companies.ndjson`
- Modify: `.gitignore` only if transient restricted files need exclusion
- Modify: `community-app/package.json`

**Step 1: RED generator tests**

Fixture와 real artifact에 대해 다음을 검증한다.

```js
assert.equal(manifest.company_count, 40053)
assert.equal(new Set(rows.map(row => row.company_id)).size, 40053)
assert.deepEqual(manifest.identity_counts, {
  base_legal_identity: 1000,
  recruitment_observation: 35910,
  ftc_affiliate: 3143,
})
```

삭제된 행, 바뀐 source digest, 중복 ID, 이름 없는 행, identity class 변경, symlink 입력을 거부한다.

**Step 2: RED 확인**

Run: `node --test scripts/generate-benefit-directory-seed.test.mjs`

Expected: generator가 없어 실패.

**Step 3: generator 구현**

- 기존 `verify-domestic-search-index.mjs`와 같은 pinned artifact를 읽는다.
- 원시 provenance는 DB private field용 최소 digest/binding만 생성한다.
- 이름·region·size 필드를 bounded 정규화하되 ID·표시명은 임의 보정하지 않는다.
- NDJSON은 `company_id` 정렬, manifest는 bytes/hash/count를 기록한다.
- `--check`는 재생성 결과와 tracked bundle을 byte compare한다.

**Step 4: apply script 구현**

- `DATABASE_URL`과 `psql`을 사용하며 값을 로그에 출력하지 않는다.
- manifest/hash/count를 먼저 검증한다.
- mode 0700 임시 directory와 mode 0600 TSV를 만들고 symlink를 거부한다.
- transaction 안에서 staging `COPY`, exact set 검증, canonical upsert, import receipt 기록을 수행한다.
- `--dry-run`은 rollback하고 count만 출력한다.
- research-only 항목은 publication으로 적재하지 않는다.

**Step 5: 실제 bundle 생성·검증**

Run:

```bash
node scripts/generate-benefit-directory-seed.mjs
node scripts/generate-benefit-directory-seed.mjs --check
node --test scripts/generate-benefit-directory-seed.test.mjs
```

Expected: exact 40,053 IDs, deterministic bytes, mutation tests PASS.

**Step 6: 커밋**

```bash
git add scripts/generate-benefit-directory-seed.mjs scripts/generate-benefit-directory-seed.test.mjs scripts/apply-benefit-directory-seed.mjs docs/operations/benefit-directory-seed-import.md supabase/fixtures/benefit-directory community-app/package.json .gitignore
git commit -m "feat: generate benefits directory seed"
```

### Task 4: 공개 Supabase repository와 strict decoder

**Objective:** 공개 RPC를 auth session 없이 호출하고 private field가 섞인 응답을 거부한다.

**Files:**
- Create: `community-app/src/types/benefitDirectory.ts`
- Create: `community-app/src/data/benefitDirectoryRepository.ts`
- Create: `community-app/src/data/benefitDirectoryRepository.test.ts`
- Modify: `community-app/src/lib/supabase.ts`

**Step 1: RED tests**

- exact-key search/detail response decode
- 50개 초과, 잘못된 enum/cursor/count 거부
- `source_url`, `verified_at`, `submitter_id`, 미지 key가 포함되면 거부
- AbortSignal 전달
- network/auth/timeout error를 한국어 public error로 mapping
- anonymous client가 session persistence를 사용하지 않음

**Step 2: RED 확인**

Run: `npm test -- --run src/data/benefitDirectoryRepository.test.ts`

Expected: module 부재로 실패.

**Step 3: 구현**

Repository interface:

```ts
export interface BenefitDirectoryRepository {
  search(input: BenefitDirectorySearchInput, signal?: AbortSignal): Promise<Result<BenefitDirectoryPage>>
  detail(companyId: string, signal?: AbortSignal): Promise<Result<BenefitCompanyDetail>>
}
```

- `getAnonymousSupabaseClient()`만 사용.
- 기존 repository와 같은 `hasExactKeys` 기반 decoder로 공개 projection을 검증.
- cursor는 opaque string으로 처리하고 클라이언트가 해석하지 않는다.

**Step 4: GREEN 확인·커밋**

Run: `npm test -- --run src/data/benefitDirectoryRepository.test.ts && npm run typecheck`

```bash
git add community-app/src/types/benefitDirectory.ts community-app/src/data/benefitDirectoryRepository.ts community-app/src/data/benefitDirectoryRepository.test.ts community-app/src/lib/supabase.ts
git commit -m "feat: add dynamic benefits repository"
```

### Task 5: 동적 검색 화면과 URL 상태

**Objective:** 정적 8MB 일괄 로드를 서버 검색·cursor pagination으로 교체하고 이전 성공 결과를 오류 시 보존한다.

**Files:**
- Modify: `community-app/src/pages/BenefitsDirectoryPage.tsx`
- Modify: `community-app/src/pages/BenefitsDirectoryPage.test.tsx`
- Create: `community-app/src/lib/benefitDirectoryQueryState.ts`
- Create: `community-app/src/lib/benefitDirectoryQueryState.test.ts`
- Modify: `community-app/src/styles/benefits.css`

**Step 1: RED component tests**

- 기업명 입력 debounce, typing은 `replaceState`
- category/업종/규모/혜택 있음 toggle은 `pushState`
- 이전 요청 abort와 out-of-order 응답 무시
- 후속 요청 실패 시 기존 카드 유지+재시도 표시
- 첫 요청 실패와 0건 상태 분리
- `hasBenefitsOnly`가 RPC input으로 전달
- 최대 50개 카드와 cursor 다음 page
- 공개 카드에 출처 URL·날짜가 없음

**Step 2: RED 확인**

Run: `npm test -- --run src/pages/BenefitsDirectoryPage.test.tsx src/lib/benefitDirectoryQueryState.test.ts`

Expected: 새 server-query 계약 불일치로 실패.

**Step 3: 구현**

- `domesticSearchIndexClient.load()`와 `selectDomestic()` 의존을 제거.
- 성공 page, stale page, loading, error를 분리.
- query signature별 generation과 AbortController를 사용.
- 결과 카드에 identity label, 업종·규모·지역, benefit/official/community count, category badge를 표시.
- 혜택 0건은 `게시 가능한 공개 복지 근거 미확인`으로 표시.

**Step 4: GREEN·회귀 확인**

Run: `npm test -- --run src/pages/BenefitsDirectoryPage.test.tsx src/lib/benefitDirectoryQueryState.test.ts`

Expected: 검색·URL·오류 회귀 PASS.

**Step 5: 커밋**

```bash
git add community-app/src/pages/BenefitsDirectoryPage.tsx community-app/src/pages/BenefitsDirectoryPage.test.tsx community-app/src/lib/benefitDirectoryQueryState.ts community-app/src/lib/benefitDirectoryQueryState.test.ts community-app/src/styles/benefits.css
git commit -m "feat: query benefits directory dynamically"
```

### Task 6: 단순한 동적 기업 상세

**Objective:** 검색 가능한 모든 identity의 기업 정보와 활성 publication을 category별로 표시한다.

**Files:**
- Create: `community-app/src/pages/BenefitDirectoryCompanyPage.tsx`
- Create: `community-app/src/pages/BenefitDirectoryCompanyPage.test.tsx`
- Modify: `community-app/src/BenefitsApp.tsx`
- Modify: `community-app/src/benefitsRoutes.ts`
- Modify: `community-app/src/benefitsRoutes.test.ts`
- Modify: `community-app/src/styles/benefits.css`

**Step 1: RED tests**

- canonical ID만 detail RPC에 전달
- 공식/사용자 제보 badge 분리
- description/대상/조건 category grouping
- source URL·확인일 비노출
- 혜택 0건 문구와 제보 CTA
- detail 요청 race/abort/error/retry

**Step 2: RED 확인**

Run: `npm test -- --run src/pages/BenefitDirectoryCompanyPage.test.tsx src/benefitsRoutes.test.ts`

**Step 3: 구현**

- `/benefits/company/?id=...`와 legacy 상세 route를 같은 page로 연결.
- `official_verified → 공식 확인`, `community_reviewed → 사용자 제보`만 표시.
- identity class 설명을 기업 정보에 포함하되 내부 provenance는 포함하지 않는다.

**Step 4: GREEN·커밋**

Run: `npm test -- --run src/pages/BenefitDirectoryCompanyPage.test.tsx src/benefitsRoutes.test.ts && npm run typecheck`

```bash
git add community-app/src/pages/BenefitDirectoryCompanyPage.tsx community-app/src/pages/BenefitDirectoryCompanyPage.test.tsx community-app/src/BenefitsApp.tsx community-app/src/benefitsRoutes.ts community-app/src/benefitsRoutes.test.ts community-app/src/styles/benefits.css
git commit -m "feat: add dynamic benefit company detail"
```

### Task 7: 새 혜택 제보 repository·draft·사용자 화면

**Objective:** 로그인 사용자가 40,053개 검색 대상 중 하나에 출처 없이도 새 혜택을 제보하고 상태를 확인한다.

**Files:**
- Create: `community-app/src/types/benefitSubmissions.ts`
- Create: `community-app/src/data/benefitSubmissionRepository.ts`
- Create: `community-app/src/data/benefitSubmissionRepository.test.ts`
- Create: `community-app/src/lib/benefitSubmissionDraftStore.ts`
- Create: `community-app/src/lib/benefitSubmissionDraftStore.test.ts`
- Create: `community-app/src/pages/BenefitSubmissionPage.tsx`
- Create: `community-app/src/pages/BenefitSubmissionPage.test.tsx`
- Create: `community-app/src/pages/MyBenefitSubmissionsPage.tsx`
- Create: `community-app/src/pages/MyBenefitSubmissionsPage.test.tsx`
- Modify: `community-app/src/App.tsx`
- Modify: `community-app/vite.config.ts`

**Step 1: RED repository/draft/page tests**

- source URL 빈 값 제출 허용
- 기업/category/구체 내용 필수
- 개인정보 금지 안내
- account-scoped draft와 idempotency key OAuth 후 복원
- 성공 응답 후에만 draft 삭제
- actor 전환 시 이전 draft·응답 폐기
- 본인 목록 cursor pagination

**Step 2: RED 확인**

Run: `npm test -- --run src/data/benefitSubmissionRepository.test.ts src/lib/benefitSubmissionDraftStore.test.ts src/pages/BenefitSubmissionPage.test.tsx src/pages/MyBenefitSubmissionsPage.test.tsx`

**Step 3: 구현**

- 기존 correction code를 복사해 의미를 섞지 말고 공통 URL/timestamp helper만 추출.
- 회사 선택은 공개 repository의 bounded 검색을 사용하고 40,053개 option을 DOM에 넣지 않는다.
- 로그인 return path는 canonical same-origin path만 허용.

**Step 4: GREEN·커밋**

Run: targeted tests + `npm run typecheck`.

```bash
git add community-app/src/types/benefitSubmissions.ts community-app/src/data/benefitSubmissionRepository.ts community-app/src/data/benefitSubmissionRepository.test.ts community-app/src/lib/benefitSubmissionDraftStore.ts community-app/src/lib/benefitSubmissionDraftStore.test.ts community-app/src/pages/BenefitSubmissionPage.tsx community-app/src/pages/BenefitSubmissionPage.test.tsx community-app/src/pages/MyBenefitSubmissionsPage.tsx community-app/src/pages/MyBenefitSubmissionsPage.test.tsx community-app/src/App.tsx community-app/vite.config.ts
git commit -m "feat: add benefit submission workflow"
```

### Task 8: 관리자 제보 검수 desk

**Objective:** 관리자가 provenance와 중복 후보를 확인하고 사용자 제보를 승인·반려한다.

**Files:**
- Create: `community-app/src/components/BenefitSubmissionQueue.tsx`
- Create: `community-app/src/components/BenefitSubmissionQueue.test.tsx`
- Create: `community-app/src/pages/AdminBenefitSubmissionsPage.tsx`
- Create: `community-app/src/pages/AdminBenefitSubmissionsPage.test.tsx`
- Modify: `community-app/src/App.tsx`
- Modify: `community-app/vite.config.ts`
- Modify: `community-app/src/styles/community.css`

**Step 1: RED tests**

- 로그인·DB admin 권한 gate
- active/all/status filter와 cursor pagination
- source URL·제출 원문은 관리자만 표시
- 승인 projection 입력 길이·빈 값 검증
- stale expected status 충돌 시 queue refresh
- 중복 클릭은 동일 client key 사용
- 승인 성공 후 public trust tier가 `community_reviewed`
- 승인과 publication 생성 완료 문구

**Step 2: RED 확인**

Run: `npm test -- --run src/components/BenefitSubmissionQueue.test.tsx src/pages/AdminBenefitSubmissionsPage.test.tsx`

**Step 3: 구현**

- 기존 correction admin의 authorization/race/CAS 패턴을 재사용하되 repository와 문구는 분리.
- 승인 UI가 `공식 확인` 승격을 제공하지 않게 한다.
- 출처 없는 제보도 검토 가능하되 사용자 제보 badge를 강제한다.

**Step 4: GREEN·커밋**

```bash
git add community-app/src/components/BenefitSubmissionQueue.tsx community-app/src/components/BenefitSubmissionQueue.test.tsx community-app/src/pages/AdminBenefitSubmissionsPage.tsx community-app/src/pages/AdminBenefitSubmissionsPage.test.tsx community-app/src/App.tsx community-app/vite.config.ts community-app/src/styles/community.css
git commit -m "feat: moderate benefit submissions"
```

### Task 9: `/benefits/` canonical route와 legacy 호환

**Objective:** 블로그에서 바로 접근하는 단순 canonical route를 만들고 기존 Benefit Atlas deep link를 깨지 않는다.

**Files:**
- Create: `community-app/benefits-root/index.html`
- Create: `community-app/benefits-root/company/index.html`
- Modify: `community-app/vite.config.ts`
- Modify: `community-app/src/benefitsRoutes.ts`
- Modify: `community-app/src/application.tsx`
- Modify: `_includes/header.html`
- Modify: `scripts/build-site.sh`
- Modify: `scripts/build-definition.test.mjs`
- Modify: `scripts/verify-site.mjs`
- Modify: `scripts/verify-site.test.mjs`
- Modify: `scripts/community-snapshots.mjs`
- Modify: `scripts/community-snapshots.test.mjs`

**Step 1: RED route/release tests**

- `/benefits/`와 `/benefits/company/`가 public benefits bundle로 dispatch
- 공개 route가 AuthProvider를 mount하지 않음
- legacy `/community/benefits/directory/` query 보존
- assembled site title/canonical/script 검사
- 헤더에서 기업 복지 링크 접근 가능

**Step 2: RED 확인**

Run: `npm test -- --run src/benefitsRoutes.test.ts src/benefitsPublicBoundary.test.ts && node --test scripts/verify-site.test.mjs scripts/community-snapshots.test.mjs`

**Step 3: 구현**

- Vite input `benefitsRoot`와 `benefitsRootCompany`를 추가하되 asset base는 기존 `/community/`를 재사용한다.
- `scripts/build-site.sh`가 Vite build 뒤 `community-app/dist/benefits-root/`의 두 shell을 `_site/benefits/`로 복사하고 `_site/community/benefits-root/` 중복본을 제거하게 한다.
- legacy `/community/benefits/directory/`와 기존 상세 deep link는 query를 보존해 새 canonical route로 이동한다.
- canonical route에서도 auth bundle이 eager load되지 않게 public entry를 유지한다.

**Step 4: GREEN·커밋**

```bash
git add community-app/benefits-root community-app/vite.config.ts community-app/src/benefitsRoutes.ts community-app/src/application.tsx _includes/header.html scripts/build-site.sh scripts/build-definition.test.mjs scripts/verify-site.mjs scripts/verify-site.test.mjs scripts/community-snapshots.mjs scripts/community-snapshots.test.mjs
git commit -m "feat: expose benefits directory from blog"
```

### Task 10: UI 마감·접근성·모바일

**Objective:** 검색 중심의 단순한 SaaS형 UI를 모바일과 키보드에서 완성한다.

**Files:**
- Modify: `community-app/src/styles/benefits.css`
- Modify: `community-app/src/pages/BenefitsDirectoryPage.test.tsx`
- Modify: `community-app/src/pages/BenefitDirectoryCompanyPage.test.tsx`
- Modify: `community-app/src/pages/BenefitSubmissionPage.test.tsx`

**Step 1: RED accessibility assertions**

- 유일한 H1
- 모든 input/select/checkbox의 accessible name
- 결과 count `aria-live`
- 오류 `role=alert`, 빈 결과 `role=status`
- 카드 전체에 중첩 interactive element 없음
- 모바일 filter details와 44px 이상 touch target
- keyboard focus visible

**Step 2: 구현**

- 검색창, category chips, `복지 정보 있는 기업만`을 상단 우선 배치.
- source URL/date disclosure CSS와 DOM 제거.
- 공식/제보 badge를 색상 외 텍스트로 구분.
- 기존 헤더 반응형 계약을 변경하지 않는다.

**Step 3: GREEN·commit**

Run: `npm test -- --run src/pages/BenefitsDirectoryPage.test.tsx src/pages/BenefitDirectoryCompanyPage.test.tsx src/pages/BenefitSubmissionPage.test.tsx`

```bash
git add community-app/src/styles/benefits.css community-app/src/pages/BenefitsDirectoryPage.test.tsx community-app/src/pages/BenefitDirectoryCompanyPage.test.tsx community-app/src/pages/BenefitSubmissionPage.test.tsx
git commit -m "style: simplify benefits discovery experience"
```

### Task 11: release gate와 운영 runbook

**Objective:** DB·seed·브라우저 projection·assembled site를 하나의 fail-closed gate로 검증한다.

**Files:**
- Modify: `scripts/release-gate.mjs`
- Modify: `scripts/release-gate.test.mjs`
- Modify: `docs/operations/community-release-runbook.md`
- Modify: `docs/operations/community-release-checklist.md`
- Create: `scripts/verify-benefit-directory-seed.mjs`
- Create: `scripts/verify-benefit-directory-seed.test.mjs`

**Step 1: RED gate tests**

- seed 행 삭제 후 self-declared count/hash를 다시 써도 거부
- public RPC fixture에 private field가 섞이면 거부
- 40,053 count·exact ID digest 불일치 거부
- `/benefits/` shell 제거·canonical 변조 거부
- hosted mutation 없이 gate가 종료되는지 확인

**Step 2: 구현**

- release gate에 seed `--check`, verifier, frontend check/build, assembled-site verification을 연결.
- production DB apply는 자동 release gate에 넣지 않고 명시적 operator 단계로 둔다.
- runbook에 local reset/import/dry-run, hosted migration/import, smoke query, navigation cutover와 rollback을 분리한다.

**Step 3: GREEN·커밋**

Run: `node --test scripts/verify-benefit-directory-seed.test.mjs scripts/release-gate.test.mjs`

```bash
git add scripts/release-gate.mjs scripts/release-gate.test.mjs scripts/verify-benefit-directory-seed.mjs scripts/verify-benefit-directory-seed.test.mjs docs/operations/community-release-runbook.md docs/operations/community-release-checklist.md
git commit -m "chore: gate dynamic benefits release"
```

### Task 12: 전체 검증과 revision-bound 결과 기록

**Objective:** 구현된 변경을 실제 명령으로 검증하고 원격 변경 없이 handoff한다.

**Files:**
- Create: `docs/operations/evidence/benefits-supabase-directory-verification.md`

**Step 1: 전체 DB 검증**

Run:

```bash
npm run db:reset
npm run db:test:benefit-title-upgrade
npm run db:test
npm run db:lint
```

`db:test:benefit-title-upgrade`는 migration 002 상태의 legacy title과 revision lineage를
003으로 올린 뒤 canonical title/dedupe/supersession/public detail을 검사한다. 이어서
whitespace-only legacy title이 preflight에서 실패하고 migration ledger, row, constraint가
그대로 rollback되는지도 검사한다. Docker 기반 local Supabase가 필요하므로 frontend-only
`npm run check`에는 포함하지 않는다.

Expected: upgrade/rollback fixture, migration, pgTAP, lint PASS.

**Step 2: seed 검증과 local dry-run**

Run:

```bash
node scripts/generate-benefit-directory-seed.mjs --check
node scripts/verify-benefit-directory-seed.mjs
node scripts/apply-benefit-directory-seed.mjs --dry-run
```

Expected: 40,053 unique IDs, identity counts 일치, transaction rollback 성공.

**Step 3: 프런트엔드 전체 검사**

Run from `community-app/`:

```bash
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS.

**Step 4: 정적 artifact·assembled site 검사**

Run from repository root:

```bash
node --test scripts/*.test.mjs
node scripts/release-gate.mjs
```

Expected: revision-bound release gate PASS, hosted mutation/deploy 없음.

**Step 5: 비서버 UI 검증**

사용자가 별도 결과 화면이나 캡처를 요청하지 않았으므로 로컬 HTTP/dev/CDP 서버를 시작하지 않는다. Vitest DOM 회귀, production build, assembled-site verifier와 기존 비서버 browser-contract 검사를 실행한다. 실제 브라우저 시각 QA와 운영 smoke test는 미실행 항목으로 검증 문서에 명시한다.

**Step 6: 결과 기록과 최종 commit**

검증 문서에는 실행 명령, 실제 pass count, seed digest, git SHA, 미실행 hosted migration/deploy를 분리해 기록한다.

```bash
git add docs/operations/evidence/benefits-supabase-directory-verification.md
git commit -m "docs: record benefits directory verification"
git status --short
git log --oneline origin/master..HEAD
```

Expected: clean worktree, 로컬 feature branch만 앞섬. Push, PR, merge, production migration과 배포는 수행하지 않는다.
