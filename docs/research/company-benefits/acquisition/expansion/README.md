# Expansion identity candidates v1 (audit only)

This additive ledger contains 36 official registry identity candidates (27 SEC, 9 DART). It does **not** add members to the frozen 2,000-company population, establish payroll employers or benefits, approve propositions, or change any public directory/batch. Discovery-only names and raw official responses remain outside the ledger. The exact registry legal names, jurisdiction, identity locators and observation dates remain in restricted custody; source input SHA-256 and original canonical SHA-256 are pinned in `source-manifest.v1.json`. Each row is `identity_candidate` / `research_only`.

The two private inputs are not committed. Rebuild and check using their original bytes, with `EXPANSION_INPUT_ROOT` pointing to the restricted directory containing `expansion-us-candidates.json` and `expansion-kr-candidates.json`:

```sh
python3 docs/research/company-benefits/acquisition/expansion/identity_ledger.py check \
  --us "$EXPANSION_INPUT_ROOT/expansion-us-candidates.json" \
  --kr "$EXPANSION_INPUT_ROOT/expansion-kr-candidates.json"
EXPANSION_INPUT_ROOT="$EXPANSION_INPUT_ROOT" python3 -m unittest discover \
  -s docs/research/company-benefits/acquisition/expansion -p 'test_*.py' -q
```

Use `compile --output <restricted-new-path>` only for a deliberately reviewed rebuild; never write the identity ledger into the repository. The original `candidates.v1.jsonl` is held in a restricted archive selected by `EXPANSION_ARCHIVE_ROOT` (or the profile data directory). A changed private source, canonical ledger, collision, count, provenance or locator aborts compilation. A subsequent expansion needs a separately reviewed versioned inventory, not a change to these pinned v1 bytes. Nothing here is eligible for promotion without separate benefit evidence and independent review.
