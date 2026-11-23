# Community Benefit Claims and Business Directory Expansion Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add Google-authenticated structured benefit claims, atomic community confirmations/disputes, evidence-only official verification, user-requested businesses including personal businesses, and OpenDART expansion without weakening the existing read model, publication lineage, deterministic 40,053-company seed, or release gates.

**Architecture:** Keep `benefit_publications` as the sole source of public confirmed-benefit counts and preserve all existing submissions and publication revisions. Add separate claim/reaction, company-identifier, company-add-request, and append-only event models behind bounded RPCs. Keep the canonical `/benefits/` bundle anonymous and read-only; route mutations through authenticated `/community/benefits/...` pages. Perform NTS verification only in a server-side Edge Function, retain only a domain-separated HMAC digest, and fail closed on every external-service error.

**Tech Stack:** PostgreSQL/Supabase migrations, pgTAP/dblink concurrency tests, Supabase Edge Functions/Deno, React/TypeScript/Vitest, Node deterministic importers, Jekyll/Vite assembly.

---

## Global implementation rules

1. Preserve these tables and workflows byte-for-byte unless a migration explicitly extends them:
   - `benefit_publications`
   - `benefit_submissions`
   - `benefit_submission_events`
   - current deterministic 40,053-company bundle and receipts
2. Never rewrite existing `KR-CRN-*` or `KR-BIZ-*` IDs.
3. Introduce opaque canonical IDs for newly created companies:

```text
KR-CAN-<32 lowercase hex characters>
```

- User-added businesses: random UUID with hyphens removed.
- OpenDART companies: deterministic namespace hash/UUID derived from the pinned edition plus exact `corp_code`.
- Never expose a business-registration number through `company_id`.

4. Centralize company ID validation in SQL and TypeScript helpers; do not add another copied regex to every repository.
5. Treat `profiles.display_name` as the community nickname.
6. New claim submitter FKs should permit profile deletion (`ON DELETE SET NULL`) so the public projection can return `탈퇴한 사용자`.
7. Raw business number, representative name, and opening date must never enter:
   - PostgreSQL tables
   - application logs
   - audit events
   - browser storage after a successful or failed attempt
   - release evidence
8. Official verification is always an explicit admin evidence-review action. Confirm counts never invoke it.
9. Every code task follows RED → observed expected failure → minimal GREEN → focused regression → commit.
10. Each migration remains additive and independently forward-fixable; no destructive rollback migration.

---

## Task 1: Centralize canonical company IDs and add identifier/merge lineage

**Objective:** Support opaque canonical IDs while preserving all existing IDs and preventing name-only merges.

**Files**

- Create: `supabase/migrations/202611230003_benefit_company_identifiers.sql`
- Create: `supabase/tests/database/benefit_company_identifiers.test.sql`
- Modify: `community-app/src/types/database.ts`
- Create: `community-app/src/lib/benefitCompanyId.ts`
- Create: `community-app/src/lib/benefitCompanyId.test.ts`
- Modify callers currently containing local company regexes:
  - `community-app/src/pages/BenefitDirectoryCompanyPage.tsx`
  - `community-app/src/pages/BenefitSubmissionPage.tsx`
  - `community-app/src/data/benefitSubmissionRepository.ts`
  - `community-app/src/data/benefitDirectoryRepository.ts`
  - `community-app/src/lib/benefitCorrectionDraftStore.ts`
  - related tests

**Database contract**

- Extend `benefit_companies_company_id_check` to accept:
  - existing `KR-CRN-[0-9]{13}`
  - existing `KR-BIZ-[0-9]{10}`
  - new `KR-CAN-[0-9a-f]{32}`
- Add `public.benefit_company_identifiers`:
  - `identifier_id uuid`
  - `company_id`
  - `identifier_type`
  - `identifier_digest_or_value`
  - `source_edition`
  - `verified_at`
  - timestamps
  - unique `(identifier_type, identifier_digest_or_value)`
- Initial identifier types:
  - `legacy_company_id`
  - `opendart_corp_code`
  - `business_number_hmac_v1`
- Add append-only `public.benefit_company_merge_events`:
  - source company, destination company, actor, reason, timestamp
  - old IDs remain resolvable for audit
- Revoke direct table access from `anon` and `authenticated`.
- Never merge on normalized name alone.

**RED**

```bash
npm --prefix community-app run db:reset
./community-app/node_modules/.bin/supabase --workdir . test db \
  supabase/tests/database/benefit_company_identifiers.test.sql
npm --prefix community-app test -- --run \
  src/lib/benefitCompanyId.test.ts
```

Expected failures:

- `KR-CAN-*` rejected by current constraints/decoders.
- identifier and merge tables absent.
- no central frontend parser exists.

**GREEN acceptance**

- Existing 40,053 IDs still decode unchanged.
- opaque IDs work in cursor, search, detail, submission, and correction paths.
- duplicate strong identifiers fail with `23505`.
- same normalized name with different identifiers remains two companies.
- merge event update/delete/truncate is rejected.

**Commit**

```bash
git commit -m "feat: add canonical benefit company identifiers"
```

---

