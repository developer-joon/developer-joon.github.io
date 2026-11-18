# External company-benefits work controller

`scripts/company_benefits_work_controller.py` freezes and reconciles repository-external protocol-2 work. It is orchestration tooling only: it does not discover evidence, adjudicate evidence, approve a candidate, promote a package, or use `series-progress.json` as a queue.

## Trust boundary

The external root must already exist, be owned by the effective user, be a real directory (not a symlink), and have no group or world permissions. External inputs and artifact paths are opened component-by-component relative to a pinned root descriptor; every component is no-follow and the final object must be a bounded regular file. Intermediate symlink escapes, FIFOs/special files, and oversized inputs fail closed. Assignments, ledger rows, and scratch directories are immutable/no-overwrite outputs. Keep the root outside this repository.

Canonical assignment reads only `series-batches.jsonl` and `companies.jsonl`. One assignment freezes the canonical batch hashes, 25 ordered legal identities, all 250 exact `cell::<company-id>::<category>` IDs, and six disjoint acquisition lanes (42/42/42/42/41/41 cells). Reusing an assignment ID is allowed only as an exact restart replay. A successor names the immutable digest of one prior same-batch assignment with `--supersedes`; the controller recomputes that predecessor's digest and rebinds every frozen batch hash, company ID, and legal authority to the current canonical ledgers before accepting the link.

```bash
python scripts/company_benefits_work_controller.py create-assignment \
  --external-root /private/preexisting/work \
  --series-batches docs/research/company-benefits/series-batches.jsonl \
  --companies docs/research/company-benefits/companies.jsonl \
  --batch-id domestic-01 --assignment-id domestic-01-wave-01 \
  --created-at 2026-11-15T00:00:00Z
```

## Append-only work ledger

`work-ledger.jsonl` is a hash chain. Its allowed stages are `canonical_assignment`, `acquisition_shard`, `identity_audit`, `neutral_aggregate`, `candidate`, `review`, and `promotion`. Receipt-ID replay is idempotent only when all immutable fields match. Operators append a receipt after independently verifying each stage artifact; a receipt records work state, never an evidence decision.

```bash
python scripts/company_benefits_work_controller.py append-receipt \
  --external-root /private/preexisting/work --receipt-id assignment-01 \
  --stage canonical_assignment --subject-sha256 SHA256 \
  --recorded-at 2026-11-15T00:00:01Z \
  --details-json '{"assignment_id":"domestic-01-wave-01"}'
```

## Neutral aggregate input

The identity-audit receipt binds the assignment digest and exactly 25 ordered rows with canonical `company_id`, `legal_name`, `jurisdiction`, `registry_id`, and `status: matched`.

Each of the six shard receipts binds one assigned lane, its exact ordered cell IDs, a bounded artifact inventory, and one explicit reviewed disposition per cell. Every disposition repeats the assigned `company_id`, `category_id`, and canonical jurisdiction exactly; supplies its production-shaped cell and attempt rows; binds one distinct source → exact attempt receipt → retained capture chain for every attempt; states closure for all three; includes reviewer identity/time distinct from the shard producer; and explicitly states terminality. The production cell `state` must map exactly to the independent `review.decision`: `official_verified`, `reference`, and `community_report` map to `evidence_candidate`; `no_public_info` maps only to `no_public_info`; controller-only unresolved states map to their same-named unresolved decisions. Review and attempt completion times use the shared canonical RFC 3339 parser, and `reviewed_at` must be strictly later than every bound attempt's `completed_at`. Artifact IDs, paths, and byte identities are globally single-use, each artifact names its cell/attempt/route/result, each attempt artifact contains the exact supplied attempt row, and each capture hash equals that attempt's `raw_response_sha256`.

Protocol 2 preflights the complete metadata graph before opening any retained artifact: exactly three chain members are required per declared attempt, with no unbound members, and the fixed 25×250 contract permits at most 2,250 members (250 cells × three canonical routes × three members). The existing 64 MiB per-artifact cap remains an outlier guard; a separate versioned 256 MiB aggregate cap (`PROTOCOL_2_MAX_AGGREGATE_ARTIFACT_BYTES`) gives one batch 1 MiB per cell while keeping retained evidence practical to inspect and twice the compiled candidate's 128 MiB ingress budget. Declared aggregate bytes and cardinality fail before artifact I/O. Each artifact read is additionally bounded by its own declared size and the remaining aggregate budget, so actual reads cannot consume another artifact's allowance.

Accepted decisions are:

- terminal: `evidence_candidate`, `no_public_info`
- unresolved/nonterminal: `research_incomplete`, `source_access_failed`, `conflicting_evidence`

`no_public_info` is accepted only when the independent review is explicitly terminal, all source/attempt/capture closure flags are true, the production coverage policy's complete route set is present for that category, and every bound attempt result is exactly `no_result` or `ineligible_source`. `success`/`source_found`, a missing result, route exhaustion, access failure, and transport failure can never support absence. A missing reviewed disposition is an error, not absence. The neutral aggregator preserves supplied scratch records and makes no evidence decision itself.

Each disposition supplies its exact cell row under `scratch.company-category-cells.jsonl`, all of that cell's actual attempt rows under `scratch.research-attempts.jsonl`, and may supply rows for the other canonical scratch ledgers. The aggregator verifies assignment and receipt hashes, exact six-lane/250-cell union, disposition/cell authority, artifact bytes and chain bindings, closure, and decision semantics. A supersession link is accepted only after the predecessor bytes are read no-follow, its digest is recomputed, and the entire predecessor assignment contract is revalidated. It then emits exactly:

```text
draft.json
sources.jsonl
claims.jsonl
gaps.jsonl
company-category-cells.jsonl
research-attempts.jsonl
official-claims-v2.jsonl
reference-records.jsonl
community-benefit-reports.jsonl
sources-v2.jsonl
verified-benefit-candidates.jsonl
```

```bash
python scripts/company_benefits_work_controller.py compile-scratch \
  --external-root /private/preexisting/work \
  --assignment /private/preexisting/work/domestic-01-wave-01.assignment.json \
  --identity-audit /private/preexisting/work/identity.json \
  --shard /private/preexisting/work/acquisition-01.json \
  --shard /private/preexisting/work/acquisition-02.json \
  --shard /private/preexisting/work/acquisition-03.json \
  --shard /private/preexisting/work/acquisition-04.json \
  --shard /private/preexisting/work/acquisition-05.json \
  --shard /private/preexisting/work/acquisition-06.json \
  --output-dir /private/preexisting/work/domestic-01-scratch
```

The result is `pending_independent_review` only when no disposition is unresolved. Otherwise it is `blocked_unresolved`; it is never approved. To run authoritative compiler validation, add a new candidate output and the canonical research root. Preflight refuses unresolved input and invokes `compile-company-benefits-series-candidate.py`, which in turn runs the production candidate validator:

```bash
  --candidate-output /private/preexisting/work/domestic-01-candidate \
  --research-root docs/research/company-benefits
```

Use `python scripts/company_benefits_work_controller.py --help` and each subcommand's `--help` for the complete CLI. Run the focused frozen mutation matrix with:

```bash
python scripts/tests/run_company_benefits_work_controller_mutation_matrix.py
```
