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

The exporter is supported only on Linux with the `fork` multiprocessing start method and a filesystem/kernel/libc combination that implements `renameat2` with both `RENAME_NOREPLACE` and `RENAME_EXCHANGE`. Before database or DNS access and before creating the tombstone key, it opens the exact output root at mode `0700` and creates or reuses the fixed mode-`0700` `.approved-benefit-correction-export-capabilities` directory beneath the held root descriptor. This directory is persistent operator control state. Its exact bounded inventory is two mode-`0600`, single-link files named `source` and `target`; clean preflights never create nonce probe directories. The exporter fsyncs both files, proves that no-replace returns `EEXIST` without changing either inode or bytes, exchanges the two captured inodes, verifies the reversed state, and exchanges them back to the canonical names. If a process stops after the first exchange, the next preflight recognizes the exact reversed pair and restores it only by another atomic exchange. `ENOENT`, `ENOSYS`, `EOPNOTSUPP`, `EINVAL`, any other syscall failure, incorrect content/inode behavior, extra inventory, hardlinks, or a replaced control/root binding fails closed. Preflight never calls `unlink` or `rmdir`, never removes the output root, and never removes a probe member or control directory. A same-UID race may move an inserted inode only between the two known control names during an exchange; the following identity check detects it, preserves every inode, and reports the capability-control path for manual recovery. A newly created output root and partially initialized control state may therefore persist after failure. The operator must inspect the reported private control directory and restore exactly the documented two-file canonical inventory before retrying; never delete an unrecognized inode. Existing published version directories are never touched. The existing parent must be owned by the effective operator and not group/world-writable. The output root is created descriptor-relatively with no symlink following at exact mode `0700`, or, if it already exists, must be an operator-owned directory at exact mode `0700`; permissive roots such as `0777`, wrong-owner roots, symlinks, and unstable name/inode bindings fail closed.

```bash
export CORRECTION_SNAPSHOT_ROOT=/approved/operator/path/benefit-correction-snapshots
python3 scripts/export-approved-benefit-corrections.py export \
  --psql \
  --output-root "$CORRECTION_SNAPSHOT_ROOT" \
  --snapshot-version approved-corrections-YYYY-MM-DD-v1
```

`psql` uses its existing environment/service configuration; the command accepts no credential argument. The SQL orders approved rows by request UUID and returns at most **10,000 candidates plus one** as one JSON object per line, so row overflow is detected without database-side aggregation. This default covers large review queues while bounding the in-memory UUID/fingerprint/index and DNS-cache metadata to CI/operator-host scale. The canonical `candidates.jsonl` limit is **64 MiB** (`MAX_SNAPSHOT_BYTES`), enforced incrementally as each validated, unique candidate is canonicalized; each database line is independently capped at about 172 KiB from the schema's maximum escaped JSON representation. Accepted canonical rows are written to an anonymous disk-backed spool, then copied in UUID order to a second bounded spool while SHA-256 and count are computed incrementally. Publication streams that spool into staging and validates the staged/published file by size and streaming SHA-256, so it never retains the accepted candidate objects or a full candidates byte copy in memory. Only fixed-size duplicate metadata (status, SHA-256, offset, and length) remains per request ID. The 64 MiB artifact, 10,000-row index, one bounded decoded row, and 128 MiB streamed transport allowance are chosen to keep normal process memory below a 128–256 MiB CI/operator budget rather than permitting multi-gigabyte theoretical payloads. Fixture JSON input is also rejected above 64 MiB before decoding. The exporter reads stdin/stdout/stderr through nonblocking pipes, parses each row incrementally with exact-key and per-line byte checks, and caps total psql stdout at twice the snapshot limit (128 MiB) for JSONB field-name/status/whitespace overhead; stdout is streamed rather than retained, and stderr remains capped at 64 KiB. Its total read deadline defaults to 30 seconds and can be changed with `--psql-timeout-seconds`; a timeout or byte-cap violation terminates the process group, escalates to kill if necessary, reaps it, leaves no output snapshot, and reports only a controlled non-credential diagnostic. It never uses an unbounded `communicate()` or accumulates complete raw database output. In production, each distinct normalized evidence hostname is resolved once per export through the operating-system resolver in a disposable subprocess with a two-second per-host deadline. A timed-out resolver is terminated, killed if necessary, and reaped, so blocked libc/NSS calls cannot accumulate live workers. Every returned A/AAAA address must be globally routable; a private, loopback, link-local, reserved, multicast, unspecified, or malformed answer fails the whole snapshot. The default is intentionally fail-closed: there is no allow-unresolved production mode. The `candidates.jsonl` bytes do not include DNS answers, so resolver changes do not alter its hash.

