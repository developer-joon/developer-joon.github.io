# Community Visual Alignment and Auth Recovery Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add an original Blog-sized Community banner, align the Community shell and body typography/spacing with Jekyll, and recover public reads from invalid persisted auth sessions without weakening mutation security.

**Architecture:** Keep the standalone React application and its accessibility lifecycle. Add a local decorative SVG plus Jekyll-equivalent hero/shell CSS, then isolate authenticated public-read recovery at the Supabase client/repository boundary so only reads may retry anonymously. Automatic `signOut` is rejected because Supabase provides no public compare-and-swap for auth storage and an async clear can delete a newer login. Recovery instead guards an AuthContext-only in-memory signed-out transition against the session captured by the request, leaving persisted auth for user-initiated re-login/sign-out to replace or clear. Preserve strict response validation and require an observed failing test before selecting the exact recovery branch.

**Tech Stack:** React 19, TypeScript, Vite, Vitest/Testing Library, Supabase JS/PostgREST, Jekyll/Sass, static SVG.

---

### Task 1: Reproduce authenticated-entry failure

**Objective:** Turn the logged-in entry failure into a deterministic test and classify its actual error path.

**Files:**
- Modify: `community-app/src/auth/AuthProvider.test.tsx`
- Modify: `community-app/src/data/communityRepository.test.ts`
- Modify only if needed: `community-app/src/lib/supabase.ts`
- Test: relevant focused Vitest files

**Steps:**
1. Add a failing test for an initialized authenticated session whose first public listing request receives the observed invalid/expired-session response.
2. Add a separate assertion that malformed successful payloads still return `INVALID_RESPONSE` and never trigger auth recovery.
3. Run the focused tests and confirm the new recovery expectation fails for the intended reason.
4. Record whether the failure is token/session transport or authenticated response shape; do not implement both speculatively.
5. Commit the RED regression test with the subsequent minimal fix in Task 2 rather than leaving the branch failing.

### Task 2: Recover public reads without weakening writes

**Objective:** Keep Community readable when persisted auth is unusable while preserving fail-closed mutations.

**Files:**
- Modify: `community-app/src/lib/supabase.ts`
- Modify: `community-app/src/data/communityRepository.ts`
- Modify: `community-app/src/auth/AuthProvider.tsx`
- Modify: `community-app/src/data/communityRepository.test.ts`
- Modify: `community-app/src/auth/AuthProvider.test.tsx`
- Modify affected page test if the actionable re-login notice belongs there

**Steps:**
1. Introduce the smallest boundary needed for an anonymous public-read client or a one-time read fallback.
2. Classify invalid/expired JWT errors as auth-session failures instead of generic unknown errors.
3. Retry only the failed public read once through the non-persisting anonymous client; never call automatic `signOut` or remove auth storage because there is no public CAS protecting a login completed after the stale request began.
4. Add an explicit AuthContext method that invalidates only the exact request session in memory, making the header offer Google login while retaining persisted auth until user-initiated re-login/sign-out.
5. Return one actionable Google re-login notice while allowing the recovered public content to render, including direct EditPostPage dedupe coverage.
6. Assert a delayed stale response cannot call `signOut`, alter a newly-created session, or cause any mutation to use the anonymous fallback.
7. Assert create/update/delete, reactions, comments, reports, and moderation remain fail-closed.
8. Run focused repository/auth/page tests to GREEN.
9. Commit the follow-up as `fix: avoid stale recovery session race`.

### Task 3: Add the original Community network banner

**Objective:** Add a locally owned decorative banner with Blog-equivalent hero semantics and dimensions.

**Files:**
- Create: `images/community/community-network.svg`
- Modify: `community-app/src/pages/CommunityHomePage.tsx`
- Modify: `community-app/src/styles/community.css`
- Modify: `community-app/src/pages/CommunityHomePage.test.tsx`
- Modify: `community-app/src/styles/siteIntegration.test.ts`

**Steps:**
1. Add failing tests for one `자유게시판` H1, a local network SVG, decorative semantics, and Jekyll hero size/padding contracts.
2. Run focused tests and confirm failure.
3. Create an original dark blue-gray SVG with connected nodes and keep its busy region away from the title.
4. Replace the in-content board heading with a `hero hero--single`-equivalent Community banner containing the only H1.
5. Match Jekyll responsive hero margin, padding, overlay, heading font size, weight, line height, and white text.
6. Run focused tests to GREEN.
7. Commit as `feat: add community network banner`.

### Task 4: Align header, body, and footer geometry

**Objective:** Remove the desktop spacing and typography jump between Jekyll and Community.

**Files:**
- Modify: `community-app/src/components/AppHeader.tsx`
- Modify if necessary: `community-app/src/components/AppFooter.tsx`
- Modify: `community-app/src/styles/community.css`
- Modify: `community-app/src/styles/global.css`
- Modify: `community-app/src/components/AppHeader.test.tsx`
- Modify: `community-app/src/styles/siteIntegration.test.ts`
- Modify: `community-app/src/pages/CommunityHomePage.tsx`

**Steps:**
1. Add failing contract tests for desktop header top margins, brand sizes, menu sizes/gaps, responsive outer widths, and body spacing based on `_sass/_includes/_header.scss`, `_sass/_includes/_hero.scss`, `_sass/_basic.scss`, and settings-generated values.
2. Add a failing assertion that Community home no longer renders `PUBLIC DESK`.
3. Run focused tests and confirm failures.
4. Restructure or style the React shell to match the Jekyll `wrap` geometry without importing the broad Jekyll stylesheet.
5. Move the Community action row below the banner/content boundary so it does not alter global-header rhythm.
6. Align search/list spacing and typography; retain functional controls and accessibility labels.
7. Preserve mobile menu focus trap, Escape, focus restoration, scroll lock, and top-aligned overlay.
8. Run focused tests to GREEN.
9. Commit as `fix: align community shell with site`.

### Task 5: Full local verification and independent review

**Objective:** Prove feature correctness and catch integration regressions before deployment.

**Files:**
- Modify only for discovered defects.

**Steps:**
1. Run `npm run check` from `community-app`; expect all tests, typecheck, and ESLint to pass.
2. Run `npm run build`; expect Vite production build success.
3. Run root script tests serially with `node --test --test-concurrency=1 scripts/*.test.mjs`; expect all pass.
4. Run `git diff --check`; expect no output.
5. Build the static site artifact with the existing Docker script and run `scripts/verify-site.mjs` against it.
6. Run an independent specification-compliance review, then a code-quality/security review; fix all Critical and Important findings.
7. Commit review fixes if any.

### Task 6: Deploy and verify production

**Objective:** Ship one verified artifact and validate anonymous and authenticated-facing behavior on the real site.

**Files:**
- No source changes unless verification exposes a defect.

**Steps:**
1. Confirm active GitHub account, repository identity, clean worktree, and remote branch state.
2. Rebuild the release artifact from the final HEAD and rerun the site verifier.
3. Push the final commits to `master` once.
4. Wait for the corresponding GitHub Pages run and verify its deployed SHA equals local HEAD.
5. Use Lightpanda against the production homepage → Community navigation, Community home, six tag filters, sort modes, search, and post detail.
6. Verify the production DOM contains one `자유게시판` H1, the local network banner asset, aligned shell structure, and no generic request error in anonymous entry.
7. Exercise or simulate the authenticated-entry recovery using the production client contract without exposing credentials; verify public content remains available and re-login guidance is shown for an invalid session.
8. Verify no service-role key or disabled provider implementation appears in the public artifact.
9. Stop local servers and report exact test counts, deployment run, SHA, and any remaining non-blocking limitations.
