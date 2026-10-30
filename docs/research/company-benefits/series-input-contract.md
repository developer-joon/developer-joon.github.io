# Company benefits series batch input contract

The full series is partitioned by `series-batches.jsonl`. It is the only authority for batch IDs, canonical company order, company IDs, legal-entity boundaries, and each 25-company list SHA-256. Agents must not reconstruct a batch from names or select substitutes.

## Authoritative candidate layout

Research producers submit exactly one review-pending candidate directory:

```text
<batch-id>-candidate/
├── candidate.json
├── sources.jsonl
├── claims.jsonl
├── gaps.jsonl
└── review-requests.jsonl
```

`candidate.json` has `schema_version`, the canonical `batch_id`, all three canonical batch hashes (`company_list_sha256`, `effective_sequence_sha256`, and `replacement_events_sha256`), `status: review_pending`, `researcher_id`, and exact byte hashes for the four JSONL artifacts. The ledgers are in canonical 25-company order. Each company has claims or one `company-gap::<company-id>`, never both, and every outcome has one canonical `pending_independent_review` request. Pending requests are routing records, not reviews, and can never be copied into the production review ledger.

Candidate claims are immutable review inputs, not final publication records. They follow the final benefit-claim schema except that `prepublication_checked_at` is omitted and prohibited for every candidate status. That field is post-review gate state: promotion derives it for each factual claim from the latest successful exact check among that claim's bound positive sources. The compiler does not synthesize it. Candidate source and final URLs must be HTTPS, and `retained_file` provenance is rejected at candidate validation because the six-file integration format cannot carry its evidence file.

Validate it with:

```bash
python scripts/validate-company-benefits-series-candidate.py <candidate-dir> \
  --research-root docs/research/company-benefits
```

For heterogeneous scratch output, use the separate deterministic compiler. It accepts only `draft.json`, `sources.jsonl`, `claims.jsonl`, and `gaps.jsonl`, canonicalizes order, generates pending requests, hashes the result, and then invokes the production candidate validator:

```bash
python scripts/compile-company-benefits-series-candidate.py <scratch-dir> <candidate-dir> \
  --research-root docs/research/company-benefits
```

## Independent review and promotion

Independent review artifacts must be outside the repository and must contain exactly:

```text
<external-review-dir>/
├── review-bundle.json
├── reviews.jsonl
└── checks.jsonl
```

The bundle binds the exact candidate manifest hash and all candidate artifact hashes, preventing approval transfer after any candidate change. Reviews must cover every claim/gap exactly once in canonical order, be approved by someone other than the bound researcher, and precede both the exact URL post-review checks and promotion approval. Publishable source checks require status 200 plus the exact source URL, final URL, content hash, and expected marker. Metadata-only gap routes instead record exactly the candidate's `status` (including `null`, 403, or 404), `final_url`, and `access_wall`; they carry no marker or content hash and never become claim evidence. Missing, duplicate, orphan, cross-target, replayed, mutated, self-approved, stale, repository-local, or symlink-aliased review material fails closed.

Promotion emits the existing integration package and nothing else:

```bash
python scripts/promote-company-benefits-series-candidate.py \
  <candidate-dir> <external-review-dir> <approved-package-dir> \
  --research-root docs/research/company-benefits
```

## Approved integration package layout

```text
<approved-package-dir>/
├── batch.json
├── sources.jsonl
├── claims.jsonl
├── reviews.jsonl
├── gaps.jsonl
└── checks.jsonl
```

No package may include PDFs, screenshots, archives, raw responses, `evidence_path`, `evidence_file`, or `retained_file` provenance. A `nonpublishable_metadata` source follows `schema/nonpublishable-source.schema.json`: it explicitly records route quality, publication ineligibility, the nonpublication reason, entity-binding status, metadata-only retention, and reuse status. It cannot retain or assert a body, quote, content hash, expected marker, locator, or legal-entity applicability. Such a source may document a gap search route only; claim and unknown-claim source rules remain unchanged.

