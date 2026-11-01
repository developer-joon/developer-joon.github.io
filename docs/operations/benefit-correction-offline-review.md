# Approved benefit correction offline-review runbook

This procedure exports approved correction requests as immutable **research candidates**. It never edits a company-category cell, evidence ledger, generated artifact, or correction status. Approval is permission to research a claim, not evidence that the submitted claim is true.

## Boundaries and roles

- A privileged database operator performs the read-only export. Configure `psql` with environment variables, a password file, or a service definition; never put a database URL, password, token, email, or user UUID in a command or snapshot.
- An independent researcher who did not approve the request researches each candidate against the normal benefits-v2 evidence rules.
- A release operator validates the v2 package, generates a new immutable artifact version, and runs the normal artifact/release verification.
- Only after that manifest is independently verified may a service operator call `mark_benefit_correction_applied_v1` in a separate approved operation.

The database source is `public.benefit_correction_requests` from `202611010001_benefit_correction_requests.sql`. The exporter selects `status='approved'` in one repeatable-read, read-only transaction and projects only `id`, company/category, submitted current/proposed/scope text, public source URL, observed data version, and status. It intentionally excludes submitter/reviewer UUIDs, email, OAuth/provider data, tokens, moderator identity/response, audit events, client keys, fingerprints, timestamps, rate-limit diagnostics, and all other internal fields. An unknown response field or malformed value fails closed.

## 1. Export an immutable candidate snapshot

Choose a new version name and an external operator-controlled output directory. Do not export into a public artifact tree.

```bash
export CORRECTION_SNAPSHOT_ROOT=/approved/operator/path/benefit-correction-snapshots
python3 scripts/export-approved-benefit-corrections.py export \
  --psql \
  --output-root "$CORRECTION_SNAPSHOT_ROOT" \
  --snapshot-version approved-corrections-YYYY-MM-DD-v1
```

`psql` uses its existing environment/service configuration; the command accepts no credential argument. Its read deadline defaults to 30 seconds and can be changed with `--psql-timeout-seconds`; a timeout terminates the process, escalates to kill if necessary, reaps it, and reports only a controlled non-credential diagnostic. In production, each evidence hostname is IDNA-validated and resolved through the operating-system resolver in a disposable subprocess with a two-second per-host deadline. A timed-out resolver is terminated, killed if necessary, and reaped, so blocked libc/NSS calls cannot accumulate live workers. Every returned A/AAAA address must be globally routable; a private, loopback, link-local, reserved, multicast, unspecified, IPv4-mapped unsafe, empty, malformed, failed, or timed-out answer fails the export. Override the deadline with `--dns-timeout-seconds` only when the operating environment requires it. Resolved addresses are validation-only and never enter snapshot bytes.

The version directory contains canonical `candidates.jsonl` and canonical `manifest.json`. The manifest binds the candidate count and SHA-256 of the exact JSONL bytes. Candidate ordering is by correction request UUID. Identical duplicate rows collapse; conflicting duplicate IDs fail. Re-running the same version with identical bytes is idempotent. If any existing file, bytes, type, or inventory differs, the exporter refuses to overwrite it. Publication holds the output-root descriptor, creates and opens staging members relative to that descriptor with no-follow checks, verifies a stable regular-file inventory, fsyncs both files and the staging directory, and performs one no-replace rename relative to the held parent descriptor before fsyncing it. Existing snapshot validation uses the same descriptor-relative no-follow and inode checks, so swapped parent paths or target/member symlinks cannot be accepted as idempotent snapshots.

For a credential-free rehearsal only, supply a private synthetic DB-response fixture:

```bash
python3 scripts/export-approved-benefit-corrections.py export \
  --input-json /private/synthetic-approved-rows.json \
  --resolver-json /private/synthetic-resolver.json \
  --output-root /private/rehearsal-snapshots \
  --snapshot-version rehearsal-approved-corrections-v1
```

The resolver fixture is a JSON object mapping each fixture hostname to a non-empty array of literal A/AAAA addresses, for example `{"example.com":["93.184.216.34"]}`. It is accepted only with `--input-json`, so production `--psql` exports cannot substitute fixture DNS. Omitting it uses live system DNS even for an input fixture.

Never fabricate a fixture and represent it as production approvals. Keep the exported snapshot private: submitted text is untrusted and may contain JSON, Markdown, HTML, or control-like content. Parse JSONL with a JSON parser; never interpolate it into HTML, shell, SQL, Markdown, or a ledger.

## 2. Independent research and normal v2 validation

For every candidate, the independent researcher must:

1. Treat `evidence_url`, current/proposed text, and scope as leads only.
2. Re-fetch and independently assess public evidence, entity/category binding, scope, currentness, conflicts, and publication eligibility.
3. Create normal v2 source, attempt, claim/reference/community-report, and cell records as warranted. Do not copy the candidate directly into a ledger and do not preserve user identity.
4. Record unsupported or conflicting submissions as research outcomes without forcing a public change.
5. Assemble the ordinary v2 package and run the same validator used for all research:

```bash
python3 scripts/validate-benefits-v2-package.py /private/review/package.json
```

A green candidate export does not imply that this validation will pass. The snapshot itself is never an accepted v2 evidence package.

## 3. Generate and verify a new immutable artifact version

After independent review and approved ledger integration, run the repository's normal generation command with a **new** `company-benefits-YYYY-MM-DD-vN` data version and reviewed freeze/effective-selection receipts:

```bash
python3 scripts/generate-company-benefits-artifacts.py \
  --research-root docs/research/company-benefits \
  --output-root /private/generated-site-root \
  --taxonomy docs/research/company-benefits/benefit-taxonomy-v1.json \
  --data-version company-benefits-YYYY-MM-DD-vN \
  --generated-at YYYY-MM-DDTHH:MM:SSZ \
  --as-of YYYY-MM-DD \
  --freeze-anchor-receipt /private/review/freeze-anchor-receipt.json \
  --effective-selection-receipt /private/review/effective-selection-receipt.json
```

Run the normal company-benefits ledger checks, artifact verifier, tests, and release gate described by the release procedure. Verify the generated artifact inventory and hashes and then independently record the exact SHA-256 of `community/data/company-benefits/manifest.json`. Artifact generation or verification failure leaves the prior public version active and blocks application marking.

## 4. Bind, then separately mark applied

Before any database mutation, check that the proposed applied version is exactly the data version in the independently verified manifest:

```bash
python3 scripts/export-approved-benefit-corrections.py verify-apply-binding \
  --manifest /private/verified-site/community/data/company-benefits/manifest.json \
  --applied-version company-benefits-YYYY-MM-DD-vN \
  --verified-manifest-sha256 "$VERIFIED_MANIFEST_SHA256"
```

The hash must come from the independent artifact-verification evidence. This helper reads only the manifest and emits a non-secret binding result; it does **not** call Supabase or mark a request applied.

At a distinct, approved service-operator stop point, call `public.mark_benefit_correction_applied_v1(request_id, 'approved', applied_data_version, client_key)` for each request actually represented in that verified release. Use a fresh operator idempotency key per request and an environment/secret-manager credential path. The RPC performs the only allowed `approved -> applied` transition. Its `applied_data_version` must be the exact version proven by the binding command. Read back each request and confirm `status='applied'` and the exact version before recording success. Requests researched but not represented in that release remain `approved`.

Do not combine export, research, generation, deployment, and applied marking into one command or approval. In particular, the exporter must never invoke the apply RPC.
