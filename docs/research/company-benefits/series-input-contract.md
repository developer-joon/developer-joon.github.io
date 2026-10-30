# Company benefits series batch input contract

The full series is partitioned by `series-batches.jsonl`. It is the only authority for batch IDs, canonical company order, company IDs, legal-entity boundaries, and each 25-company list SHA-256. Agents must not reconstruct a batch from names or select substitutes.

## Scratch package layout

Prepare one directory outside the repository, preferably:

```text
/home/bread/.hermes/profiles/conan/cache/scratch/company-benefits-series/<batch-id>/
├── batch.json
├── sources.jsonl
├── claims.jsonl
├── reviews.jsonl
├── gaps.jsonl
└── checks.jsonl
```

No other file or subdirectory is accepted. In particular, do not include PDFs, screenshots, archives, raw responses, `evidence_path`, `evidence_file`, or `retained_file` provenance. The package is metadata-only.

`batch.json` follows `schema/series-input.schema.json`. It binds `company_list_sha256`, `effective_sequence_sha256`, and `replacement_events_sha256` from the canonical batch manifest. Its `artifacts` object contains the SHA-256 of the exact bytes of each of the five JSONL files. `status` must be `approved`; `reviewer_id` and `approved_at` identify the batch approval. Empty JSONL artifacts are zero-byte files and use the SHA-256 of zero bytes.

The five ledgers use the existing source, claim, and review contracts plus these batch rules:

- every claim and explicit company gap belongs to one of the manifest's 25 company IDs;
- every company has at least one approved claim or exactly one `company-gap::<company-id>` gap, never both;
- each company gap includes Korean wording that the result does not mean the benefit is absent;
- every claim has exactly one approved independent review tagged by `claim_id`; every gap/nonclaim outcome has exactly one approved independent review tagged by `record_id` following `schema/outcome-review.schema.json`; a review must have exactly one target type, and duplicate, cross-type, or orphan targets fail;
- every used source ID resolves to either the existing registry or a new source row;
- required URL checks are the exact union of positive `source_ids`, unknown `searched_source_ids`, gap `searched_official_source_ids`, and gap `searched_official_urls`; gap checks remain nonclaim audit evidence and never become positive benefit evidence;
- every used official URL has exactly one current check after review and bound to the claim's `prepublication_checked_at`; a shared URL deterministically replaces an older canonical check only when the new check is strictly newer, post-review, and has the same marker and content hash, otherwise integration fails;
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

The immutable freeze receipt and replacement approval are distinct. The immutable receipt continues to bind the original freeze manifest and is never replaced by a candidate-effective digest. When replacement events are nonempty, verification additionally requires an approved repository-external receipt following `schema/effective-selection-receipt.schema.json`. That receipt binds the immutable freeze digest, effective manifest, both effective sequences, replacement-event ledger, and the candidate effective sequence digest. Missing, pending, mismatched, repository-local, workspace-local, or symlink-aliased receipts fail closed. Supply it with `--effective-selection-receipt` or `COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT`.

Use `python scripts/integrate-company-benefits-series-batch.py --help` for CLI details. Pending batches cannot render. `complete` cannot validate until all 80 batches, all 2,000 companies, 80 batch drafts, and the hub are present and no fixture marker appears in real series artifacts.
