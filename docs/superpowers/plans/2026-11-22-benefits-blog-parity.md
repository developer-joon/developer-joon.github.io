# Benefits Blog Parity Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Benefits의 primary 탐색을 `기업 검색`·`조사 기준`으로 축소하고, 검색 화면과 공통 shell을 Blog와 같은 밝은 편집형 디자인으로 전환하며, `PGRST202`를 명시적인 데이터 준비 상태로 표시한다.

**Architecture:** 기존 RPC repository, 검색 state machine, legacy route dispatch는 유지한다. 공통 `BenefitsExplorerShell`의 navigation과 markup을 최소 변경하고 CSS override가 아닌 기존 dark rules를 정리해 밝은 surface를 만든다. 오류 분류는 repository의 기존 `configuration` code를 page-level presentation으로만 변환한다.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, Vite, Jekyll Docker assembly, Node verifier

**Design:** `docs/superpowers/specs/2026-11-22-benefits-blog-parity-design.md`

---

### Task 1: Primary navigation을 두 항목으로 축소

**Objective:** 모든 Benefits public shell에서 `기업 검색`과 `조사 기준`만 primary navigation에 표시하고 legacy routes는 계속 렌더링한다.

**Files:**
- Modify: `community-app/src/components/benefits/BenefitsExplorerShell.tsx`
- Modify: `community-app/src/App.benefits.test.tsx`
- Modify: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Write failing tests**

`App.benefits.test.tsx`의 shell test를 다음 계약으로 변경한다.

```tsx
expect(screen.getAllByRole('link', { name: '기업 검색' })).toHaveLength(1)
expect(screen.getByRole('link', { name: '기업 검색' })).toHaveAttribute('href', '/benefits/')
expect(screen.getByRole('link', { name: '조사 기준' })).toHaveAttribute('href', '/community/benefits/methodology/?q=예시')
expect(screen.queryByRole('link', { name: '복지 현황' })).not.toBeInTheDocument()
expect(screen.queryByRole('link', { name: '조건 탐색' })).not.toBeInTheDocument()
```

별도 route test에서 `/community/benefits/`와 `/community/benefits/fit/`가 계속 `BenefitsExplorerPage`로 dispatch되는 기존 기대를 유지한다.

**Step 2: Run test to verify failure**

Run:

```bash
cd community-app
npm test -- --run src/App.benefits.test.tsx
```

Expected: FAIL — 기존 4개 tab label이 렌더링된다.

**Step 3: Implement minimal navigation**

`BenefitsExplorerShell.tsx`에서 primary navigation source를 다음 두 항목으로 제한한다.

```tsx
const primaryTabs = [
  { key: 'directory', label: '기업 검색', href: '/benefits/' },
  { key: 'methodology', label: '조사 기준', href: '/community/benefits/methodology/' },
] as const
```

- `query`는 methodology link에만 기존 방식으로 보존한다.
- `route === 'directory'`이면 기업 검색에 `aria-current="page"`를 설정한다.
- `route === 'methodology'`이면 조사 기준에 설정한다.
- legacy `heatmap`, `fit`, `company`에서는 primary current item을 거짓으로 표시하지 않는다.
- legacy route component와 `benefitsRoutes.ts`는 삭제하거나 redirect하지 않는다.

**Step 4: Run focused tests**

Run:

```bash
cd community-app
npm test -- --run src/App.benefits.test.tsx src/styles/siteIntegration.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add community-app/src/components/benefits/BenefitsExplorerShell.tsx community-app/src/App.benefits.test.tsx community-app/src/styles/siteIntegration.test.ts
git commit -m "refactor: simplify benefits primary navigation"
```

---

### Task 2: 조사 기준에서 legacy 분석 자료를 보조 링크로 보존

**Objective:** 제거된 primary tab의 deep link를 조사 기준 페이지에서 명확한 보조 영역으로 제공한다.

**Files:**
- Modify: `community-app/src/pages/BenefitsMethodologyPage.tsx`
- Create or Modify: `community-app/src/pages/BenefitsMethodologyPage.test.tsx`

**Step 1: Write failing test**