`batch.json` follows `schema/series-input.schema.json`. It binds the three canonical hashes and the exact bytes of all five final JSONL artifacts. Its `review_audit` preserves the reviewer-approved candidate manifest/artifact hashes and the external review/check hashes; the final `claims.jsonl` hash separately binds promotion's deterministic gate-field injection, so the audit does not imply that reviewers approved a field which did not yet exist. It is created only by promotion with `status: approved`, `reviewer_id`, and `approved_at`; empty JSONL artifacts are zero-byte files and use the SHA-256 of zero bytes.

The five ledgers use the existing source, claim, and review contracts plus these batch rules:

- every claim and explicit company gap belongs to one of the manifest's 25 company IDs;
- every company has at least one approved claim or exactly one `company-gap::<company-id>` gap, never both;
- each company gap includes Korean wording that the result does not mean the benefit is absent;
- every claim has exactly one approved independent review tagged by `claim_id`; every gap/nonclaim outcome has exactly one approved independent review tagged by `record_id` following `schema/outcome-review.schema.json`; a review must have exactly one target type, and duplicate, cross-type, or orphan targets fail;
- every used source ID resolves to either the existing registry or a new source row;
- required URL checks are the exact union of positive `source_ids`, unknown `searched_source_ids`, gap `searched_official_source_ids`, and gap `searched_official_urls`; gap checks remain nonclaim audit evidence and never become positive benefit evidence;
- every used official URL has exactly one current check after review; each factual claim's `prepublication_checked_at` equals the latest successful check timestamp among its positive sources; a shared publishable URL replaces an older check only when strictly newer with the same marker/hash, while a shared metadata route must preserve the same observed status/final URL/access-wall tuple;
- source, claim, review, and gap IDs cannot collide with any already integrated batch;
- raw evidence files and unapproved, partial, stale, or pre-review packages fail closed.

## Validation and integration

```bash
python scripts/integrate-company-benefits-series-batch.py \
  /home/bread/.hermes/profiles/conan/cache/scratch/company-benefits-series/domestic-02 \
  --research-root docs/research/company-benefits \
  --freeze-anchor-receipt /absolute/path/to/approved/freeze-anchor-receipt.json \
  --effective-selection-receipt /absolute/path/to/approved/effective-selection-receipt.json \
  --as-of 2026-10-30 \
  --dry-run
```

Remove `--dry-run` only after the staged verifier and rendered draft pass. The command merges records in deterministic ID/URL order, updates `series-progress.json`, runs the same fail-closed verifier, renders only the approved batch, and then replaces the canonical ledgers. It never approves research itself.

Each batch manifest also binds the full effective sequence SHA-256 and replacement-event ledger SHA-256. A population exclusion replaces the entity at its exact `excluded_hash_position` with the next unused canonical reserve. Existing positions and all later batch boundaries remain unchanged; global resorting after replacement is prohibited.

### Migration from the pre-chronology candidate format

Do not edit or re-hash a reviewed candidate in place. Recompile scratch claims without `prepublication_checked_at`, obtain a new independent review bundle bound to that new candidate hash, run post-review checks in the two shapes above, and promote again. Pre-existing direct approved packages without `review_audit` remain readable by the integrator for migration compatibility, but every newly promoted package emits the required audit binding; candidate validation rejects legacy retained-file and non-HTTPS inputs before review begins.

The immutable freeze receipt and replacement approval are distinct. The immutable receipt continues to bind the original freeze manifest and is never replaced by a candidate-effective digest. When replacement events are nonempty, verification additionally requires an approved repository-external receipt following `schema/effective-selection-receipt.schema.json`. That receipt binds the immutable freeze digest, effective manifest, both effective sequences, replacement-event ledger, and the candidate effective sequence digest. Missing, pending, mismatched, repository-local, workspace-local, or symlink-aliased receipts fail closed. Supply it with `--effective-selection-receipt` or `COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT`.

Use `python scripts/integrate-company-benefits-series-batch.py --help` for CLI details. Pending batches cannot render. `complete` cannot validate until all 80 batches, all 2,000 companies, 80 batch drafts, and the hub are present and no fixture marker appears in real series artifacts.
