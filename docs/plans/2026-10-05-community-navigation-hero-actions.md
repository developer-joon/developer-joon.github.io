# Community Navigation, Hero, and Listing Actions Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Stabilize Community navigation geometry across Jekyll and React routes, add the approved editorial hero copy, and move the write action into the post-list heading.

**Architecture:** Mirror the Jekyll header's outer-header/inner-wrap/menu-list hierarchy inside `AppHeader`, while retaining React-managed mobile accessibility behavior. Keep account controls in `CommunityActions` and place a normal authenticated-route link beside list sorting controls. Express responsive geometry in `community.css` and lock it with component and source-level integration tests.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Vite, Jekyll/Docker release scripts

---

### Task 1: Lock the new structure and copy with failing tests

**Objective:** Add regression tests that define the approved header hierarchy, hero copy, action separation, and listing-level write link before changing production code.

**Files:**
- Modify: `community-app/src/components/AppHeader.test.tsx`
- Modify: `community-app/src/pages/CommunityHomePage.test.tsx`
- Modify: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Write failing tests**

Add assertions that:

- `AppHeader` contains a `community-header__wrap` and `global-navigation__list`.
- Home has exactly one H1 with `Where ideas connect` and supporting text `질문과 경험이 이어지는 자유로운 공간입니다.`.
- The account action region has no `글쓰기` link.
- The list-heading control group contains the sorting controls and `/community/write/` link.
- CSS contains `scrollbar-gutter: stable`, Jekyll-equivalent mobile menu padding, and a stable active-link rule that does not alter geometry.

**Step 2: Run tests to verify failure**

Run:

```bash
cd community-app
npm run test -- --run src/components/AppHeader.test.tsx src/pages/CommunityHomePage.test.tsx src/styles/siteIntegration.test.ts
```

Expected: FAIL because the new wrappers, copy, write-link location, and CSS contracts do not exist.

**Step 3: Commit the RED tests only if repository convention permits**

Do not commit a deliberately failing tree. Keep the verified RED changes for Task 2.

---

### Task 2: Implement stable header and mobile navigation geometry

**Objective:** Match the Jekyll header hierarchy and menu spacing while preserving accessible React interactions.

**Files:**
- Modify: `community-app/src/components/AppHeader.tsx`
- Modify: `community-app/src/styles/global.css`
- Modify: `community-app/src/styles/community.css`
- Test: `community-app/src/components/AppHeader.test.tsx`
- Test: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Implement the minimal markup**

- Wrap the brand, toggle, and navigation in `community-header__wrap`.
- Add a semantic list carrying `global-navigation__list` inside the existing labelled `nav`.
- Keep the same links, `aria-current`, close handler, refs, and focus-management lifecycle.

**Step 2: Implement the minimal CSS**

- Move responsive max-width and horizontal gutters from the outer header to `community-header__wrap`.
- Make the outer header full width with Jekyll-equivalent top margins.
- Position the desktop menu at `right: 20px` relative to the inner wrap.
- Match mobile list padding to Jekyll: `20px` below 768px and centered `40px 0 0`/70% width from 768px through 1023px.
- Add `scrollbar-gutter: stable` to the document root.
- Ensure active/current state changes color only.

**Step 3: Run focused tests**

```bash
cd community-app
npm run test -- --run src/components/AppHeader.test.tsx src/styles/siteIntegration.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add community-app/src/components/AppHeader.tsx community-app/src/styles/global.css community-app/src/styles/community.css community-app/src/components/AppHeader.test.tsx community-app/src/styles/siteIntegration.test.ts
git commit -m "fix: stabilize community navigation geometry"
```

---

### Task 3: Add editorial hero copy and relocate the write action

**Objective:** Give the hero Blog-like two-line hierarchy and move content creation beside list sorting controls.

**Files:**
- Modify: `community-app/src/components/CommunityActions.tsx`
- Modify: `community-app/src/pages/CommunityHomePage.tsx`
- Modify: `community-app/src/styles/community.css`
- Test: `community-app/src/pages/CommunityHomePage.test.tsx`
- Test: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Implement the minimal component changes**

- Remove the `/community/write/` link from `CommunityActions`.
- Replace the hero H1 with `Where ideas connect`.
- Add the Korean supporting paragraph.
- Add a `listing-actions` group beside `커뮤니티 글` containing existing `SortTabs` followed by the `글쓰기` link.

**Step 2: Implement responsive styles**

- Match Blog hero paragraph color, margin, size, line-height, and wrapping behavior.
- Keep desktop heading and controls in one row.
- At widths below 1024px, stack the heading over a full-width control row with sorting left and write right.
- Allow narrow wrapping without horizontal overflow and keep a usable write touch target.

**Step 3: Run focused tests**

```bash
cd community-app
npm run test -- --run src/pages/CommunityHomePage.test.tsx src/styles/siteIntegration.test.ts
```

Expected: PASS with public reads, filtering, sorting, and the single-H1 contract preserved.

**Step 4: Commit**

```bash
git add community-app/src/components/CommunityActions.tsx community-app/src/pages/CommunityHomePage.tsx community-app/src/styles/community.css community-app/src/pages/CommunityHomePage.test.tsx community-app/src/styles/siteIntegration.test.ts
git commit -m "feat: refine community hero and listing actions"
```

---

### Task 4: Verify integration and visual behavior

**Objective:** Prove the finished layout works in source, build artifacts, and a real browser engine.

**Files:**
- No production files unless verification exposes a defect.

**Step 1: Run all application checks**

```bash
cd community-app
npm run check
npm run build
```

Expected: 35 test files pass, TypeScript and ESLint succeed, and Vite builds successfully.

**Step 2: Run root release checks**

```bash
node --test --test-concurrency=1 scripts/*.test.mjs
git diff --check
```

Expected: all script tests pass and no whitespace errors.

**Step 3: Build the deployable artifact**

```bash
ARTIFACT="$TMPDIR/community-navigation-site"
scripts/build-site-docker.sh "$ARTIFACT"
node scripts/verify-site.mjs "$ARTIFACT"
```

Expected: verifier passes, all six Community shells exist, the network SVG exists, and no secret or source-only files leak.

**Step 4: Browser verification**

Use Lightpanda or an available Chromium-compatible browser against the assembled artifact at 390px, 768px, and 1440px. Verify:

- Brand and menu anchors remain fixed between routes.
- Mobile overlay spacing matches Jekyll.
- Hero contains one English H1 and one Korean paragraph.
- Account row contains no write action.
- Listing controls contain the write action with no horizontal overflow.
- Search, tags, sorting, public post list, and stale-session recovery remain functional.

**Step 5: Independent review**

Request separate spec-compliance and code-quality/accessibility reviews. Address findings, rerun all affected checks, and commit any fixes before release.
