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

The exporter is supported only on Linux with `fork` and `renameat2(RENAME_EXCHANGE)`. Publication has no runtime bootstrap path. Before reading the database, the runtime opens the exact output root with `O_DIRECTORY|O_NOFOLLOW`, requires exporter-UID ownership and mode `0700`, and retains the descriptor. It then opens every fixed child descriptor-relatively and retains those descriptors for the operation. The exact root inventory is:

- `.approved-benefit-correction-export.lock`: regular, exporter-owned, mode `0600`, link count 1, empty;
- `.approved-benefit-correction-export.key`: regular, exporter-owned, mode `0600`, link count 1, exactly 32 random bytes;
- `.approved-benefit-correction-export.staging`: directory, exporter-owned, mode `0700`, containing exactly pre-created `candidates.jsonl` and `manifest.json`, each regular, exporter-owned, mode `0600`, link count 1;
- the requested snapshot-version name: an exporter-owned mode-`0700` empty directory before first publication, or the exact two-file immutable snapshot after publication.

The runtime creates none of those paths, never opens a trust anchor with `O_CREAT`, and never calls `mkdir`, `unlink`, or `rmdir`. It records each opened inode and checks owner, mode, type, link count, exact inventory, and pathname-to-inode binding before every transition. It acquires an exclusive advisory lock on the already-verified lock descriptor before touching staging. The complete 32-byte key is validation-only control material for this architecture; an empty, short, permissive, linked, replaced, or wrong-owner key fails closed. There is no runtime first initialization, partial-key promotion, legacy capability probe, tombstone, UUID staging, quarantine, or transparent migration path.

Provision one new root for one snapshot version with the separate offline helper. This command is destructive setup only in the sense that it creates a new private tree; it refuses if the output-root path already exists, including a partial prior attempt. Stop all exporters, ensure no same-UID process can access the parent, and run it only with exclusive operator access:

```bash
python3 scripts/export-approved-benefit-corrections.py prepare \
  --output-root /approved/operator/path/benefit-correction-snapshots \
  --snapshot-version approved-corrections-YYYY-MM-DD-v1
```

If setup is interrupted, move the partial root aside for inspection while still under exclusive access and prepare a different new path. The exporter does not repair or migrate old capability/tombstone layouts. Existing deployments must copy completed snapshots to archival storage and provision a new root offline; never point the runtime at the old layout and expect conversion.

```bash
export CORRECTION_SNAPSHOT_ROOT=/approved/operator/path/benefit-correction-snapshots
python3 scripts/export-approved-benefit-corrections.py export \
  --psql \
  --output-root "$CORRECTION_SNAPSHOT_ROOT" \
  --snapshot-version approved-corrections-YYYY-MM-DD-v1
```

`psql` uses its existing environment/service configuration; the command accepts no credential argument. The SQL orders approved rows by request UUID and returns at most **10,000 candidates plus one** as one JSON object per line, so row overflow is detected without database-side aggregation. This default covers large review queues while bounding the in-memory UUID/fingerprint/index and DNS-cache metadata to CI/operator-host scale. The canonical `candidates.jsonl` limit is **64 MiB** (`MAX_SNAPSHOT_BYTES`), enforced incrementally as each validated, unique candidate is canonicalized; each database line is independently capped at about 172 KiB from the schema's maximum escaped JSON representation. Accepted canonical rows are written to an anonymous disk-backed spool, then copied in UUID order to a second bounded spool while SHA-256 and count are computed incrementally. Publication streams that spool into staging and validates the staged/published file by size and streaming SHA-256, so it never retains the accepted candidate objects or a full candidates byte copy in memory. Only fixed-size duplicate metadata (status, SHA-256, offset, and length) remains per request ID. The 64 MiB artifact, 10,000-row index, one bounded decoded row, and 128 MiB streamed transport allowance are chosen to keep normal process memory below a 128–256 MiB CI/operator budget rather than permitting multi-gigabyte theoretical payloads. Fixture JSON input is also rejected above 64 MiB before decoding. The exporter reads stdin/stdout/stderr through nonblocking pipes, parses each row incrementally with exact-key and per-line byte checks, and caps total psql stdout at twice the snapshot limit (128 MiB) for JSONB field-name/status/whitespace overhead; stdout is streamed rather than retained, and stderr remains capped at 64 KiB. Its total read deadline defaults to 30 seconds and can be changed with `--psql-timeout-seconds`; a timeout or byte-cap violation terminates the process group, escalates to kill if necessary, reaps it, leaves no output snapshot, and reports only a controlled non-credential diagnostic. It never uses an unbounded `communicate()` or accumulates complete raw database output. In production, each distinct normalized evidence hostname is resolved once per export through the operating-system resolver in a disposable subprocess with a two-second per-host deadline. A timed-out resolver is terminated, killed if necessary, and reaped, so blocked libc/NSS calls cannot accumulate live workers. Every returned A/AAAA address must be globally routable; a private, loopback, link-local, reserved, multicast, unspecified, or malformed answer fails the whole snapshot. The default is intentionally fail-closed: there is no allow-unresolved production mode. The `candidates.jsonl` bytes do not include DNS answers, so resolver changes do not alter its hash.

The version directory contains canonical `candidates.jsonl` and canonical `manifest.json`. The manifest binds the candidate count and SHA-256 of the exact JSONL bytes. Candidate ordering is by correction request UUID. Identical duplicate rows collapse; conflicting duplicate IDs fail. Re-running the same version with identical bytes is idempotent. If any existing file, bytes, type, or inventory differs, the exporter refuses to overwrite it.

Crash recovery remains bounded by the two pre-created staging members. Before exchange, a crash can leave at most one 64 MiB candidate file and one bounded manifest in the fixed staging directory. The next invocation takes the same verified lock, revalidates every pathname binding, truncates and rewrites those same held file descriptors, fsyncs them, and retries. Publication is one atomic `RENAME_EXCHANGE` between the fixed staging directory and the pre-created empty snapshot-version placeholder. After exchange, the published snapshot is at the version name and the fixed staging name is the exact empty placeholder; a crash at that point is recognized idempotently on restart. One hundred failed retries retain the exact four-entry root inventory and stay below `MAX_PERSISTENT_CONTROL_BYTES`.

An extra member, symlink, special file, hardlink, wrong mode/owner, changed inode, incomplete key, non-empty target placeholder, or changed root binding fails closed before exchange. The runtime never deletes or repairs the suspect state. Recovery runbook: stop every exporter, make the parent inaccessible to all other same-UID processes, preserve the whole suspect root for forensics, and use `prepare` with a different absent output-root path. Do not use online pathname cleanup or mutate a prepared root in place.

For a credential-free rehearsal only, supply a private synthetic DB-response fixture:

```bash
python3 scripts/export-approved-benefit-corrections.py prepare \
  --output-root /private/rehearsal-snapshots \
  --snapshot-version rehearsal-approved-corrections-v1
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
