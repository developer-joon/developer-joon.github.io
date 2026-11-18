# Expansion identity candidates v2 (audit only)

This separately versioned ledger adds 35 identity candidates (25 SEC, 10 DART) to the *research pool*, not the frozen 2,000-company series or the v1 36-identity pool. Exact registry legal name, jurisdiction, identity URL and observation date are restricted private per-company fields pending reuse-rights review. Every row is `identity_candidate` / `research_only`: SEC issuer or DART corporation identity does not establish the payroll employer, benefit eligibility, a verified proposition, or a public directory entry. Discovery-only entities, careers evidence, quotes and raw registry responses are not published here.

`source-manifest.v2.json` pins the two private second-wave inputs, the canonical population/batches, and the v1 ledger and manifest. The compiler checks exact CIK/CRN and registry URL, legal-name and ID disjointness from the entire original population **and** v1, candidate counts and source lineage. Neither v1 nor the canonical population is modified. The source observations are not a fresh registry re-fetch by this checker.

With `EXPANSION_V2_INPUT_ROOT` pointing to the restricted directory containing `expansion-us-second-candidates.json` and `expansion-kr-second-candidates.json`:

```sh
python3 docs/research/company-benefits/acquisition/expansion/identity_ledger_v2.py check \
  --us "$EXPANSION_V2_INPUT_ROOT/expansion-us-second-candidates.json" \
  --kr "$EXPANSION_V2_INPUT_ROOT/expansion-kr-second-candidates.json"
EXPANSION_V2_INPUT_ROOT="$EXPANSION_V2_INPUT_ROOT" python3 -m unittest discover \
  -s docs/research/company-benefits/acquisition/expansion -p 'test_identity_ledger_v2.py' -q
```

Use `compile --output <restricted-new-path>` only for a deliberately reviewed private rebuild from those exact pinned bytes. The original `candidates.v2.jsonl` is held in the restricted archive, not in Git. Any source change requires a new provenance decision and manifest version, not a silent mutation of v1/v2. Identity-only candidates require separate benefit acquisition and independent review before promotion.
