# Fourth official-source audit wave

This separate **local audit-only** inventory covers the exact disjoint selected employers in `domestic-12` through `domestic-15` and `international-05`. Its 620 private producer observation rows (87/92/188/111/142) cover 125 employers: 67 have research leads; 58 remain `research_incomplete`, which does **not** establish absence. These rows are not independently deduplicated propositions. **Approved benefits: 0.** Existing verified ledgers and public artifacts are unchanged.

Each projected row retains canonical employer ID/name, category hint, HTTPS source URL when safe, one-based private batch/row pointer, SHA-256 digests of the producer statement and eligibility note, and unreviewed rights status. It contains no statement, quote, scope text, response body, or private absolute path. A digest and category hint are not a benefit description. Insecure producer locators are retained **only in private custody**; the projected URL is null with a digest and `http_research_only_unpublishable` status, never an inferred HTTPS counterpart. Coverage likewise omits insecure destinations and retains their digests. All 142 US observations preserve `entity_binding: unproven`: the selected payroll/legal entity and policy-owner link are not established. No row is claim-eligible.

The rebuild checks pinned private file digests, all producer manifest SHA-256 declarations, exact canonical 25-ID membership and legal names in each batch, disjointness, per-company observation counts, review flags, entity binding, credential-free URL authority, and declared outcome totals. With restricted private producer inputs available:

```sh
python3 docs/research/company-benefits/acquisition/normalize_official_wave_fourth.py --input-root "$PRIVATE_INPUT_ROOT" --check
python3 docs/research/company-benefits/acquisition/test_official_wave_fourth.py
```

Omit `--check` only to regenerate the three machine-readable files here. Independent source-rights, identity, currentness, eligibility, proposition deduplication and semantic review remain necessary before any approval or publication. No command here changes public output or reaches the network.
