# Three-country research-only source inventory v1

This is a fail-closed baseline for future KR/US/JP research, **not** an acquired-source ledger, benefit evidence, an approval, a new company population, or a coverage receipt. The three official DART, SEC and NTA links in `source-inventory.v1.json` are **locators only**; every source remains `not_acquired`. Private workers' fetches and observations are not represented here. Do not infer that any company or category was researched from this inventory.

The inventory pins the original 2,000-company `companies.jsonl`, 80 `series-batches.jsonl` records, and both **private** expansion identity-candidate files (36 + 35 = 71 candidates) by exact SHA-256 and line count. Set `EXPANSION_ARCHIVE_ROOT` to their restricted archive if it differs from the profile default. Those candidates are identity-only research leads, not additions to the frozen population. The checker independently fixes these pins and the three HTTPS locator URLs; editing JSON alone cannot bless changed inputs, source status, counts, or unsafe URLs. It does not fetch any URLs or verify their current content.

From repository root:

```sh
python3 docs/research/company-benefits/acquisition/three_country_pilot/test_pilot_contract.py check
python3 -m unittest discover -s docs/research/company-benefits/acquisition/three_country_pilot -p 'test_*.py' -q
```

Any subsequent acquisition needs a separately reviewed, source-bound version with real capture provenance. No coverage target or completion claim is made by this baseline.
