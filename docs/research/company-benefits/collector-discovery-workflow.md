# Company-benefits collector discovery workflow

`collect-company-benefits-v2.py` writes a **collector discovery artifact**, not an authoritative v2 review package. The artifact contains immutable capture-bound attempt receipts and discovery-only sources. It intentionally contains no cell decisions.

## Boundary

1. Run the collector with a repository-external `--capture-root`. Checkpoints and captures reject traversal, symlinks, and special files.
2. Validate the output against `schema/collector-discovery-artifact.schema.json` and retain its `artifact_content_sha256`.
3. Independently review every company/category cell. Each decision must explicitly bind its reviewed `attempt_ids`.
4. Call `discovery_to_review_package(...)` with those decisions. Conversion fails unless every discovery attempt is bound exactly once.
5. Only after conversion run `scripts/validate-benefits-v2-package.py`. The authoritative package validator is not applicable to raw collector output.

An `official-company` request uses an official domain only when that authority is present in canonical reviewed company data. Batch input cannot override it. When canonical data has no domain, the collector uses a legal-entity-bound generic official-company query and does not invent a host.

DNS, each connection/read operation, retries, and the total fetch have explicit bounds. Signed or credential-bearing URLs and persisted strings are rejected.