## Task 2: Add company-add requests, manual review, and write kill switches

**Objective:** Accept authenticated manual business requests without exposing them before admin approval.

**Files**

- Create: `supabase/migrations/202611230004_benefit_company_add_requests.sql`
- Create: `supabase/tests/database/benefit_company_add_requests.test.sql`
- Create: `supabase/tests/database/zz_benefit_company_add_concurrency.test.sql`
- Modify: `community-app/src/types/database.ts`

**Schema**

`benefit_company_add_requests`:

- `request_id uuid`
- `requester_id uuid`
- `client_key uuid`
- `payload_fingerprint`
- `proposed_name`, `normalized_name`
- `region`, `industry`, `website`
- `verification_method`: `nts_full | manual`
- `verification_status`: `pending | matched | mismatched | unavailable | rejected`
- `business_number_digest nullable`
- `external_verified_at nullable`
- `status`: `pending_review | approved | rejected | merged`
- `resolved_company_id nullable`
- reviewer/processed timestamps
- no representative name, opening date, or raw number columns

Supporting tables:

- `benefit_company_add_events`, append-only
- private feature settings for:
  - `claims_write_enabled`
  - `claim_reactions_write_enabled`
  - `company_add_write_enabled`
  - `nts_verification_enabled`

RPCs:

- `create_manual_benefit_company_request_v1`
- `list_my_benefit_company_requests_v1`
- `list_benefit_company_request_queue_v1`
- `review_benefit_company_request_v1`
- service-only finalize/failure RPCs for Task 3

Rules:

- derive requester from `auth.uid()`
- require trusted Google identity, not merely any authenticated JWT
- idempotency and rate limiting
- manual approval atomically creates `KR-CAN-*`, marks it searchable, records the request event
- merge requires an existing canonical company and records merge lineage
- approval is rejected if a strong identifier conflicts
- pending manual requests stay absent from anonymous search/detail

**Concurrency RED cases**

- two admins approve one request
- approve versus merge
- two requests race to the same strong identifier
- same idempotency key with different payload
- feature kill switch changes while mutation waits

**Focused commands**

```bash
./community-app/node_modules/.bin/supabase --workdir . test db \
  supabase/tests/database/benefit_company_add_requests.test.sql \
  supabase/tests/database/zz_benefit_company_add_concurrency.test.sql
```

Expected RED: tables/RPCs absent.

Expected GREEN:

- one terminal outcome and one canonical company at most
- losing CAS receives `40001`
- rollback leaves no company, identifier, or partial audit event
- all fixtures are removed and dblink connections closed

**Commit**

```bash
git commit -m "feat: add moderated benefit company requests"
```

---

## Task 3: Implement fail-closed NTS full verification

**Objective:** Verify business number, opening date, representative, business name, and active status server-side while retaining only an HMAC digest.

**Files**

- Create: `supabase/functions/verify-benefit-company/index.ts`
- Create: `supabase/functions/verify-benefit-company/index.test.ts`
- Modify: `supabase/config.toml`
- Modify: `deno.lock` only through the pinned Deno toolchain
- Modify: `docs/operations/community-release-runbook.md`
- Modify: `docs/operations/community-release-checklist.md`

**Function boundary**

- Accept only HTTPS requests from configured exact origins.
- Require:
  - bearer token
  - canonical UUID idempotency key
  - bounded exact-key JSON body
- Authenticate with Supabase Auth and verify a Google identity.
- Reserve the rate-limit/idempotency operation before contacting NTS.
- Call NTS authenticity verification and status lookup with:
  - business number
  - opening date
  - representative name
  - business name
- Enforce request timeout, response byte cap, exact response decoder, and no redirects to unexpected hosts.
- Require both:
  - field match
  - publicly registrable current business status
- Compute:

```text
HMAC-SHA-256(secret, "breadlab:business-number:v1\0" + digits)
```

- Invoke service-only finalize RPC with safe fields and digest.
- Clear sensitive variables as soon as practical.
- Logs may contain only request ID, success/failure class, timing bucket, and safe status category.
- On mismatch, timeout, malformed response, 4xx/5xx, or missing secrets: no company is created.

**RED tests**

- anonymous and non-Google JWT rejected
- malformed/oversized body rejected before external call
- invalid business number grammar
- mismatch
- inactive/closed status
- timeout
- malformed NTS JSON
- oversized response
- redirect
- duplicate digest
- repeated same idempotency key
- failure log contains none of the four sensitive inputs
- success dependency receives HMAC only

**Commands**

```bash
npx --yes deno@2.9.6 check --lock=deno.lock --frozen-lockfile \
  supabase/functions/verify-benefit-company/index.ts \
  supabase/functions/verify-benefit-company/index.test.ts

npx --yes deno@2.9.6 test --allow-env --allow-read \
  --lock=deno.lock --frozen-lockfile \
  supabase/functions/verify-benefit-company/index.test.ts
```

Expected RED: function absent.

Expected GREEN: all mock success/failure paths pass; grep-based test proves sensitive sentinels are absent from logs and persisted RPC payloads.

**Commit**

```bash
git commit -m "feat: verify benefit companies with NTS"
```

