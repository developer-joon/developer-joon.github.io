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
├── review-requests.jsonl
├── company-category-cells.jsonl
├── research-attempts.jsonl
├── official-claims-v2.jsonl
├── reference-records.jsonl
├── community-benefit-reports.jsonl
└── sources-v2.jsonl
```

`candidate.json` has `schema_version`, the canonical `batch_id`, all three canonical batch hashes (`company_list_sha256`, `effective_sequence_sha256`, and `replacement_events_sha256`), `status: review_pending`, `researcher_id`, and exact byte hashes for all ten JSONL artifacts. The v2 cell ledger must equal—not merely count to—the canonical Cartesian product of the batch's 25 selected company IDs and the ten categories `leave,family,health,growth,housing,commute,remote,retirement,meals,inclusion`. Missing, duplicate, or substituted cells fail before review. The ledgers are in canonical company/category order. Each company also has legacy claims or one `company-gap::<company-id>`, never both, and every legacy outcome has one canonical `pending_independent_review` request. Pending requests are routing records, not reviews, and can never be copied into the production review ledger.

Every explicit cell binds its real attempt receipts and any v2 official claims, references, or community reports. The production `validate-benefits-v2-package.py` contract is applied unchanged after the batch set gate: IDs, content hashes, source discovery, same-cell bindings, coverage-policy routes, and orphan detection all fail closed. A capture or response copied across cells is prohibited unless it carries the policy's explicit per-entity shared-bulk binding. Community evidence is accepted only when it is eligible, moderator-approved, frozen, and bound to the same cell. The compiler sorts and hashes supplied records but never generates attempts, evidence, or `no_public_info` cells.

Candidate claims are immutable review inputs, not final publication records. They follow the final benefit-claim schema except that `prepublication_checked_at` is omitted and prohibited for every candidate status. That field is post-review gate state: promotion derives it for each factual claim from the latest successful exact check among that claim's bound positive sources. The compiler does not synthesize it. Candidate source and final URLs must be HTTPS, and `retained_file` provenance is rejected at candidate validation because the approved-package format cannot carry its evidence file.

Mutable SEC submissions responses may use the single `official_identity_projection` provenance mode. It is restricted to official regulator/register sources and identity-only `supported_fields`; it can never appear in a factual claim's positive `source_ids`. The source declares `normalization: {algorithm: sec-submissions-identity, version: "1", projection_sha256}` and uses that projection digest as `content_sha256`. Version 1 canonicalizes only the live response's top-level `cik`, `name`, and `ein` as UTF-8 canonical JSON bytes `{"cik":"<10-digit zero-padded CIK>","legal_name":"<exact name>","ein":"<exact EIN>"}`. Unrelated filing-array changes therefore do not invalidate identity evidence, while any CIK, legal-name, or EIN drift does. No normalized prose, benefit statement, quote, filing section, or caller-selected field set is allowed.

Validate it with:

```bash
python scripts/validate-company-benefits-series-candidate.py <candidate-dir> \
  --research-root docs/research/company-benefits
```

For heterogeneous scratch output, use the separate deterministic compiler. It accepts `draft.json`, the three legacy input ledgers, and all six v2 ledgers; canonicalizes order; generates only legacy pending review requests; hashes the result; and invokes the production candidate validator. It does not synthesize v2 records:

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

The bundle binds the exact candidate manifest hash and all candidate artifact hashes, preventing approval transfer after any candidate change. Reviews must cover every claim/gap exactly once in canonical order, be approved by someone other than the bound researcher, and precede both the exact source checks and promotion approval. Every check names one `source_id`, and the check set covers every bound candidate source ID exactly once. Distinct records may share an official ZIP/PDF URL while retaining different locators, markers, and hashes. Publishable claim/unknown-claim source checks require status 200 plus the exact source ID, source URL, final URL, content hash, and expected marker. An identity-projection check additionally carries the fixed algorithm/version, the actual response's `cik`/`name`/`ein`, and the projection digest; promotion and integration recompute the canonical projection and reject any mismatch. Metadata-only gap routes instead record exactly the candidate's `status` (including `null`, 403, or 404), `final_url`, and `access_wall`; they carry no marker or content hash and never become claim evidence. Missing, duplicate, orphan, cross-source, replayed, mutated, self-approved, stale, repository-local, or symlink-aliased review material fails closed.

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
├── checks.jsonl
├── company-category-cells.jsonl
├── research-attempts.jsonl
├── official-claims-v2.jsonl
├── reference-records.jsonl
├── community-benefit-reports.jsonl
└── sources-v2.jsonl
```

No package may include PDFs, screenshots, archives, raw responses, `evidence_path`, `evidence_file`, or `retained_file` provenance. A `nonpublishable_metadata` source follows `schema/nonpublishable-source.schema.json`: it explicitly records route quality, publication ineligibility, the nonpublication reason, entity-binding status, metadata-only retention, and reuse status. It cannot retain or assert a body, quote, content hash, expected marker, locator, or legal-entity applicability. Such a source may document a gap search route only; claim and unknown-claim source rules remain unchanged.

