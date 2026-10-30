# Company Benefits Explorer vertical slice verification

Implemented Tasks 1–8 from the approved plan, starting at `51ce3f1`. This is the fixture stage: **56 fictional companies, 560 category evaluations, 560 fictional claims**. It does not connect research data, change Supabase, publish posts, or create an overall best-company score.

## Delivered contracts

- Four direct Vite entries: heatmap, category rankings, fit and company evidence detail. The generated local methodology also has a direct entry and uses the shared header/account/footer without depending on artifact requests.
- Read-only, strict Zod schemas; version, exact count, SHA-256 and cross-record checks; independently retryable ranking/detail reads. Duplicate claims, unsafe source URLs, score/component mismatches and evidence-insufficient rankings fail closed even when their payload hash is correct.
- Deterministically generated `fixture-v1` JSON and latest manifest pointer. The visible **예시 데이터** badge remains fixed during scrolling. Every company and source is fictional; source links are confined to `https://example.org`.
- Normalized URL filters, comparison list capped at four, presets and bounded custom weights. Initial invalid page values are replaced with the actual last page; unknown query keys are removed. Browser history changes update the current view without refetching the index.
- Native table/header/link semantics, textual states, category focus after delayed detail loading, 50-row heatmap pages, sticky company column, keyboard controls, mobile modal filter drawer, reduced-motion rules and a category-specific top-three summary.
- Rankings require exactly one category and separate insufficient evidence. Fit excludes unknown categories from the denominator and withholds a numeric match when fewer than half the requested categories are comparable.
- Snapshot links opt out of Jekyll AJAX navigation. The site verifier checks the four core entries, metadata, compiled assets, fixture counts/hashes and existing site leak protections.

## TDD and acceptance findings

Focused red/green cycles covered route resolution; artifact reads; URL/scoring helpers; heatmap/filter/comparison states; rankings/fit; and evidence detail. Additional failing acceptance cases exposed and fixed missing authentication configuration on public entry, duplicate/contradictory evidence, mobile drawer behavior, delayed category focus, scrolling fixture disclosure, shared-header CSS bleed, initial URL page normalization and in-progress spaces in multiword search input. Existing validators and tests were retained.

One full host test run made concurrently with the Docker build failed the existing AuthProvider “invalidates only the expected session” assertion. Its isolated 13-test rerun and subsequent complete host suite passed. No authentication production code or existing authentication tests were modified.

## Final checks

- `community-app: npm run check`: `Test Files 48 passed (48)`; `Tests 646 passed (646)`; TypeScript and ESLint exit 0.
- `community-app: npm run build`: Vite production build exits 0, including the four core entries and the methodology entry.
- `node --test scripts/*.test.mjs`: `tests 247`; `pass 247`; `fail 0`; exit 0.
- `./scripts/build-site-docker.sh`: exit 0; embedded Community suite reports `646 passed (646)` and the artifact verifier reports `Verified 655 files in /work/_site`.
- `node scripts/verify-site.mjs _site-docker`: exit 0; `Verified 655 files`; `Required Jekyll routes, six community shells, four benefits entries, fixture integrity, canonical URLs, and leak checks passed.`
- `git diff --check`: exit 0, no output.

Fixture index size: **84,687 bytes raw; 2,149 gzip; 1,181 Brotli**. These are the actual fixture sizes, not a claim about future production data.

## Real-browser acceptance

`scripts/check-benefits-browser.mjs` uses a temporary HTTP server and a local Chromium executable; it stops both before returning. The local host Chromium lacked shared libraries, so acceptance used the already-cached Mermaid container's Chromium with external networking disabled, a read-only worktree mount and screenshots written only to `/tmp/benefits-browser-results`.

Desktop **1440×1000**, tablet **900×1000**, and mobile **390×844** checks cover the 50-row limit, real horizontal table overflow, no document overflow, four-company comparison limit, persistent example badge and unchanged shared-header styling. Mobile checks cover Escape and focus restoration. Native Enter activation opens the heatmap cell's category evidence. Direct rankings/fit/company/methodology URLs, insufficient evidence separation, safe source links and category focus are checked with no browser exceptions.

A 2,000-company synthetic fixture is generated only in the ephemeral browser server's memory, with an updated index hash and manifest count; it is never written into release artifacts. The final run against the extracted Docker artifact measured **search 26.90 ms; page change 44.80 ms**. The benchmark also checks the 50-row cap and absence of filter/page network refetches. The final browser output ended with `Direct rankings/fit/company/methodology URLs, insufficient evidence, safe sources, category focus and shared shell passed. No browser exceptions.`

No push, PR, deployment or persistent server was performed. Supabase files are unchanged.

The complete site build retains existing Sass deprecation, Liquid syntax and shared Community image-resolution warnings; they do not fail the build. Temporary browser screenshots were visually inspected.
