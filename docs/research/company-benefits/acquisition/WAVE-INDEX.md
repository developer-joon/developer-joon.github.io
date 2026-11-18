# Pinned research-wave index (schema 1)

`research-wave-inputs.json` pins an ordered, append-only `batches` array. Each entry has a canonical `batch_id` and SHA-256 digests of exactly `manifest.json`, `coverage.jsonl`, and `observations.jsonl` in a **private** `<input-root>/<batch_id>/` directory. Never commit that directory. No filesystem discovery or latest-file selection occurs. Future batches use the same script; do not add another normalizer.

```
python3 docs/research/company-benefits/acquisition/wave_index.py add-wave domestic-28 --input-root /path/to/private/benefit-batch-wave
python3 docs/research/company-benefits/acquisition/wave_index.py check --input-root /path/to/private/benefit-batch-wave
python3 -m unittest docs/research/company-benefits/acquisition/test_wave_index.py
```

`add-wave` rejects duplicate IDs and existing index drift, verifies all pinned inputs and canonical membership before replacing the pin file and index. `regenerate` explicitly rebuilds from the pins; `check` compares deterministic bytes without writing. Use `--pins`, `--output`, and `--canonical-root` for isolated testing. Keep the private root available for future checks. A process crash between the two atomic file replacements requires `regenerate` to restore index parity; validation errors cause no writes.

The one `wave-index.jsonl` contains a header, 25 coverage records per batch, then observation records with stable `batch_id` + `line` private pointers. Counts are raw research rows, not deduplicated or approved benefits. Statement and quote bytes remain private; only their SHA-256 hashes appear. Source and binding URLs are admitted only as credential-free HTTPS; plain HTTP is replaced with null and its SHA-256. No private absolute paths, source body, quote, or generic substitute benefit copy is committed. `entity_binding` and `historical` preserve US research qualifications, but **all rows remain research-only, unreviewed, and ineligible for claims**.

Producer adapters accept manifest digests under `files` (string or `{sha256, rows/count}`), `file_sha256`, `files_sha256`, or `sha256`; coverage counts under `count`, `observation_count`, `lead_count`, `positive_lead_count`, or `research_only_count`. Membership/legal names are checked against canonical series ledgers. Historical official-wave snapshots and their normalizers remain untouched.