---

## Task 4: Add deterministic OpenDART expansion importer

**Objective:** Import a pinned OpenDART edition without changing the existing 40,053-company bundle or merging companies by name.

**Files**

- Create: `scripts/generate-opendart-benefit-directory.mjs`
- Create: `scripts/generate-opendart-benefit-directory.test.mjs`
- Create: `scripts/verify-opendart-benefit-directory.mjs`
- Create: `scripts/verify-opendart-benefit-directory.test.mjs`
- Create: `scripts/apply-opendart-benefit-directory.mjs`
- Create: `supabase/tests/opendart_benefit_importer_integration.sh`
- Create generated directory:
  - `supabase/fixtures/benefit-directory-opendart/manifest.json`
  - `supabase/fixtures/benefit-directory-opendart/companies.ndjson`
  - `supabase/fixtures/benefit-directory-opendart/identifiers.ndjson`
- Create: `docs/operations/opendart-benefit-directory-import.md`
- Modify: `community-app/package.json`

**Importer contract**

- Pin actual source bytes, edition, digest, row count, and reuse-rights note.
- Reject malformed ZIP/XML, duplicate `corp_code`, missing names, masked/truncated IDs, and conflicting rows.
- Canonical ID is deterministic but not the raw source ID.
- Store `corp_code` only as an identifier row.
- Do not infer business activity, workers, size, or benefit availability.
- Name equality alone never reuses an existing company.
- `--check` performs no writes, directory creation, locks, backups, or scratch creation.
- Apply path follows the existing seed importer’s:
  - trusted absolute `psql`
  - no-follow reads
  - mode-0700/0600 custody
  - client/server UTF-8 digests
  - advisory lock
  - staged exact-set validation
  - immutable receipt
  - dry-run rollback
- Existing base seed receipts and all publication rows must remain unchanged.

**RED**

```bash
node --test \
  scripts/generate-opendart-benefit-directory.test.mjs \
  scripts/verify-opendart-benefit-directory.test.mjs
```

Expected: scripts absent.

**GREEN**

```bash
node scripts/generate-opendart-benefit-directory.mjs --check
node scripts/verify-opendart-benefit-directory.mjs
bash supabase/tests/opendart_benefit_importer_integration.sh
```

Acceptance mutations:

- remove one row and recompute manifest hashes
- replace one `corp_code`
- duplicate a name under a different code
- duplicate one code under another name
- alter source edition
- symlink source or fixture component
- inject a late SQL failure

All must fail or roll back without changing the prior directory.

**Commit**

```bash
git commit -m "feat: add deterministic OpenDART directory import"
```

---

## Task 5: Add structured claims and public claim projection

**Objective:** Create immediately visible structured claims without replacing existing moderated submissions.

**Files**

- Create: `supabase/migrations/202611230005_benefit_claims.sql`
- Create: `supabase/tests/database/benefit_claims.test.sql`
- Modify: `community-app/src/types/database.ts`

**Schema**

`benefit_claims`:

- `claim_id uuid`
- `company_id`
- `submitter_id uuid nullable ON DELETE SET NULL`
- `client_key`, `payload_fingerprint`
- `category_id`
- `title`, `normalized_title`
- `description`
- `eligibility_text`, normalized eligibility key
- `condition_text`
- `observed_on date`
- `source_url nullable`
- `status`: `submitted | community_confirmed | disputed | hidden | withdrawn`
- `active_publication_id nullable`
- timestamps

`benefit_claim_events`:

- append-only
- submitted, duplicate-directed, withdrawn, hidden, restored, merged, promoted, demoted, repromoted, official-reviewed
- safe metadata only

RPCs:

- `create_benefit_claim_v1`
- `withdraw_benefit_claim_v1`
- `list_my_benefit_claims_v1`
- public detail extension via new `get_benefit_company_v2`

Validation:

- title: 1–200
- short description: select an explicit bound, recommended 1–1,000
- eligibility/condition: maximum 500 each
- observed date must be valid, non-future, and bounded to a documented earliest date
- strict credential-free HTTPS URL
- only existing searchable companies
- Google identity required
- exact active duplicate key:
  - company
  - category
  - normalized title
  - normalized eligibility
- duplicate creation returns the existing claim ID and a distinct `duplicate` outcome; it must not create a confirmation.

Public claim projection exact keys:

- claim ID
- category/title/description/eligibility/condition
- status label
- nickname or `탈퇴한 사용자`
- submitted date
- observed date
- confirm/dispute counts
- last confirmation date
- never email, auth subject, internal user ID, fingerprint, or private provenance

**RED**

```bash
./community-app/node_modules/.bin/supabase --workdir . test db \
  supabase/tests/database/benefit_claims.test.sql
```

Expected failures: claim tables/RPCs absent.

**GREEN acceptance**

- claim is publicly visible immediately as `submitted`
- deleted profile preserves claim and projects `탈퇴한 사용자`
- exact duplicate is directed to existing claim
- near/fuzzy title remains separate
- raw tables are unreadable by `anon` and `authenticated`
- public response rejects overflow at `maximum + 1`

**Commit**

