# Second official-source wave: domestic-07, domestic-08, international-04

This is a **local, audit-only research inventory**, separate from `official-wave/` (v1), verified ledgers, promotion, and public content. The exact 75 selected employers have 274 producer observation rows across 37 employers (132/110/32 by batch); 38 employers remain research-incomplete (13/15/10). These are not independently deduplicated propositions or approved benefits. **Approved: 0.** No incomplete outcome implies an absence of benefits.

Every lead retains its frozen company ID/name, original batch and one-based row number, source URL, category hint, SHA-256 of the private producer statement and scope note, and unreviewed rights status. Statements and scope notes are intentionally **not projected**: their exact paraphrase/quote status has not been adjudicated. The private origin pointer identifies the restricted file and row; the full original remains outside the repository. No quote, response body, extraction, private path, or category-only public benefit description is included. Coverage preserves checked destination URLs, row counts, outcomes and blocker digests, not source excerpts. US `entity_binding` is reproduced exactly from the producer: only three rows are marked `proven`, and even those remain research-only pending independent review; the other 29 are `unproven` and never eligible for publication by this inventory.

`manifest.json` binds the nine restricted input files and canonical ledgers by SHA-256 and records batch-level counts. The normalizer verifies each producer manifest (including string and object-form file declarations), exact canonical 25-ID/legal-name membership per batch, disjointness, row counts, outcomes, HTTPS credential-free URLs, review status, and binding counts. Regenerate or check locally with restricted producer custody available:

```sh
python3 docs/research/company-benefits/acquisition/normalize_official_wave_next.py --input-root ${HERMES_HOME}/data/benefit-batch-wave --check
python3 docs/research/company-benefits/acquisition/test_official_wave_next.py
```

Omit `--check` only to regenerate `official-wave-next/{leads.jsonl,coverage.jsonl,manifest.json}`. Neither command reaches the network or approves, promotes, or publishes a benefit. The retained hashes and private origin pointers support later rights, identity, scope, currentness, proposition and deduplication review; they are not independent review receipts.
