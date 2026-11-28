# Kkorinote Service Pages Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Publish four privacy-safe, mobile-readable Kkorinote service pages at the exact extensionless breadlab.ai routes required by the iOS app and App Store.

**Architecture:** Add a standalone Jekyll layout that does not inherit the existing advertising and JavaScript-heavy site shell. Render four Markdown collection pages through one local stylesheet and one shared footer, then bind their exact output paths, metadata, copy, and privacy constraints into the existing assembled-site verifier.

**Tech Stack:** Jekyll 4.4.1, Kramdown, HTML5, CSS with `prefers-color-scheme`, Node.js built-in test runner, repository Docker/static-site build scripts.

---

### Task 1: Bind the four route and privacy contracts in failing verifier tests

**Objective:** Make the release gate fail until all exact Kkorinote routes and privacy constraints exist.

**Files:**
- Modify: `scripts/verify-site.test.mjs`
- Modify: `scripts/verify-site.mjs`

**Step 1: Update the valid fixture shape**

Replace the obsolete `kkorinote/pricacy.html` fixture with these exact documents:

```js
[
  ['kkorinote/index.html', '꼬리노트', 'https://breadlab.ai/kkorinote/'],
  ['kkorinote/privacy/index.html', '꼬리노트 개인정보처리방침', 'https://breadlab.ai/kkorinote/privacy/'],
  ['kkorinote/terms/index.html', '꼬리노트 이용약관', 'https://breadlab.ai/kkorinote/terms/'],
  ['kkorinote/support/index.html', '꼬리노트 지원', 'https://breadlab.ai/kkorinote/support/'],
]
```

Give the fixtures their route-specific required copy, common footer links, public support email, and no external scripts.

**Step 2: Write focused negative tests**

Add separate tests that mutate the fixture and require rejection for:

- each missing route;
- stale `pricacy` path;
- missing canonical/title;
- missing footer link;
- missing route-specific copy;
- analytics, advertising, Facebook, or Giscus scripts;
- `developer.joon@gmail.com`;
- placeholder syntax, `TODO`, or `TBD`.

**Step 3: Run the tests and verify RED**

Run:

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: FAIL because `scripts/verify-site.mjs` still requires only the obsolete privacy route and does not enforce the four-page contract.

**Step 4: Implement the minimal verifier contract**

In `scripts/verify-site.mjs`:

- add all four exact files to `requiredFiles`;
- replace the obsolete metadata tuple with exact title/canonical checks for all four pages;
- inspect only the four Kkorinote HTML documents for forbidden public/private strings and forbidden script sources;
- require common footer markers and route-specific content.

Do not weaken or refactor unrelated Benefits or Community verifier rules. Preserve the pre-existing unstaged Benefits manifest changes as separate working-tree state; stage only Kkorinote hunks for this feature.