```bash
git commit -m "feat: add structured community benefit claims"
```

---

## Task 6: Implement atomic reactions and publication promotion/demotion

**Objective:** Apply reaction upsert, counts, claim status, publication lineage, and audit event in one transaction.

**Files**

- Create: `supabase/migrations/202611230006_benefit_claim_reactions.sql`
- Create: `supabase/tests/database/benefit_claim_reactions.test.sql`
- Create: `supabase/tests/database/zz_benefit_claim_reactions_concurrency.test.sql`
- Modify: `community-app/src/types/database.ts`

**Schema/RPC**

`benefit_claim_reactions`:

- `(claim_id, user_id)` unique
- `reaction`: `confirm | dispute`
- timestamps

RPC:

```text
set_benefit_claim_reaction_v1(
  claim_id,
  reaction nullable,
  client_key
)
```

`null` clears the current reaction.

Atomic lock order:

1. Google actor/profile
2. claim row `FOR UPDATE`
3. current actor reaction
4. all claim reactions for recomputation
5. active publication lineage
6. claim event/idempotency record

State algorithm:

- dispute count ≥ 1 → `disputed`
- else confirm count ≥ 3 → `community_confirmed`
- else → `submitted`
- third distinct confirmation:
  - creates active `community_reviewed` publication
  - dedupe key fixed to claim identity
  - stores claim binding in private provenance
- first dispute:
  - withdraws active community publication
  - clears `active_publication_id`
- dispute removal with ≥3 confirms:
  - creates a new revision
  - supersedes/links the withdrawn predecessor
- official publications are not created or withdrawn by this RPC.
- submitter cannot `confirm`; submitter may `dispute` or withdraw.

**Focused behavior RED**

- anonymous/non-Google mutation
- self-confirmation
- repeat same reaction
- confirm→dispute change
- clear reaction
- 2→3 promotion
- first dispute demotion
- dispute removal repromotion
- hidden/withdrawn claim reaction rejection
- idempotent replay
- publication insertion failure rolls back reaction and status

**Concurrency RED**

- two users race to become third confirmer
- confirm and dispute race
- same user sends two different reactions
- dispute removal races with a new dispute
- moderation hide races with reaction

**Commands**

```bash
./community-app/node_modules/.bin/supabase --workdir . test db \
  supabase/tests/database/benefit_claim_reactions.test.sql \
  supabase/tests/database/zz_benefit_claim_reactions_concurrency.test.sql
```

Expected GREEN:

- at most one active publication per lineage
- counts equal actual reaction rows
- no lost reaction updates
- no deadlock under fixed lock order
- one transition event per real state change
- same-key replay produces no duplicate event/publication/rate event

**Commit**

```bash
git commit -m "feat: promote claims through atomic reactions"
```

---

## Task 7: Add claim moderation and evidence-gated official verification

**Objective:** Let admins hide, restore, withdraw, merge, and officially verify claims without conflating community confirmation with official evidence.

**Files**

- Create: `supabase/migrations/202611230007_benefit_claim_moderation.sql`
- Create: `supabase/tests/database/benefit_claim_moderation.test.sql`
- Create: `supabase/tests/database/zz_benefit_claim_moderation_concurrency.test.sql`
- Modify: `community-app/src/types/database.ts`

**RPCs**

- `list_benefit_claim_moderation_queue_v1`
- `list_benefit_claim_audit_v1`
- `moderate_benefit_claim_v1`
- `officially_verify_benefit_claim_v1`

Official evidence inputs:

- expected claim status/revision
- public title/description/eligibility/condition
- evidence type
- strict source URL
- observed date
- verification note/private provenance
- idempotency key

Rules:

- admin role comes only from `user_roles`
- official action requires evidence fields; no “approve as official” shortcut
- confirmation count is ignored for official authority
- official publication uses `official_verified`
- if the same claim already has an active community publication, retire that community publication when official publication activates to prevent duplicate benefit counts
- later community dispute may flag the claim but must not automatically withdraw the official publication
- official withdrawal requires a separate evidence/moderation action
- source/reviewer detail remains private
- merge preserves source claim IDs and reaction history; it must not sum duplicate users twice

**RED/GREEN**

```bash
./community-app/node_modules/.bin/supabase --workdir . test db \
  supabase/tests/database/benefit_claim_moderation.test.sql \
  supabase/tests/database/zz_benefit_claim_moderation_concurrency.test.sql
```

Expected RED: RPCs absent.

Expected GREEN:

- forged admin metadata rejected
- evidence-less official verification rejected
- official and community authority never activate automatically together
- hide/reaction races serialize
- merge preserves all audit lineage
- late event/publication failure rolls back the moderation state

**Commit**

```bash
git commit -m "feat: moderate and officially verify benefit claims"
```

---

## Task 8: Add strict frontend contracts and repositories

**Objective:** Decode exact public/authenticated payloads, preserve account/session boundaries, and expose no raw backend errors.

**Files**