방법론 artifact가 로드된 상태에서 다음을 검증한다.

```tsx
expect(await screen.findByRole('heading', { level: 3, name: '기존 분석 자료' })).toBeVisible()
expect(screen.getByRole('link', { name: '복지 현황' })).toHaveAttribute('href', '/community/benefits/')
expect(screen.getByRole('link', { name: '조건 탐색' })).toHaveAttribute('href', '/community/benefits/fit/')
```

해당 링크가 `.benefits-tabs` 내부에 있지 않음도 검증한다.

**Step 2: Run test to verify failure**

```bash
cd community-app
npm test -- --run src/pages/BenefitsMethodologyPage.test.tsx
```

Expected: FAIL — `기존 분석 자료` 영역이 없다.

**Step 3: Implement minimal secondary section**

`BenefitsMethodologyPage.tsx`의 방법론 본문 뒤, 정정 요청 전에 다음 semantic section을 추가한다.

```tsx
<section className="benefits-legacy-links" aria-labelledby="legacy-analysis-title">
  <h3 id="legacy-analysis-title">기존 분석 자료</h3>
  <p>이전 정적 조사 결과를 확인할 수 있습니다.</p>
  <ul>
    <li><a href="/community/benefits/">복지 현황</a></li>
    <li><a href="/community/benefits/fit/">조건 탐색</a></li>
  </ul>
</section>
```

**Step 4: Run test to verify pass**

```bash
cd community-app
npm test -- --run src/pages/BenefitsMethodologyPage.test.tsx src/App.benefits.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add community-app/src/pages/BenefitsMethodologyPage.tsx community-app/src/pages/BenefitsMethodologyPage.test.tsx
git commit -m "feat: preserve benefits legacy analysis links"
```

---

### Task 3: `PGRST202` configuration 오류를 준비 중 UX로 분리

**Objective:** 운영 RPC 부재를 빈 결과나 일반적인 검색 실패가 아닌 재시도 가능한 준비 중 상태로 표시한다.

**Files:**
- Modify: `community-app/src/pages/BenefitsDirectoryPage.tsx`
- Modify: `community-app/src/pages/BenefitsDirectoryPage.test.tsx`

**Step 1: Write failing test**

기존 `Result` contract를 사용해 configuration 오류를 반환한다.

```tsx
const configurationFailure: Result<BenefitDirectoryPage> = {
  ok: false,
  error: { code: 'configuration', message: '서비스 설정을 확인할 수 없습니다.' },
}
```

다음을 검증한다.

```tsx
expect(await screen.findByRole('alert')).toHaveTextContent('기업 데이터를 준비하고 있습니다')
expect(screen.getByRole('alert')).toHaveTextContent('잠시 후 다시 확인해 주세요')
expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible()
expect(screen.queryByText('서비스 설정을 확인할 수 없습니다.')).not.toBeInTheDocument()
expect(screen.queryByText('조건에 맞는 기업을 찾지 못했습니다')).not.toBeInTheDocument()
```

재시도 click이 repository search를 한 번 더 호출하는지도 검증한다.

**Step 2: Run test to verify failure**

```bash
cd community-app
npm test -- --run src/pages/BenefitsDirectoryPage.test.tsx
```

Expected: FAIL — repository의 일반 configuration message가 그대로 표시된다.

**Step 3: Implement presentation mapping**

page component에서 error code를 기준으로 안전한 사용자 문구를 선택한다.

```tsx
const isPreparingData = error?.code === 'configuration'
const errorMessage = isPreparingData
  ? '기업 데이터를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.'
  : error?.message
```

- repository code, RPC 이름, endpoint, project ref를 UI에 포함하지 않는다.
- 기존 `role="alert"`, retry button, stale result 보존 동작을 유지한다.
- empty state 조건에는 손대지 않는다.

**Step 4: Run test to verify pass**

```bash
cd community-app
npm test -- --run src/pages/BenefitsDirectoryPage.test.tsx src/data/benefitDirectoryRepository.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add community-app/src/pages/BenefitsDirectoryPage.tsx community-app/src/pages/BenefitsDirectoryPage.test.tsx
git commit -m "fix: distinguish benefits data preparation state"
```

