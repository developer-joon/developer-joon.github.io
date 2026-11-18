# Revisit research index

`revisit-index.jsonl` is an append-only **research-only** projection of checksum-pinned private revisit producer files. It is not a benefits ledger, does not alter `wave-index.jsonl`, and must never contribute to `specific_benefit_count`. All rows have `approved_count: 0` and `rights_unreviewed`; the KT coverage row remains `research_incomplete`. The seven US observations describe **2025 SEC plans**, not proof of current policy or selected payroll-employer scope.

The private root must retain each `{domestic,international}-revisit-{observations.jsonl,coverage.jsonl,manifest.json}` and the referenced original `{parent_batch}/coverage.jsonl` files. The latter are verified against the producer's prior-coverage checksums and the canonical batch membership. Do not commit these private files. The public projection contains only line pointers, canonical IDs, counts, validated credential-free HTTPS destination URLs, and statement/quote digests—never literal quotes, statements, raw bodies, or local private paths.

```sh
ROOT=/path/to/restricted/producer-root
python3 docs/research/company-benefits/acquisition/revisit_index.py add domestic --input-root "$ROOT"
python3 docs/research/company-benefits/acquisition/revisit_index.py add international --input-root "$ROOT"
python3 docs/research/company-benefits/acquisition/revisit_index.py check --input-root "$ROOT"
OFFICIAL_WAVE_INPUT_ROOT="$ROOT" python3 -m unittest discover -s docs/research/company-benefits/acquisition -p 'test_*.py' -q
```

`add` rejects duplicates and drift in existing pinned inputs or index before appending. `check` recomputes the complete projection and refuses any checksum, canonical, original zero-coverage, count, URL, or output drift. Missing private quotes are rejected unless the producer explicitly marks `quote_absence_permitted: true`; no missing text is fabricated. HTTP or credential-bearing URLs fail ingestion rather than being silently upgraded.