- Create:
  - `community-app/src/types/benefitClaims.ts`
  - `community-app/src/data/benefitClaimRepository.ts`
  - `community-app/src/data/benefitClaimRepository.test.ts`
  - `community-app/src/types/benefitCompanyRequests.ts`
  - `community-app/src/data/benefitCompanyRequestRepository.ts`
  - `community-app/src/data/benefitCompanyRequestRepository.test.ts`
- Modify:
  - `community-app/src/types/benefitDirectory.ts`
  - `community-app/src/data/benefitDirectoryRepository.ts`
  - `community-app/src/data/benefitDirectoryRepository.test.ts`
  - `community-app/src/types/database.ts`

**Repository rules**

- Public `get_benefit_company_v2` uses `getAnonymousSupabaseClient()`.
- Claim/reaction/request RPCs use the authenticated session provider pattern from `benefitSubmissionRepository.ts`.
- Capture actor/session:
  - before validation
  - immediately before RPC
  - after RPC
- Reject stale completion after account switch.
- Exact-key decode, dense arrays, collection bounds, date order, enum validation.
- Reject extra fields including:
  - email
  - submitter/user IDs
  - provider ID
  - business digest
  - source/private provenance
  - reviewer ID
- Map SQL/RPC/service errors to fixed Korean public messages.

**Command**

```bash
npm --prefix community-app test -- --run \
  src/data/benefitDirectoryRepository.test.ts \
  src/data/benefitClaimRepository.test.ts \
  src/data/benefitCompanyRequestRepository.test.ts
```

Expected RED: new modules and v2 shapes absent.

Expected GREEN: strict decoder and stale-session tests pass.

**Commit**

```bash
git commit -m "feat: add claim and company request repositories"
```

---

## Task 9: Build versioned claim and company-request draft stores

**Objective:** Preserve structured drafts across reload, OAuth, NTS errors, and company-add→first-claim transitions.

**Files**

- Create:
  - `community-app/src/lib/benefitClaimDraftStore.ts`
  - `community-app/src/lib/benefitClaimDraftStore.test.ts`
  - `community-app/src/lib/benefitCompanyRequestDraftStore.ts`
  - `community-app/src/lib/benefitCompanyRequestDraftStore.test.ts`
- Reuse patterns from:
  - `community-app/src/lib/benefitSubmissionDraftStore.ts`
  - `community-app/src/pages/accountStateLifecycle.ts`

**Rules**

- account-scoped versioned drafts
- one cryptographic idempotency key retained across retries
- compare-and-clear only after exact successful response
- account switch rejects stale completions
- unreadable/future-version storage fails closed
- NTS-sensitive fields are never written to local/session storage
- non-sensitive company fields and the pending first benefit claim may be stored
- after NTS failure, retain only non-sensitive fields and prompt re-entry of sensitive values
- after company creation, atomically replace temporary company reference with returned canonical ID before navigating to claim submission

**Command**

```bash
npm --prefix community-app test -- --run \
  src/lib/benefitClaimDraftStore.test.ts \
  src/lib/benefitCompanyRequestDraftStore.test.ts
```

Expected RED: stores absent.

Expected GREEN: reload/OAuth/account-switch/cleanup-failure matrices pass.

**Commit**

```bash
git commit -m "feat: persist benefit claim and company request drafts"
```

---

## Task 10: Add authenticated company-add and structured-claim pages

**Objective:** Implement the user mutation flows without adding auth dependencies to the public benefits entry.

**Files**

- Create:
  - `community-app/src/pages/BenefitCompanyRequestPage.tsx`
  - `community-app/src/pages/BenefitCompanyRequestPage.test.tsx`
  - `community-app/src/pages/BenefitClaimPage.tsx`
  - `community-app/src/pages/BenefitClaimPage.test.tsx`
  - `community-app/benefits/company-request/index.html`
  - `community-app/benefits/claim/index.html`
- Modify:
  - `community-app/src/App.tsx`
  - `community-app/src/routes.ts`
  - `community-app/vite.config.ts`
  - `community-app/src/styles/benefits.css`

**Company-add flow**

- empty search links to `/community/benefits/company-request/`
- selectable “사업자등록정보 있음/없음”
- NTS path fields:
  - business name
  - business number
  - opening date
  - representative name
  - optional region/industry/website
- manual path:
  - business name
  - region
  - industry
  - website/public information
- explicit sensitive-data notice
- on NTS success, navigate to claim page with canonical ID
- on NTS mismatch/unavailable, preserve claim and non-sensitive company draft only
- manual request remains pending and cannot be selected for claims until approved

**Claim form**

- company ID
- category
- one-line title
- short description
- observed date
- optional eligibility, condition, source URL
- duplicate outcome links to existing claim
- synchronous submit guard before React state updates
- Google login CTA and draft restoration

**Commands**

```bash
npm --prefix community-app test -- --run \
  src/pages/BenefitCompanyRequestPage.test.tsx \
  src/pages/BenefitClaimPage.test.tsx \
  src/routes.test.ts \
  src/application.test.tsx
```

Expected RED: routes/pages absent.

Expected GREEN: search miss→company add→claim draft recovery works, including account switches and raw-error suppression.

**Commit**

```bash
git commit -m "feat: add company request and structured claim flows"
```

---

