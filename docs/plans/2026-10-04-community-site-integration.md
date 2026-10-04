# Community Site Integration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix Community menu navigation and make the standalone community SPA use the same global visual shell as the Jekyll site without putting account identity in the global menu.

**Architecture:** Mark Community as a full-document navigation boundary in Jekyll data/template output. Refactor the React header into a stable site-navigation shell plus a community-only account/action row, then align community tokens and responsive behavior with the existing Jekyll theme.

**Tech Stack:** Jekyll/Liquid, React 19, TypeScript, CSS, Vitest/Testing Library, Node test runner, Docker static-site build, Lightpanda production smoke test.

---

### Task 1: Protect the SPA navigation boundary

**Objective:** Ensure the Jekyll theme never AJAX-loads the standalone community shell.

**Files:**
- Modify: `_data/settings.yml`
- Modify: `_includes/header.html`
- Modify: `scripts/verify-site.mjs`
- Modify: `scripts/verify-site.test.mjs`

**Steps:**
1. Add a failing artifact/verifier test requiring the rendered Community anchor to carry `js-no-ajax`.
2. Run the focused Node test and confirm it fails for the missing class.
3. Add an explicit menu-item setting and render the opt-out class conditionally.
4. Update the artifact verifier to enforce the contract.
5. Run focused and full Node tests; commit the task.

### Task 2: Unify the global shell and move account controls

**Objective:** Keep the site header stable across login states while preserving community authentication actions.

**Files:**
- Modify: `community-app/src/components/AppHeader.tsx`
- Modify: `community-app/src/components/AppHeader.test.tsx`
- Modify: community page/component tests that depend on header labels

**Steps:**
1. Add failing tests for the exact site brand/menu order, active Community state, and absence of identity/login controls inside global navigation.
2. Add failing tests for a separate community action row with login/write or identity/logout/write states and pending/error accessibility.
3. Run focused tests and confirm failures reflect the current separate header.
4. Refactor the component without changing auth APIs or return-path behavior.
5. Run focused tests, typecheck, and lint; commit the task.

### Task 3: Align visual tokens and responsive layout

**Objective:** Make the community look native to the existing white/blue Muli site on desktop and mobile.

**Files:**
- Modify: `community-app/src/styles/base.css`
- Modify: `community-app/src/styles/community.css`
- Modify: relevant component style-contract tests

**Steps:**
1. Add failing style-contract tests for shared color/font/header/content-width behavior and mobile menu handling.
2. Run the focused tests and verify RED.
3. Replace the isolated paper/serif masthead treatment with the existing site tokens and shared-shell dimensions; keep functional community states readable.
4. Run focused tests, all app tests, typecheck, lint, and Vite build.
5. Commit the task.

### Task 4: Build, review, deploy, and verify production

**Objective:** Prove the final artifact and the real homepage-to-community interaction.

**Files:**
- No intended source changes unless a review finds a defect.

**Steps:**
1. Run independent spec and quality reviews; fix all Critical/Important findings.
2. Run the full application and Node suites.
3. Build with the repository Docker helper and verify the exported artifact.
4. Use Lightpanda against the local/final artifact where practical to verify DOM behavior.
5. Push once to `master`, wait for the Pages workflow, and read back the deployed SHA.
6. Use Lightpanda to open the production homepage, click Community, assert the community heading and site navigation exist, and inspect console/network errors.
7. Report tests, artifact, deployment, and remaining warnings separately.
