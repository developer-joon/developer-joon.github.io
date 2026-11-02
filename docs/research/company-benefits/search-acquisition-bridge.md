# Search acquisition bridge

This bridge plans locale-aware search-tool discovery while keeping it separate from authoritative Task 5 receipts.

## Query and identity rules

- Korean plans preserve the canonical legal display name and may add only a legal-designator-stripped alias. A derived alias is suppressed when it collides with another canonical company. No fuzzy alias can establish entity acceptance.
- `company_id` remains in every manifest entry and acquisition binding, but CRNs are never placed in public search queries.
- All ten category IDs have Korean terms and synonyms. Route profiles are deterministic: official/government adds `공식 회사 채용 정부`, recruiting/media adds `채용 복리후생`, and other web adds `복지`.
- Queries quote the exact safe alias and use separate terms. They do not depend on search-backend `OR` support.

## Two-stage acquisition

Each company has three ready broad-discovery queries, one per route. Broad results can become distinct per-cell review candidates only when a URL or snippet explicitly supports that category. They never prove absence.

Each of the ten cells also has three deferred category-gap queries. Before `no_public_info`, `validate_no_public_info_coverage` requires all three category-specific query receipts for that exact company and category. Broad receipts are ignored by this gate.

`split domestic-01` emits five disjoint five-company units. Every unit contains 15 ready broad queries and 150 deferred category queries. `validate-splits` fails unless ownership is unique and the aggregate is exactly 25 companies and 250 cells.

## Audit boundaries

- Query IDs use the separate `search-query::` namespace. They are not `attempt::` receipts.
- `ingest` retains the exact UTF-8 JSON bytes returned by `web_search`, the query, retrieval time, backend/served-by metadata when supplied, and explicit result ordering in a repository-external content-addressed capture.
- Results are validated independently. Only bounded results with unique bounded positions and public HTTPS URLs become `unreviewed_lead` records. Unsafe results are omitted without discarding safe siblings.
- A format-v2 acquisition has `acquisition_status: complete_with_omissions` once a complete tool response has been processed. It records total, retained, and dropped counts plus deterministic omission-reason totals. Zero retained leads is still a complete route receipt; it is not `source_found` or `no_public_info`.
- Per-result diagnostics remain in the repository-external capture. They contain only the original position, reason code, bounded scheme, and SHA-256 of an unsafe URL; they never copy an unsafe URL or credential value into the acquisition output. The immutable capture still binds the exact original response bytes and raw-response hash.
- Response-level malformed JSON, truncation/size violations, excess result counts, tool errors, and secret-bearing non-URL content still fail closed and cannot become complete receipts.
- Every retained result and every acquisition remains `review_pending` with `authoritative_receipts_created: false`. Keywords and route completion never establish `source_found`, `no_public_info`, or a cell state.
- Independent entity/category review and source retrieval remain required before a candidate package can be compiled or promoted.

## Direct public-page acquisition

`ingest-direct` accepts the exact JSON response bytes from a direct retrieval tool for one canonical public HTTPS locator. It applies the same DNS, URL credential, secret, privacy, UTF-8, and byte-bound checks as search ingestion; requires the returned URL to equal the requested locator; and stores the exact response bytes in an external content-addressed capture.

The format-v2 receipt is bound to one company, category cell, and canonical route. Its status is `complete`, while its result remains `direct_source` / `unreviewed_lead`, `review_pending`, and `authoritative_receipts_created: false`. The normalizer may use that receipt only to prove cell-local source discovery; it does not approve evidence or alter the reviewed cell decision.

Schemas:

- `schema/search-acquisition-query-manifest.schema.json`
- `schema/search-tool-acquisition.schema.json`
- `schema/direct-page-acquisition.schema.json`

## Split and validate the pilot

```bash
python3 scripts/company_benefits_search_bridge.py split domestic-01 \
  docs/research/company-benefits/acquisition/domestic-01 \
  --created-at 2026-11-02T00:00:00Z

python3 scripts/company_benefits_search_bridge.py validate-splits domestic-01 \
  docs/research/company-benefits/acquisition/domestic-01/domestic-01-acquisition-{01,02,03,04,05}.json
```

The five units may be acquired in parallel. Within each company, run the three broad queries first; reviewers may then select explicit category candidates and run all deferred routes for unresolved cells. Save each exact tool response and ingest it separately:

```bash
python3 scripts/company_benefits_search_bridge.py ingest \
  UNIT.json 'search-query::COMPANY::broad::ROUTE' \
  /external/raw-response.json /external/acquisition.json \
  --capture-root /external/search-tool-captures
```

The capture root must remain outside the repository. Do not copy raw tool responses into the tracked tree.