## Task 11: Expand public directory cards and company detail

**Objective:** Show official/community counts and the four required detail sections while preserving anonymous bounded reads.

**Files**

- Modify:
  - `community-app/src/pages/BenefitsDirectoryPage.tsx`
  - `community-app/src/pages/BenefitsDirectoryPage.test.tsx`
  - `community-app/src/pages/BenefitDirectoryCompanyPage.tsx`
  - `community-app/src/pages/BenefitDirectoryCompanyPage.test.tsx`
  - `community-app/src/types/benefitDirectory.ts`
  - `community-app/src/data/benefitDirectoryRepository.ts`
  - `community-app/src/styles/benefits.css`
  - `community-app/src/benefitsPublicBoundary.test.ts`
  - `scripts/check-benefits-browser.mjs`
  - `scripts/check-benefits-browser.test.mjs`

**Directory card**

With publications:

```text
공개 확인 혜택 N개 · 커뮤니티 확인 혜택 M개
건강 · 식사 · 휴가
```

Without publications:

```text
공개 확인된 복지 정보 없음
첫 번째 혜택을 제보해 주세요.
```

- Do not display identity taxonomy, long summary, or private provenance as primary content.
- Replace hard-coded `40,053` scope copy with a server/manifest-backed aggregate or wording that remains truthful after OpenDART/user additions:

```text
공개 명단과 사용자 검증으로 등록된 국내 사업체를 검색합니다.
국내 전체 사업체 명부는 아닙니다.
```

**Company detail order**

1. company name and verification state
2. claim CTA
3. official benefits
4. community-confirmed benefits
5. submitted claims
6. disputed/reconfirmation-needed claims

Claim cards show:

- nickname
- first submitted date
- last confirmation date or “아직 확인 없음”
- confirmation/dispute counts
- observed date
- community disclaimer
- links to authenticated reaction route

No automatic expiry.

**Public-boundary acceptance**

- `benefits-main.tsx` still does not import `AuthProvider`
- initial canonical bundle graph still excludes mutation repositories
- public detail performs anonymous reads only
- action links cross into authenticated `/community/benefits/...` routes

**Command**

```bash
npm --prefix community-app test -- --run \
  src/pages/BenefitsDirectoryPage.test.tsx \
  src/pages/BenefitDirectoryCompanyPage.test.tsx \
  src/benefitsPublicBoundary.test.ts \
  src/styles/siteIntegration.test.ts
```

Expected RED: v1 detail shape lacks claim sections and new copy/count hierarchy.

Expected GREEN: all four status groups, counts, dates, CTA, and public-boundary assertions pass.

**Commit**

```bash
git commit -m "feat: surface community benefit claims in directory"
```

---

## Task 12: Add authenticated reaction interaction page

**Objective:** Let a Google user confirm, dispute, change, or clear a reaction safely.

**Files**

- Create:
  - `community-app/src/pages/BenefitClaimReactionPage.tsx`
  - `community-app/src/pages/BenefitClaimReactionPage.test.tsx`
  - `community-app/benefits/claim-reaction/index.html`
- Modify:
  - `community-app/src/App.tsx`
  - `community-app/vite.config.ts`
  - `community-app/src/data/benefitClaimRepository.ts`
  - `community-app/src/styles/benefits.css`

**Behavior**

- load public claim snapshot, then authenticated current-reaction state
- buttons:
  - `나도 확인했어요`
  - `현재는 달라요`
  - `반응 취소`
- submitter’s confirm button is disabled with an explanation
- submitter dispute path recommends withdrawal but remains available
- preserve one idempotency key for a pending reaction
- after success, accept only a response matching claim ID, actor-visible reaction, counts, and status
- conflict refreshes latest state
- session/account switch drops stale response
- return to `/benefits/company/?id=...#claim-<id>`

**Command**

```bash
npm --prefix community-app test -- --run \
  src/pages/BenefitClaimReactionPage.test.tsx \
  src/data/benefitClaimRepository.test.ts
```

Expected RED: page and reaction method absent.

Expected GREEN: self-confirm, duplicate-click, stale-account, conflict-refresh, and return-link tests pass.

**Commit**

```bash
git commit -m "feat: add benefit claim reactions"
```

---

## Task 13: Extend admin moderation surfaces

**Objective:** Add separate company-request and claim/evidence desks while preserving old submission moderation.

**Files**

- Create:
  - `community-app/src/pages/AdminBenefitCompanyRequestsPage.tsx`
  - `community-app/src/pages/AdminBenefitCompanyRequestsPage.test.tsx`
  - `community-app/src/pages/AdminBenefitClaimsPage.tsx`
  - `community-app/src/pages/AdminBenefitClaimsPage.test.tsx`
  - `community-app/src/components/BenefitCompanyRequestQueue.tsx`
  - `community-app/src/components/BenefitClaimModerationQueue.tsx`
  - `community-app/src/data/adminBenefitCompanyRequestRepository.ts`
  - `community-app/src/data/adminBenefitClaimRepository.ts`
  - corresponding repository tests/types
  - `community-app/admin/benefit-company-requests/index.html`
  - `community-app/admin/benefit-claims/index.html`
