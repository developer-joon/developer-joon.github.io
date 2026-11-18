# Sixth official-source audit wave

This separate **local audit-only** inventory preserves 558 private producer observation rows across the exact 100 disjoint selected employers in `domestic-20` through `domestic-23` (108/150/155/145). Forty-five employers have research leads; 55 remain `research_incomplete`, which does **not** establish absence. Producer rows are not independently deduplicated propositions. **Approved benefits: 0.** Verified ledgers and public artifacts are unchanged.

Each lead retains canonical employer ID/name, category hint, HTTPS source URL when safe, one-based private batch/row pointer, SHA-256 digests of the producer statement and eligibility note, and unreviewed rights status. It contains no verbatim statement, quote, response body, scope text or private absolute path. A digest and category hint are not a benefit description. Insecure producer locators stay in private custody; projected URLs are null with a digest and `http_research_only_unpublishable` status, never an inferred HTTPS counterpart. Coverage omits insecure destinations and retains their digests. No row is claim-eligible.

The rebuild checks pinned private file digests, producer manifest SHA-256 declarations (including heterogeneous canonical-file keys), canonical 25-ID membership and legal names per batch, disjointness, per-company observation counts, review flags, credential-free URL authorities and declared totals. With restricted private inputs available:

```sh
python3 docs/research/company-benefits/acquisition/normalize_official_wave_sixth.py --input-root "$PRIVATE_INPUT_ROOT" --check
python3 docs/research/company-benefits/acquisition/test_official_wave_sixth.py
```

Omit `--check` only to regenerate the three machine-readable files here. Independent source-rights, entity, currentness, eligibility, deduplication and semantic review remain necessary before approval or publication. Neither command modifies public output or reaches the network.