---

### Task 4: 공통 shell을 Blog editorial surface로 전환

**Objective:** dark Atlas dashboard 인상을 제거하고 hero, workspace, tabs를 Blog와 동일한 밝은 편집형 구조로 만든다.

**Files:**
- Modify: `community-app/src/styles/benefits.css`
- Modify: `community-app/src/styles/siteIntegration.test.ts`
- Reference: `_sass/_includes/_listing.scss`
- Reference: `blog/index.html`
- Reference: `community-app/src/styles/tokens.css`

**Step 1: Write failing CSS contract tests**

`siteIntegration.test.ts`에서 source CSS를 파싱해 최소한 다음을 검증한다.

- `.benefits-page` 배경과 본문 색이 밝은 token/surface다.
- `.benefits-workspace` 최대 폭이 1100px 이하이고 mobile gutter가 존재한다.
- `.benefit-atlas-hero`는 Atlas SVG를 배경으로 사용하지만 전체 page dark background를 만들지 않는다.
- `.benefits-tabs`에 정확한 밝은 surface와 얇은 border가 있다.
- desktop/mobile에서 tab link 최소 높이가 44px 이상이다.
- `#07111f`, `#0a1625`, `#102238`, `#071426` 같은 기존 page-level dark surface가 shell rules에 남지 않는다.

**Step 2: Run test to verify failure**

```bash
cd community-app
npm test -- --run src/styles/siteIntegration.test.ts
```

Expected: FAIL — dark shell contract가 남아 있다.

**Step 3: Replace dark shell rules**

`benefits.css`의 base shell 영역을 정리한다.

- body/page: Blog 계열의 밝은 배경과 본문색
- hero: `benefit-atlas.svg` + 밝은/반투명 overlay, dark full-page 확장 금지
- workspace: `width: min(calc(100% - 40px), 1100px)` 계열
- tabs: 흰색 또는 Blog surface, 1px border, underline/current border
- cards/filters: 큰 radius와 teal glow를 제거하고 1px border와 제한된 shadow 사용
- focus-visible과 44px target 유지
- 500/680/900/1100px breakpoints 또는 동등한 `min()`/`clamp()` width 계약 사용

**Step 4: Run focused contracts**

```bash
cd community-app
npm test -- --run src/styles/siteIntegration.test.ts src/App.benefits.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add community-app/src/styles/benefits.css community-app/src/styles/siteIntegration.test.ts
git commit -m "style: align benefits shell with blog"
```

---

### Task 5: 검색·결과·상세 화면의 편집형 위계 완성

**Objective:** 검색 UI와 결과 cards, company detail이 공통 밝은 shell 안에서 같은 Blog editorial hierarchy를 사용하게 한다.

**Files:**
- Modify: `community-app/src/styles/benefits.css`
- Modify: `community-app/src/styles/siteIntegration.test.ts`
- Verify: `community-app/src/pages/BenefitsDirectoryPage.test.tsx`
- Verify: `community-app/src/pages/BenefitDirectoryCompanyPage.test.tsx`

**Step 1: Write failing style tests**

다음 selector 계약을 검증한다.

- `.domestic-directory__search input`: 밝은 background, readable foreground, 44px 이상
- `.domestic-directory__record`: background/border hierarchy, overflow wrapping
- `.domestic-directory__identity` → `h3` → metadata → status/badges 순서가 DOM test에서 유지됨
- `.domestic-directory__error`와 준비 중 alert가 밝은 surface에서 충분히 구분됨
- `.benefit-company-page`: 1100px 이하 폭, 밝은 surface, mobile 20px 수준 gutter
- mobile에서 검색은 항상 보이고 `.domestic-directory__filter-details`만 접힐 수 있음

**Step 2: Run tests to verify failure**

```bash
cd community-app
npm test -- --run src/styles/siteIntegration.test.ts src/pages/BenefitsDirectoryPage.test.tsx src/pages/BenefitDirectoryCompanyPage.test.tsx
```

Expected: 새 editorial style assertions가 FAIL.

**Step 3: Implement minimal style changes**