- Modify:
  - `community-app/src/App.tsx`
  - `community-app/vite.config.ts`
  - `community-app/src/styles/community.css`
  - existing admin local navigation

**Company request desk**

- pending/all/status filters
- approve, reject, merge
- strong identifier conflict display
- no raw business number or personal verification inputs
- NTS-confirmed status/time only

**Claim desk**

- submitted/community-confirmed/disputed/hidden/withdrawn filters
- hide, restore, withdraw, merge
- append-only audit timeline
- official verification form requires evidence fields
- no “official because three confirmations” action
- confirmation/dispute counts shown as context only

**Security behavior**

- reuse DB `isAdmin()` gate plus server-side `require_admin`
- fail closed and clear state on auth change
- CAS expected status/revision
- one idempotency key per unchanged admin action
- raw backend errors never rendered

**Command**

```bash
npm --prefix community-app test -- --run \
  src/pages/AdminBenefitCompanyRequestsPage.test.tsx \
  src/pages/AdminBenefitClaimsPage.test.tsx \
  src/data/adminBenefitCompanyRequestRepository.test.ts \
  src/data/adminBenefitClaimRepository.test.ts
```

Expected RED: surfaces absent.

Expected GREEN: authorization, stale-session, CAS, duplicate-click, official-evidence, and safe projection tests pass.

**Commit**

```bash
git commit -m "feat: moderate company requests and benefit claims"
```

---

## Task 14: Expand release gates and operational verification

**Objective:** Fail closed unless schema, importers, Edge Function, public projection, frontend, and assembled artifact agree.

**Files**

- Modify:
  - `scripts/release-gate.mjs`
  - `scripts/release-gate.test.mjs`
  - `community-app/package.json`
  - `scripts/verify-site.mjs`
  - `scripts/verify-site.test.mjs`
  - `docs/operations/community-release-runbook.md`
  - `docs/operations/community-release-checklist.md`
  - `docs/operations/evidence/benefits-supabase-directory-verification.md`
- Create:
  - `scripts/verify-benefit-claims-release.mjs`
  - `scripts/verify-benefit-claims-release.test.mjs`
  - `supabase/tests/benefit_claims_upgrade_integration.sh` if upgrade fixtures require pre-feature schema state

**Local gate additions**

- OpenDART generator `--check`
- OpenDART independent verifier
- OpenDART importer integration
- NTS Edge Function check/test/fmt
- claim/company request pgTAP and dblink tests
- strict anonymous v2 projection test
- assembled authenticated route shells
- public bundle still free of auth/mutation dependencies
- secret/sensitive-field scanner for:
  - representative names
  - opening dates
  - raw business-number fixtures outside explicitly synthetic test files
  - NTS API keys
  - HMAC key
  - service role keys
- mutation tests for extra private JSON keys and oversized claim arrays

**Release gate RED**

```bash
node --test \
  scripts/release-gate.test.mjs \
  scripts/verify-benefit-claims-release.test.mjs \
  scripts/verify-site.test.mjs
```

Expected: new steps/routes/contracts absent.

**GREEN gate**

```bash
node scripts/release-gate.mjs --mode local \
  --evidence "$TMPDIR/benefit-claims-release-evidence.json"
```

Expected: exit 0 only with a clean tree, exact revision, all database tests, import checks, Edge tests, frontend checks, two reproducible assembled builds, browser acceptance, and external evidence output.

**Commit**

```bash
git commit -m "chore: gate community benefit claims release"
```

---

## Task 15: Full regression and revision-bound handoff

**Objective:** Prove the new feature did not regress existing submissions, publications, seed imports, corrections, or site assembly.

**Database**

```bash
npm --prefix community-app run db:start
npm --prefix community-app run db:reset
npm --prefix community-app run db:test:benefit-title-upgrade
npm --prefix community-app run db:test:benefit-seed-importer
bash supabase/tests/opendart_benefit_importer_integration.sh
npm --prefix community-app run db:test
npm --prefix community-app run db:lint
```

Expected: all existing and new pgTAP suites pass, including concurrency residue assertions.

**Importers**

```bash
node scripts/generate-benefit-directory-seed.mjs --check
node scripts/verify-benefit-directory-seed.mjs
node scripts/generate-opendart-benefit-directory.mjs --check
node scripts/verify-opendart-benefit-directory.mjs
```

Expected: existing 40,053 bundle remains byte-identical; expansion bundle passes independently.

**Edge Functions**

```bash
npx --yes deno@2.9.6 check --lock=deno.lock --frozen-lockfile \
  supabase/functions/verify-benefit-company/index.ts \
  supabase/functions/verify-benefit-company/index.test.ts

npx --yes deno@2.9.6 test --allow-env --allow-read \
  --lock=deno.lock --frozen-lockfile \
  supabase/functions/verify-benefit-company/index.test.ts

npx --yes deno@2.9.6 fmt --check supabase/functions
```

**Frontend**

```bash
npm --prefix community-app run check
npm --prefix community-app run build
```

**Static assembly**