**Step 5: Run focused and full verifier tests**

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
node --test scripts/verify-site.test.mjs
```

Expected: all focused tests pass, then the full verifier test file passes with zero failures.

**Step 6: Commit only Kkorinote verifier hunks**

Use an index-only patch or equivalent selective staging so unrelated pre-existing Benefits manifest hunks are excluded.

```bash
git diff --cached --check
git commit -m "test: bind Kkorinote service page contract"
```

### Task 2: Add the standalone no-tracking page shell and responsive styles

**Objective:** Create one coherent, accessible layout that cannot inherit the main site's advertising or tracking code.

**Files:**
- Create: `_layouts/kkorinote.html`
- Create: `_includes/kkorinote-footer.html`
- Create: `css/kkorinote.css`
- Test: `scripts/verify-site.test.mjs`

**Step 1: Add failing source-contract tests**

Require the source layout and CSS to contain:

- `lang="ko"`, viewport, local stylesheet, semantic header/main/footer;
- no script tags or external assets;
- a `720px` content maximum;
- at least `16px` base/mobile text and `16px` mobile side padding;
- safe word wrapping and table overflow;
- `:focus-visible` and `prefers-color-scheme: dark`.

**Step 2: Run focused tests and verify RED**

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: FAIL because the layout, include, and CSS do not exist.

**Step 3: Implement the standalone layout**

The layout must render exact per-page title, description, and canonical URL from front matter. It links only `/css/kkorinote.css`, displays a compact Kkorinote header, wraps `{{ content }}` in one semantic `<main>`, and includes the shared footer.

The footer contains:

```html
© 2026 김준우 · 개인정보처리방침 · 이용약관 · 지원
```

with exact root-relative Kkorinote links.

**Step 4: Implement responsive CSS**

Use a small token set for light/dark colors. Keep the page width bounded, the content readable, links visible, long strings wrappable, and tables independently scrollable. Do not add remote fonts, images, animation, or JavaScript.

**Step 5: Run focused tests and verify GREEN**

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```bash
git add _layouts/kkorinote.html _includes/kkorinote-footer.html css/kkorinote.css scripts/verify-site.test.mjs
git diff --cached --check
git commit -m "feat: add Kkorinote no-tracking page shell"
```

### Task 3: Publish the introduction, terms, and support content

**Objective:** Add complete Korean-first marketing, supplementary terms, and support pages without placeholders or fake App Store links.

**Files:**
- Create: `_pages/kkorinote-index.md`
- Create: `_pages/kkorinote-terms.md`
- Create: `_pages/kkorinote-support.md`

**Step 1: Add source-page tests and verify RED**

Extend the Kkorinote test group to read the three exact Markdown source files and require their layout, permalink, canonical URL, approved public copy, and absence of placeholders or private email.

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: FAIL because the introduction, terms, and support source files do not exist. The host has no Bundler executable, so do not use an ad hoc host Jekyll build; production artifact verification is deferred to the checked-in Docker helper in Task 5.

**Step 2: Add the introduction page**

Use `layout: kkorinote`, `permalink: /kkorinote/`, an exact non-www canonical URL, the approved one-line introduction, four feature items, privacy principle, and a non-interactive `곧 출시` status. Do not leave an icon/screenshot placeholder.

**Step 3: Add the supplementary terms**

Use `permalink: /kkorinote/terms/` and include Apple standard EULA precedence/link, free features and ad placement, non-consumable ad removal/restoration/refund, medical disclaimer, notification limitations, local/iCloud data responsibility, sharing, change notice, support link, and `2026년 11월 28일` effective date.

**Step 4: Add the support page**

Use `permalink: /kkorinote/support/`, a `mailto:kkorinote.support@gmail.com` link, 2–3 business day guidance, safe diagnostic fields, a warning not to send pet health-record contents, and all six required FAQ entries.

**Step 5: Run focused source verification**

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: PASS for the three new source-page contracts; artifact-level rendering remains covered by the synthetic verifier fixture and the final Docker build in Task 5.

**Step 6: Commit**

```bash
git add _pages/kkorinote-index.md _pages/kkorinote-terms.md _pages/kkorinote-support.md
git diff --cached --check
git commit -m "feat: add Kkorinote service content"
```

### Task 4: Correct and finalize the privacy policy

**Objective:** Publish the provided privacy policy unchanged except for the explicitly approved path, operator, date, and email substitutions.

**Files:**
- Modify: `_pages/kkorinote-privacy.md`

**Step 1: Add the focused privacy source contract and verify RED**

Require the privacy source to use the exact layout, permalink, canonical, public operator/date/email values, sections 3 and 7, and common-footer rendering path.

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: FAIL for obsolete `/kkorinote/pricacy`, old date/email, or missing standalone layout/canonical metadata.

**Step 2: Apply only the approved substitutions**

- `layout: kkorinote`
- `permalink: /kkorinote/privacy/`
- canonical `https://breadlab.ai/kkorinote/privacy/`
- 시행일 `2026년 11월 28일`
- first paragraph starts with `김준우(개인 개발자, 이하 “운영자”)`
- privacy contact `kkorinote.support@gmail.com`

Keep sections 3 and 7 from the delivered replacement body.

**Step 3: Run focused verification and verify GREEN**

```bash
node --test --test-name-pattern='Kkorinote' scripts/verify-site.test.mjs
```

Expected: PASS for all Kkorinote source and synthetic artifact contracts. Exact Jekyll output paths are then proven by the checked-in Docker build in Task 5.

**Step 4: Commit**

```bash
git add _pages/kkorinote-privacy.md
git diff --cached --check
git commit -m "docs: finalize Kkorinote privacy policy"
```

### Task 5: Run the complete revision-bound static-site gate

**Objective:** Prove the final repository produces one safe artifact containing all four pages while preserving `app-ads.txt`.

**Files:**
- Verify only; modify files only for defects reproduced by the gate.

**Step 1: Verify no placeholders, personal email, or accidental app-ads change**

```bash
git diff origin/master -- app-ads.txt
git diff --check
```

Use repository search to assert that changed Kkorinote files contain no personal email, `TODO`, `TBD`, bracket placeholders, or obsolete `pricacy` permalink. Bracket text that is intentional policy prose, such as iOS `[이름]`, must be allowlisted explicitly rather than removed.

**Step 2: Run full source/verifier tests**

```bash
node --test scripts/verify-site.test.mjs
```

Expected: zero failed tests.

**Step 3: Run repository build helper**

```bash
./scripts/build-site.sh
```

Expected: successful production build and final `node scripts/verify-site.mjs _site` exit 0. Record warnings separately.

If host dependencies are insufficient, run the checked-in Docker helper instead:

```bash
./scripts/build-site-docker.sh
```

Do not install ad hoc toolchain versions or weaken the gate.

**Step 4: Inspect exact artifact files**

Programmatically inspect:

- `_site/kkorinote/index.html`
- `_site/kkorinote/privacy/index.html`
- `_site/kkorinote/terms/index.html`
- `_site/kkorinote/support/index.html`
- `_site/app-ads.txt`

Require exact titles/canonicals, common footer, public email where appropriate, no forbidden scripts, no personal email, and one bounded horizontal-overflow exception for tables only.

**Step 5: Confirm repository state and commit final fixes**

```bash
git status --short --branch
git log -5 --oneline --decorate
```

If a final defect required a change, rerun Steps 1–4 and commit it. Preserve and report unrelated pre-existing working-tree changes separately.

**Step 6: Report boundaries honestly**

Report local implementation, commits, push, PR, merge, and deployment as separate states. No push, PR, merge, Pages deployment, local HTTP server, or browser/iPhone Safari run is authorized by this task. State that mobile behavior was verified from generated HTML/CSS contracts rather than a physical iPhone.