- 기존 search state machine과 markup을 불필요하게 변경하지 않는다.
- 결과 record를 별도 SaaS card grid가 아니라 Blog 목록과 같은 편집형 record로 만든다.
- zero-evidence 문구, public fields, trust tier, href contract는 유지한다.
- mobile filter disclosure의 기존 resize/reopen 계약을 유지한다.
- company detail의 public projection 및 submission CTA를 유지한다.

**Step 4: Run focused tests**

```bash
cd community-app
npm test -- --run src/styles/siteIntegration.test.ts src/pages/BenefitsDirectoryPage.test.tsx src/pages/BenefitDirectoryCompanyPage.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add community-app/src/styles/benefits.css community-app/src/styles/siteIntegration.test.ts
git commit -m "style: refine benefits editorial records"
```

---

### Task 6: 전체 정적·React 검증

**Objective:** 변경이 navigation, accessibility, route compatibility, build artifact를 깨뜨리지 않았음을 검증한다.

**Files:**
- Modify only if tests expose a regression: affected source/test files

**Step 1: Run frontend quality gate**

```bash
cd community-app
npm run check
npm run build
```

Expected: typecheck, lint, tests, build 모두 exit 0.

**Step 2: Run root verifier tests**

```bash
node --test scripts/verify-site.test.mjs
```

Expected: exit 0.

**Step 3: Build assembled site**

```bash
./scripts/build-site-docker.sh "$TMPDIR/benefits-blog-parity-site"
node scripts/verify-site.mjs "$TMPDIR/benefits-blog-parity-site"
```

Expected: Docker assembly와 verifier 모두 exit 0.

**Step 4: Inspect exact assembled contracts**

프로그램으로 다음을 확인한다.

- assembled root header의 `/benefits/` label이 `Benefits`
- `/benefits/index.html` canonical과 Vite entry 존재
- legacy `/community/benefits/`, `/community/benefits/fit/`, methodology artifacts 존재
- compiled assets에 `기업 검색`, `조사 기준`, 준비 중 문구 포함
- primary shell source에는 legacy labels가 primary array로 남지 않음

**Step 5: Commit any verification-driven corrections**

```bash
git add <only-corrected-files>
git commit -m "test: verify benefits blog parity integration"
```

수정이 없으면 빈 commit을 만들지 않는다.

---

### Task 7: 브라우저 시각 QA와 release state 기록

**Objective:** desktop/mobile에서 Blog parity와 상호작용을 실제 assembled artifact로 검증하고, 운영 데이터 복구가 별도 blocker임을 유지한다.

**Files:**
- Modify: `docs/operations/evidence/benefits-supabase-directory-verification.md` only after evidence is produced
- Evidence output: `$TMPDIR/benefits-blog-parity-site`

**Step 1: Serve only for requested visual verification**

assembled site를 ephemeral local server로 띄우고 테스트 종료 후 반드시 중지한다. 사용자가 명시하지 않은 장기 dev server는 실행하지 않는다.

**Step 2: Verify desktop and mobile**

검증 항목:

- `/blog/`와 `/benefits/`가 같은 밝은 surface, header spacing, content width 계열을 사용함
- primary nav가 `기업 검색`, `조사 기준` 두 개뿐임
- 검색 input은 mobile에서도 항상 노출됨
- 세부 필터는 mobile에서 접고 다시 열 수 있음
- error, empty, ready fixture에서 layout shift나 dark page residue가 없음
- keyboard focus와 44px target 유지

**Step 3: Stop server and verify no port remains**

server process를 종료하고 사용한 local port가 listening 상태가 아님을 확인한다.

**Step 4: Record honest release state**

- UI 검증 완료와 production data readiness를 구분한다.
- 운영 RPC가 여전히 `PGRST202`라면 release state를 `NO-GO`로 유지한다.
- migration/seed/read-back을 실행하지 않았다면 40,053개가 운영에 노출된다고 기록하지 않는다.

**Step 5: Commit evidence only if updated**

```bash
git add docs/operations/evidence/benefits-supabase-directory-verification.md
git commit -m "docs: record benefits blog parity verification"
```