`batch.json` follows `schema/series-input.schema.json`. It binds the three canonical hashes and the exact bytes of all eleven final JSONL artifacts. Its required `review_audit` preserves the full canonical candidate manifest and external review bundle as well as their hashes and artifact maps. Integration reconstructs the candidate claims and review requests, reruns the authoritative candidate and promotion-review contracts, and proves that the reviewed candidate plus exact checks produce the final promoted claims. The final `claims.jsonl` hash separately binds promotion's deterministic gate-field injection, so the audit does not imply that reviewers approved a field which did not yet exist. It is created only by promotion with `status: approved`, `reviewer_id`, and `approved_at`; empty JSONL artifacts are zero-byte files and use the SHA-256 of zero bytes.

The legacy and v2 ledgers use their existing source, claim, review, and evidence contracts plus these batch rules:

- every claim and explicit company gap belongs to one of the manifest's 25 company IDs;
- every company has at least one approved claim or exactly one `company-gap::<company-id>` gap, never both;
- each company gap includes Korean wording that the result does not mean the benefit is absent;
- every claim has exactly one approved independent review tagged by `claim_id`; every gap/nonclaim outcome has exactly one approved independent review tagged by `record_id` following `schema/outcome-review.schema.json`; a review must have exactly one target type, and duplicate, cross-type, or orphan targets fail;
- every used source ID resolves to either the existing registry or a new source row;
- required checks are the exact union of positive `source_ids`, unknown `searched_source_ids`, and gap `searched_official_source_ids`; raw `searched_official_urls` must first be migrated to explicit source records, and gap checks remain nonclaim audit evidence rather than positive benefit evidence;
- every used official source ID has exactly one current check after review; each factual claim's `prepublication_checked_at` equals the latest successful check timestamp among its positive sources; a repeated source ID replaces its older check only when strictly newer with the entire source tuple unchanged, while multiple source IDs may legitimately share one URL;
- source, claim, review, and gap IDs cannot collide with any already integrated batch;
- raw evidence files and unapproved, partial, stale, or pre-review packages fail closed.
- each approved v2 progress entry records `cell_count: 250`, a deterministic `cell_set_sha256`, and `v2_ledger_sha256` hashes over the full canonical payloads of all six batch slices; pending entries record zero and cannot retain v2 cells. Whole-series completion requires exactly 20,000 explicit cells. Verification reruns the authoritative v2 validator on every approved batch slice and on the complete merged ledgers, so orphan/cross-batch records, ID collisions, copied receipts, and payload tampering fail before publication.

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

Remove `--dry-run` only after the staged verifier and rendered draft pass. The command merges records in deterministic ID/source-check order, updates `series-progress.json`, runs the same fail-closed verifier, renders only the approved batch, and then replaces the canonical ledgers. It never approves research itself.

Each batch manifest also binds the full effective sequence SHA-256 and replacement-event ledger SHA-256. A population exclusion replaces the entity at its exact `excluded_hash_position` with the next unused canonical reserve. Existing positions and all later batch boundaries remain unchanged; global resorting after replacement is prohibited.

### Migration from URL-keyed checks and full-response SEC hashes

Do not edit or re-hash a reviewed candidate in place. For every source-bound URL check, add the exact candidate `source_id`; if one URL supported multiple records, emit one independently bound check per source ID with that record's final URL, marker, and digest. Replace each raw gap `searched_official_urls` entry with a metadata-only or publishable source record and list its ID in `searched_official_source_ids`. URL-keyed check ledgers are not accepted by the new promoter/integrator.

For SEC submissions identity evidence, recompute version 1 from the live official response's top-level `cik`, `name`, and `ein`, set both `normalization.projection_sha256` and `content_sha256` to that digest, and use `official_identity_projection`. Do not convert SEC benefit prose or filing claims to normalized provenance; those retain exact full-response/artifact hashing. Recompile the candidate, obtain a new independent review bundle bound to its new hashes, rerun all source-ID checks after review, and promote again. Legacy approved progress entries with no v2 cells remain readable, but no v2 integration package may omit `review_audit`, and an approved legacy entry can never be replayed through the pending-batch integration path.

The immutable freeze receipt and replacement approval are distinct. The immutable receipt continues to bind the original freeze manifest and is never replaced by a candidate-effective digest. When replacement events are nonempty, verification additionally requires an approved repository-external receipt following `schema/effective-selection-receipt.schema.json`. That receipt binds the immutable freeze digest, effective manifest, both effective sequences, replacement-event ledger, and the candidate effective sequence digest. Missing, pending, mismatched, repository-local, workspace-local, or symlink-aliased receipts fail closed. Supply it with `--effective-selection-receipt` or `COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT`.

Use `python scripts/integrate-company-benefits-series-batch.py --help` for CLI details. Pending batches cannot render. `complete` cannot validate until all 80 batches, all 2,000 companies, 80 batch drafts, and the hub are present and no fixture marker appears in real series artifacts.