```bash
node --test scripts/*.test.mjs
./scripts/build-site-docker.sh "$TMPDIR/benefit-claims-site"
node scripts/verify-site.mjs "$TMPDIR/benefit-claims-site"
node scripts/check-benefits-browser.mjs \
  "$TMPDIR/benefit-claims-site/community"
```

**Revision evidence**

Record:

- full Git SHA
- database test totals
- base seed and OpenDART bundle digests/counts separately
- Edge Function test count
- frontend/build/site results
- no hosted migration/import/deploy unless actually executed
- distinct readiness states:
  - claims
  - NTS business verification
  - OpenDART expansion
  - manual company review

**Commit**

```bash
git commit -m "docs: record community benefit claims verification"
```

Do not create an empty commit when the evidence document is unchanged.

---

## Security acceptance criteria

Release is blocked unless all are true:

- Only users with a current trusted Google identity can create claims, react, or add businesses.
- Actor IDs come from server-authenticated context; no mutation trusts a client actor field.
- Anonymous access is limited to exact-key, size-bounded RPCs.
- No raw claim/reaction/request table is selectable by browser roles.
- Public projections never contain email, auth subject, internal user IDs, business-number digest, reviewer IDs, or private provenance.
- Business number, opening date, and representative name do not survive the Edge request.
- NTS secrets and HMAC keys never enter the static bundle, database, logs, or release evidence.
- NTS mismatch, timeout, malformed response, rate failure, or secret absence creates no searchable company.
- Official status requires explicit reviewed evidence and cannot be reached from reaction counts.
- Hidden/withdrawn claims reject reactions.
- Existing moderated submissions and their publications remain readable and auditable.
- Feature kill switches can stop claim, reaction, company-add, and NTS writes independently without disabling anonymous reads.

## Concurrency acceptance criteria

- A claim has one current reaction per user.
- Concurrent third confirmations create one active community publication.
- Concurrent confirm/dispute produces counts matching committed reaction rows and a status derived from those rows.
- First committed dispute leaves no active community publication.
- Repromotion creates a new revision linked to the prior withdrawn revision.
- Reaction/publication/audit failures roll back as one unit.
- Admin claim moderation and reactions use one documented lock order and do not deadlock.
- Company request approve/merge races have one winner.
- HMAC duplicates cannot create two canonical companies.
- OpenDART/base importers serialize independently and preserve unrelated rows/publications.
- Every dblink test closes connections and proves zero fixture residue.

---

## Production rollout gates

1. **Reviewed revision gate**
   - clean tree
   - exact reviewed SHA
   - local release evidence passed
   - base seed still byte-identical

2. **Backup gate**
   - production logical backup
   - private source/receipt backup
   - external evidence reference
   - distinct development and production project fingerprints

3. **Migration dry-run gate**
   - explicit target project ref
   - `supabase db push --dry-run`
   - review only additive migrations `202611230003`–`007`
   - stop for separate approval

4. **Development deployment gate**
   - apply migrations to dedicated development project
   - deploy `verify-benefit-company`
   - configure development-only NTS and HMAC secrets
   - verify Google-only OAuth
   - run synthetic authenticated claim/reaction/manual-request integration
   - run NTS integration only with an authorized test identity/data set
   - exact cleanup and zero-residue read-back

5. **OpenDART import gate**
   - separate approval from migration
   - verifier immediately before dry-run
   - dry-run rollback
   - inspect sanitized counts/digests
   - separate post-dry-run apply confirmation
   - read back exact receipt and identifier counts
   - confirm existing 40,053 seed receipt and publication snapshot unchanged

6. **Production backend gate**
   - explicit backend approval
   - apply migrations
   - deploy exact reviewed Function set including `verify-benefit-company`
   - configure secrets through Supabase secret management only
   - leave write kill switches disabled until read checks pass

7. **Anonymous read gate**
   - bounded search against:
     - known legacy company
     - OpenDART-added company
     - approved manual company
     - approved personal business
   - verify exact public keys
   - verify official/community counts
   - verify zero-benefit wording
   - verify no private fields

8. **Authenticated write gate**
   - enable claims first
   - bounded dedicated test account creates one claim
   - three distinct dedicated accounts confirm
   - one disputes, then clears dispute
   - verify promotion, demotion, repromotion, dates, and lineage
   - exact-ID cleanup or retained test record decision documented
   - only then enable company-add requests
   - NTS production canary requires legitimate authorized test data; do not substitute fabricated business details

9. **Pages gate**
   - deploy only through `.github/workflows/jekyll.yml`
   - source SHA must equal reviewed backend/frontend SHA
   - verify canonical public routes and authenticated interaction routes
   - verify canonical public bundle still excludes auth code

10. **Post-deploy observation**
    - watch safe aggregate error classes, rate limits, RPC latency, NTS timeout rate, and moderation backlog
    - never log payloads
    - keep claims, reactions, company additions, and NTS independently disableable

11. **Recovery**
    - disable affected write flag first
    - preserve audit/publication/import receipts
    - do not bulk-delete or reverse destructive migrations
    - revert Pages independently if needed
    - forward-fix database/Function
    - rerun local, development, and production read gates before re-enabling writes