The version directory contains canonical `candidates.jsonl` and canonical `manifest.json`. The manifest binds the candidate count and SHA-256 of the exact JSONL bytes. Candidate ordering is by correction request UUID. Identical duplicate rows collapse; conflicting duplicate IDs fail. Re-running the same version with identical bytes is idempotent. If any existing file, bytes, type, or inventory differs, the exporter refuses to overwrite it. Publication is transactional: it holds the output-root and staging descriptors, creates staging members with no-follow checks, fsyncs both files and the staging directory, and revalidates the exact inventory, file identities, and stable staging name binding in the low-level publication helper immediately before one no-replace rename. After fsyncing the parent, it validates the published name, directory identity, member identities, inventory, and bytes again before the API can return or emit a manifest path.

If that mandatory post-publication check fails, rollback prepares and fsyncs a strict tombstone directory before exchange. The exporter first creates or opens a dedicated `.approved-benefit-correction-export-control` directory beside (never inside) the snapshot output root under its private, operator-owned parent. It accepts only an exact owner-owned mode-`0700` directory and an exact regular, single-link, owner-owned mode-`0600` key file opened no-follow; both names and inodes are rechecked. The 32-byte random authentication key is created once with exclusive creation, fsynced, and reused across process restarts. Symlinks, special files, changed inodes, wrong ownership, permissive modes, or an untrusted writable parent fail closed. Never copy, print, log, publish, back up with public artifacts, or place this key in the snapshot tree.

The tombstone's exact inventory is one canonical, versioned marker containing the fixed exporter domain, a cryptographically random transaction nonce, the exact snapshot version and content identity, and a domain-separated HMAC-SHA256 under that private key. The loaded key remains in a mutable `bytearray` through HMAC/publication and is overwritten in a `finally` block on success or failure. This is best-effort process-memory hygiene, not a guarantee of complete zeroization: CPython and its cryptographic/entropy APIs may create short-lived immutable or native copies that Python cannot reliably overwrite. Its directory and marker identities remain captured by descriptors. Rollback then uses descriptor-relative Linux `renameat2(RENAME_EXCHANGE)` to atomically place that verified tombstone at the canonical target while moving the invalid publication to a unique quarantine name. It never removes the canonical target by pathname. A foreign replacement that wins the exchange race is restored by a second atomic exchange and preserved. Publication cleanup never calls pathname `unlink` or `rmdir`: Linux provides no atomic compare-and-delete primitive, so failed staging directories, quarantined invalid publications, and displaced tombstones are preserved under their hidden names for operator inspection instead of risking deletion of a same-UID replacement. If atomic exchange or identity verification fails, rollback performs no name-based fallback and fails closed. Operators may remove a hidden residue only after taking the output root offline and independently verifying that no concurrent writer can replace its names.

A failed transaction may therefore leave the canonical version name occupied by a **non-public tombstone sentinel**. The tombstone is retryable after process restart but is never a valid snapshot and must never be returned as success. A later exporter validates the tombstone through no-follow descriptors, exact inventory, canonical marker bytes, fixed domain, schema version, nonce shape, exact target version/content identity, valid HMAC, trusted key storage, and stable inode bindings; it atomically exchanges a fresh staging snapshot over that tombstone, verifies both exchanged identities, and preserves the displaced tombstone under the hidden staging name for offline operator recovery. Unrecognized empty directories, unsigned, malformed, forged, wrong-key, or tampered markers, symlinks, extra members, wrong bytes, and foreign directories remain mismatch failures and are left untouched. Concurrent retries either publish the same exact snapshot or observe it idempotently; they never overwrite a normal snapshot or foreign directory. Consumers must require the exact snapshot inventory (`candidates.jsonl` and `manifest.json`) and verify the manifest and bound JSONL hash; the presence of the version directory alone is never publication evidence. The output-root path must continue to name the opened root directory throughout publication.

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
