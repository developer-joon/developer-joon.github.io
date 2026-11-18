# Official-wave research metadata (domestic-04–06)

`official-wave/` is a separate **local audit-only** projection, not part of `research-leads.jsonl`, the verified ledger, promotion, or public artifacts. The 863 rows are producer observations across 59 firms, **not 863 independently distinct or approved benefits**. All 75 selected firms are accounted for; 16 have `research_incomplete` outcomes. No absence finding follows from an incomplete outcome. Approved benefits: **0**.

Each lead retains its batch, frozen company/legal name, source URL, category hint, producer row number, SHA-256 of the producer statement, and eligibility/scope note. The `statement` is deliberately a conservative category-level paraphrase rather than the producer's potentially verbatim excerpt. It does **not** preserve the specific benefit wording: inspect the hash-bound private source and independently review the exact proposition before any use beyond audit. No producer quote, raw page, response body, full extraction, or local input path is projected. Rights are `unreviewed` even for official URLs.

`manifest.json` pins SHA-256 of each of the nine immutable inputs, canonical ledgers, output digests, exact per-batch company coverage and outcome counts. The normalizer checks pinned inputs, producer manifest checksums, frozen membership, canonical legal names, row-level counts and outcome consistency. Rebuild and test locally with the private input root supplied by the operator:

```sh
python3 docs/research/company-benefits/acquisition/normalize_official_wave.py --input-root "$OFFICIAL_WAVE_INPUT_ROOT" --check
python3 docs/research/company-benefits/acquisition/test_official_wave.py
```

Omit `--check` only to regenerate the three `official-wave/` files. This workflow has no network or approval/promotion side effects. The private source is required for a full reproducibility check; the committed projection and hashes remain an audit trail if the source becomes unavailable.
