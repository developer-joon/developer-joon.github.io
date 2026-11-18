# Unapproved acquired benefit leads

`research-leads.jsonl` is a **local audit-only research inventory**, not a verified-benefits ledger, approval receipt, promotion package, or public projection. Every row has `evidence_level: research_only`. Do not feed it to publication or count its rows as validated benefits. The `provisional_group_keys` count is a mechanical key count from reviewer-provided grouping hints, **not** a cross-wave, independently validated number of distinct benefits. Rows with no group remain ungrouped.

`normalize_research_leads.py` projects the exact producer candidate rows from twelve named lanes, joins independent triage where present, checks the frozen batch membership, validates present bytes against input `SHA256SUMS`, and generates the JSONL and manifest deterministically. The 429 included rows are **raw producer leads**; one additional `allowed-priority-a/whanin.candidates.jsonl` row is an explicit zero-positive route outcome, omitted from the benefit-lead inventory. The manifest records each lane's count, candidate/review file digests, and checksum status. `domestic-03-a` has no `SHA256SUMS`, and its original destination bodies are absent; no checksum or quote verification is implied. Prohibited Uniquest, Intellian, TSE and E1 captures, and conservatively deleted Cosmo pilot captures, are tombstoned rather than copied or regenerated. Historical checksum entries for deleted bytes are not byte-verifiable.

Rights are attached to **one exact claim-specific source-registry record**, selected only by URL, legal entity, supporting quote, and that record's explicit quote permission. An unrelated `nonpublishable_metadata` route at the same URL is not treated as a revocation of a claim-source record. A short quote and attribution appear only when that specific record permits quotation; otherwise only URL, digest, proposition and blocker metadata remain. This does not resolve publication rights, legal-employer identity, current policy, taxonomy, or independent promotion review. Unresolved rights stay `research_only` even if a producer supplied a quote. The source-registry hash in the manifest binds the registry snapshot used for this classification.

Rebuild or check locally (no network, promotion, or writes outside this directory):

```sh
python3 docs/research/company-benefits/acquisition/normalize_research_leads.py \
  --input-root ${HERMES_HOME}/cache/scratch/mixed-benefit-acquisition \
  --registry docs/research/company-benefits/source-registry.jsonl --check
python3 docs/research/company-benefits/acquisition/test_research_leads.py
```

Scratch is transient; after its deletion, the committed normalized rows, source/reviewer checksums and documented missing-byte status remain auditable, but original source bodies cannot be reconstructed from a digest. Reacquire and independently review permitted evidence before any separate promotion workflow.
