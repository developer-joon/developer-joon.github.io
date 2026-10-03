# Community Free Plan backup and restore

## Policy and limitations

This procedure is Free Plan only. The release contract does not require or offer paid PITR, project clone, temporary upgrade, managed restore-to-new-project, paid-overage auto-enable, or another paid feature as a fallback.

Managed daily backups are not available to Free Plan projects. PITR is unavailable on the Free Plan, and managed restore-to-new-project/project clone is not a Free recovery path. Provider-held backup availability must not be assumed or overclaimed. Free projects need regular logical exports; create one at least daily and immediately before every pre-production migration.

A database backup does not include Storage object bytes. The required recovery set is therefore:

1. encrypted logical database roles, schema, data, and migration history;
2. encrypted private Storage inventory and the object bytes;
3. Auth/OAuth, redirect allow-list, Function, extension, Realtime, network, and schedule configuration records;
4. non-secret checksums and release/approval evidence.

Objectives are **RPO: 24 hours**, **target RTO: 4 hours**, and a **quarterly restore drill** (also drill after materially changing this mechanism).

## Prerequisites

- repository-pinned Supabase CLI 2.118.0;
- `age`, GNU `tar`, `find`, `sort`, `sha256sum`, and `sync`;
- sufficient private off-site capacity outside the repository and Actions workspace;
- Supabase access supplied through a hidden prompt/environment;
- for restore, `psql` from the same PostgreSQL major version as the source export; verify with `psql --version` before use.

The CLI emits plain SQL files. The restore uses `psql`; it does not use `pg_restore`, because `pg_restore` expects a custom/directory/tar `pg_dump` archive rather than plain SQL. If the export format changes, stop and verify the corresponding restore command before recovery.

Supabase CLI 2.118.0 ordinary dumps exclude `supabase_migrations`. The separate history schema and history data exports below are required by the official procedure. The pinned `db dump --help` also confirms that repeatable `--exclude schema.table` flags are the supported syntax.

## Backup input validation

Use an absolute, operator-owned directory outside the repository. Keep both the plaintext work directory and final encrypted artifact private.

```bash
export REPO_ROOT="$(git rev-parse --show-toplevel)"
: "${PRODUCTION_PROJECT_REF:?set production project ref}"
: "${BACKUP_ROOT:?set an absolute backup directory outside the repository}"
: "${AGE_RECIPIENT:?set the approved age recipient}"
: "${DATABASE_MAJOR_VERSION:?record the source PostgreSQL major version}"
: "${RELEASE_REVISION:?record the reviewed Git revision}"
case "$BACKUP_ROOT" in /*) ;; *) printf '%s\n' 'BACKUP_ROOT must be absolute' >&2; exit 1 ;; esac
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
BACKUP_ROOT="$(realpath "$BACKUP_ROOT")"
case "$BACKUP_ROOT/" in "$REPO_ROOT/"*) printf '%s\n' 'backup path must be outside the repository' >&2; exit 1 ;; esac
read -rsp 'Production database password: ' SUPABASE_DB_PASSWORD
printf '\n'
export SUPABASE_DB_PASSWORD
read -rsp 'Supabase access token: ' SUPABASE_ACCESS_TOKEN
printf '\n'
export SUPABASE_ACCESS_TOKEN
```

Never pass either secret as a CLI literal. Never store secrets in the repository, backup manifest, evidence, logs, or Pages artifact.

## Approval-gated logical and Storage backup

**Hosted read/export approval stop point:** require `PRODUCTION_BACKUP_APPROVAL`. This reads production and writes only to the private local backup directory; `release-gate.mjs` never invokes it.

Run the following as one shell procedure. The cleanup trap is installed immediately after creating the private work directory. It unsets exported credentials and approval values and removes the plaintext tree and partial outputs on command failure, `INT`, or `TERM`.

```bash
: "${PRODUCTION_BACKUP_APPROVAL:?record production backup approval}"
set -euo pipefail
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="$BACKUP_ROOT/$STAMP.work"
ARCHIVE_DIR="$BACKUP_ROOT"
ARCHIVE_BASENAME="$STAMP-community-backup.tar.age"
CHECKSUM_BASENAME="$ARCHIVE_BASENAME.sha256"
ARCHIVE="$ARCHIVE_DIR/$ARCHIVE_BASENAME"
CHECKSUM="$ARCHIVE_DIR/$CHECKSUM_BASENAME"
ARCHIVE_TMP="$BACKUP_ROOT/.$STAMP-community-backup.tar.age.tmp.$$"
CHECKSUM_TMP="$BACKUP_ROOT/.$STAMP-community-backup.tar.age.sha256.tmp.$$"
BACKUP_PUBLISHED=0
backup_cleanup() {
  status=$?
  trap - EXIT INT TERM
  unset SUPABASE_DB_PASSWORD SUPABASE_ACCESS_TOKEN PRODUCTION_BACKUP_APPROVAL AGE_RECIPIENT
  if [ -d "${WORK_DIR:-}" ]; then
    find "$WORK_DIR" -type f -exec chmod u+w,go-rwx {} + 2>/dev/null || true
    rm -rf -- "$WORK_DIR"
  fi
  rm -f -- "${ARCHIVE_TMP:-}" "${CHECKSUM_TMP:-}"
  if [ "${BACKUP_PUBLISHED:-0}" -ne 1 ]; then
    rm -f -- "${ARCHIVE:-}" "${CHECKSUM:-}"
  fi
  exit "$status"
}
mkdir -m 700 "$WORK_DIR"
trap backup_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db dump --project-ref "$PRODUCTION_PROJECT_REF" --role-only --file "$WORK_DIR/roles.sql"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db dump --project-ref "$PRODUCTION_PROJECT_REF" --file "$WORK_DIR/schema.sql"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db dump --project-ref "$PRODUCTION_PROJECT_REF" --data-only --use-copy \
  --exclude storage.buckets_vectors \
  --exclude storage.vector_indexes \
  --file "$WORK_DIR/data.sql"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db dump --project-ref "$PRODUCTION_PROJECT_REF" --schema supabase_migrations \
  --file "$WORK_DIR/history_schema.sql"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db dump --project-ref "$PRODUCTION_PROJECT_REF" --data-only --use-copy \
  --schema supabase_migrations \
  --file "$WORK_DIR/history_data.sql"
```

CLI 2.118.0 marks Storage commands experimental. Keep `--experimental`, `--project-ref`, bucket, and local destination explicit. The trailing bucket slash makes the argument the bucket root rather than a bucket-name prefix. Recursive download appends the source directory `community-images` to the existing destination directory, so the asserted local object root is exactly `$WORK_DIR/storage-objects/community-images`.

CLI 2.118.0 recursive `storage ls` emits `/community-images/object-key`, not an `ss:///` URL. The normalizer below accepts only that bucket prefix, strips it to an exact relative object key, sorts keys, and naturally emits an empty file for an empty bucket. The downloaded-file inventory uses the same relative-key format.

```bash
normalize_storage_inventory() {
  local pipeline_status
  LC_ALL=C awk -v prefix='/community-images/' '
    length($0) == 0 || index($0, prefix) != 1 || length($0) == length(prefix) {
      print "unexpected Storage inventory record: " $0 > "/dev/stderr"
      exit 1
    }
    { print substr($0, length(prefix) + 1) }
  ' | LC_ALL=C sort
  pipeline_status=("${PIPESTATUS[@]}")
  [ "${pipeline_status[0]}" -eq 0 ] && [ "${pipeline_status[1]}" -eq 0 ]
}
mkdir -m 700 "$WORK_DIR/storage-objects"
mkdir -m 700 "$WORK_DIR/storage-objects/community-images"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  storage ls --experimental --recursive --project-ref "$PRODUCTION_PROJECT_REF" \
  ss:///community-images/ | normalize_storage_inventory > "$WORK_DIR/private-storage-inventory.txt"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  storage cp --experimental --recursive --project-ref "$PRODUCTION_PROJECT_REF" \
  ss:///community-images/ "$WORK_DIR/storage-objects"
test -d "$WORK_DIR/storage-objects/community-images"
find "$WORK_DIR/storage-objects/community-images" -type f -printf '%P\n' \
  | LC_ALL=C sort > "$WORK_DIR/downloaded-storage-paths.txt"
diff --unified "$WORK_DIR/private-storage-inventory.txt" "$WORK_DIR/downloaded-storage-paths.txt"
STORAGE_OBJECT_COUNT="$(wc -l < "$WORK_DIR/private-storage-inventory.txt" | tr -d ' ')"
STORAGE_INVENTORY_SHA256="$(sha256sum "$WORK_DIR/private-storage-inventory.txt" | cut -d' ' -f1)"
test "$STORAGE_OBJECT_COUNT" = "$(wc -l < "$WORK_DIR/downloaded-storage-paths.txt" | tr -d ' ')"
chmod 600 "$WORK_DIR"/*.sql "$WORK_DIR"/*.txt
```

`storage ls` in the pinned CLI provides object path records. Sorting those records makes this path inventory stable; it does not promise content hashes or a complete metadata export. The listing contains no signed URLs and no object bodies. The downloaded tree supplies object bytes, and `payload-sha256.txt` below records a SHA-256 for every downloaded file. If the pinned CLI’s listing format changes or includes anything besides one object path per line, stop and update the normalizer before backup rather than accepting a false comparison.

Create inner checksums and a non-secret manifest. Encrypt to a temporary file in the final directory, set its mode, flush it, atomically rename it in that same directory, and only then checksum the final encrypted artifact. The checksum is staged and renamed the same way. `BACKUP_PUBLISHED` is set only after final verification, so the trap removes any incomplete publication but never deletes a successfully published archive/checksum.

```bash
(
  cd "$WORK_DIR"
  find . -type f ! -name payload-sha256.txt ! -name manifest.txt -print0 \
    | LC_ALL=C sort -z | xargs -0 sha256sum > payload-sha256.txt
)
PROJECT_REF_SHA256="$(printf '%s' "$PRODUCTION_PROJECT_REF" | sha256sum | cut -d' ' -f1)"
printf '%s\n' \
  "created_utc=$STAMP" \
  "source_project_ref_sha256=$PROJECT_REF_SHA256" \
  "database_major_version=$DATABASE_MAJOR_VERSION" \
  "migration_revision=$RELEASE_REVISION" \
  "storage_object_count=$STORAGE_OBJECT_COUNT" \
  "storage_inventory_sha256=$STORAGE_INVENTORY_SHA256" \
  'encryption=age-recipient' \
  > "$WORK_DIR/manifest.txt"
chmod 600 "$WORK_DIR/payload-sha256.txt" "$WORK_DIR/manifest.txt"
tar -C "$WORK_DIR" -cf - . | age --recipient "$AGE_RECIPIENT" --output "$ARCHIVE_TMP"
chmod 600 "$ARCHIVE_TMP"
sync -f "$ARCHIVE_TMP"
mv -- "$ARCHIVE_TMP" "$ARCHIVE"
(
  cd "$ARCHIVE_DIR"
  sha256sum "$ARCHIVE_BASENAME" > "$CHECKSUM_TMP"
)
chmod 600 "$CHECKSUM_TMP"
sync -f "$CHECKSUM_TMP"
mv -- "$CHECKSUM_TMP" "$CHECKSUM"
sync -f "$BACKUP_ROOT"
(
  cd "$ARCHIVE_DIR"
  sha256sum --check "$CHECKSUM_BASENAME"
)
BACKUP_PUBLISHED=1
```

The EXIT trap now removes the plaintext work tree and unsets secrets. This is exposure minimization, not a claim of guaranteed secure erase: secure erase cannot be guaranteed on SSDs, copy-on-write filesystems, snapshots, or remapped blocks. Keep the plaintext lifetime short and the directory on approved encrypted local storage.

Move the encrypted archive and checksum to approved off-site storage. Evidence may contain only archive checksum, timestamp, encryption mechanism identifier, database major version, migration revision, source project-ref hash, private Storage inventory checksum, and exact object count—not the archive, inventory paths, raw ref, credentials, or object data.

## Clean-target recovery capacity

Free Plan capacity commonly allows two active projects, already used by hosted development and production. If current active-project capacity blocks recovery, **pause development before creating or activating a clean recovery target**. Record development configuration and confirm its synthetic fixtures are disposable first. Never pause or repurpose production as development, never overwrite production to make room, and do not use a temporary paid upgrade as fallback.

Use the Dashboard to pause development, create/activate the clean recovery project, and record a new `RECOVERY_PROJECT_REF`. Confirm it differs from both existing refs:

```bash
: "${RECOVERY_PROJECT_REF:?set clean recovery project ref}"
[ "$RECOVERY_PROJECT_REF" != "$DEVELOPMENT_PROJECT_REF" ] || exit 1
[ "$RECOVERY_PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || exit 1
```

## Decrypt and verify

Use an isolated private restore directory outside the repository. The identity file path is supplied by the operator and must be mode 600. Retain only non-sensitive drill evidence outside the plaintext tree.

Run decrypt, restore, verification, evidence publication, and cleanup in one shell so the trap remains active:

```bash
set -euo pipefail
umask 077
: "${ARCHIVE:?set encrypted archive path}"
: "${AGE_IDENTITY_FILE:?set private age identity path}"
: "${RESTORE_ROOT:?set an existing absolute restore parent outside the repository}"
: "${RESTORE_DRILL_EVIDENCE_PATH:?set an absolute non-sensitive drill evidence path outside the repository and restore root}"
REPO_ROOT="$(realpath -e -- "$(git rev-parse --show-toplevel)")"
case "$RESTORE_ROOT" in /*) ;; *) exit 1 ;; esac
case "$RESTORE_DRILL_EVIDENCE_PATH" in /*) ;; *) exit 1 ;; esac
RESTORE_ROOT_INPUT="$RESTORE_ROOT"
EVIDENCE_PARENT_INPUT="$(dirname -- "$RESTORE_DRILL_EVIDENCE_PATH")"
EVIDENCE_BASENAME="$(basename -- "$RESTORE_DRILL_EVIDENCE_PATH")"
[ -d "$RESTORE_ROOT_INPUT" ] && [ ! -L "$RESTORE_ROOT_INPUT" ] || exit 1
[ -d "$EVIDENCE_PARENT_INPUT" ] && [ ! -L "$EVIDENCE_PARENT_INPUT" ] || exit 1
RESTORE_ROOT="$(realpath -e -- "$RESTORE_ROOT_INPUT")"
EVIDENCE_PARENT="$(realpath -e -- "$EVIDENCE_PARENT_INPUT")"
[ "$RESTORE_ROOT_INPUT" = "$RESTORE_ROOT" ] || exit 1
[ "$EVIDENCE_PARENT_INPUT" = "$EVIDENCE_PARENT" ] || exit 1
[ "$RESTORE_DRILL_EVIDENCE_PATH" = "$EVIDENCE_PARENT/$EVIDENCE_BASENAME" ] || exit 1
[ -d "$RESTORE_ROOT" ] && [ ! -L "$RESTORE_ROOT" ] || exit 1
[ -d "$EVIDENCE_PARENT" ] && [ ! -L "$EVIDENCE_PARENT" ] || exit 1
case "$RESTORE_ROOT/" in "$REPO_ROOT/"*) exit 1 ;; esac
case "$RESTORE_DRILL_EVIDENCE_PATH" in "$REPO_ROOT/"*) exit 1 ;; esac
case "$RESTORE_DRILL_EVIDENCE_PATH" in "$RESTORE_ROOT/"*) exit 1 ;; esac
[ ! -e "$RESTORE_DRILL_EVIDENCE_PATH" ] && [ ! -L "$RESTORE_DRILL_EVIDENCE_PATH" ] || exit 1
ARCHIVE_DIR="$(dirname -- "$ARCHIVE")"
ARCHIVE_BASENAME="$(basename -- "$ARCHIVE")"
CHECKSUM_BASENAME="$ARCHIVE_BASENAME.sha256"
CHECKSUM="$ARCHIVE_DIR/$ARCHIVE_BASENAME.sha256"
[ -f "$ARCHIVE" ] && [ ! -L "$ARCHIVE" ] || exit 1
[ -f "$CHECKSUM" ] && [ ! -L "$CHECKSUM" ] || exit 1
chmod 600 "$AGE_IDENTITY_FILE"
(
  cd "$ARCHIVE_DIR"
  sha256sum --check "$CHECKSUM_BASENAME"
)
chmod 700 "$RESTORE_ROOT"
RESTORE_WORK_DIR=''
RESTORE_EVIDENCE_TMP=''
RESTORE_EVIDENCE_PUBLISHED=0
cleanup_restore() {
  cleanup_status=0
  unset PGPASSWORD SUPABASE_ACCESS_TOKEN RECOVERY_RESTORE_APPROVAL RECOVERY_STORAGE_APPROVAL
  if [ -n "${RESTORE_WORK_DIR:-}" ] && [ -e "$RESTORE_WORK_DIR" ]; then
    if [ ! -d "$RESTORE_WORK_DIR" ] || [ -L "$RESTORE_WORK_DIR" ]; then
      cleanup_status=1
    else
      find "$RESTORE_WORK_DIR" -type f -exec chmod u+w,go-rwx {} + 2>/dev/null || cleanup_status=1
      rm -rf -- "$RESTORE_WORK_DIR" || cleanup_status=1
    fi
  fi
  if [ "${RESTORE_EVIDENCE_PUBLISHED:-0}" -ne 1 ]; then
    rm -f -- "${RESTORE_EVIDENCE_TMP:-}" "$RESTORE_DRILL_EVIDENCE_PATH" || cleanup_status=1
  fi
  return "$cleanup_status"
}
restore_exit() {
  status=$?
  trap - EXIT INT TERM
  cleanup_restore || status=1
  exit "$status"
}
trap restore_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
RESTORE_WORK_DIR="$(mktemp -d "$RESTORE_ROOT/community-restore.XXXXXX")"

age --decrypt --identity "$AGE_IDENTITY_FILE" "$ARCHIVE" | tar -C "$RESTORE_WORK_DIR" -xf -
(
  cd "$RESTORE_WORK_DIR"
  sha256sum --check payload-sha256.txt
)
psql --version
```

Compare `manifest.txt` to the incident revision, source ref hash, expected PostgreSQL major, exact Storage object count, and inventory SHA-256. Stop on any mismatch.

## Manual atomic logical restore

Configure `PGHOST`, `PGPORT`, `PGDATABASE`, and `PGUSER` from the clean recovery project’s approved connection details. Enter the password through a hidden prompt; do not place a connection string or password in command history.

**Clean-target prerequisite:** the target must be a clean, empty recovery target with no application migrations or user data applied. Do not run this over production or a partially initialized target.

**Recovery mutation stop point:** require `RECOVERY_RESTORE_APPROVAL`. The following changes only the clean recovery target.

The repeated `--file` options are supported `psql` semantics. Roles, ordinary schema/data, and migration-history schema/data run in one `psql` process and one transaction. `ON_ERROR_STOP=1` plus `--single-transaction` prevents a later-file failure from committing an earlier file. These official CLI SQL outputs are expected to be transaction-compatible; verify that in every restore drill. If a reviewed export introduces a transaction-incompatible command, stop and revise the controlled recovery procedure—do not split this into partially committed restores.

```bash
: "${RECOVERY_RESTORE_APPROVAL:?record clean-target restore approval}"
: "${PGHOST:?set recovery database host}"
: "${PGPORT:?set recovery database port}"
: "${PGDATABASE:?set recovery database name}"
: "${PGUSER:?set recovery database user}"
read -rsp 'Recovery database password: ' PGPASSWORD
printf '\n'
export PGPASSWORD
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$RESTORE_WORK_DIR/roles.sql" \
  --file "$RESTORE_WORK_DIR/schema.sql" \
  --command "SET session_replication_role = 'replica';" \
  --file "$RESTORE_WORK_DIR/data.sql" \
  --file "$RESTORE_WORK_DIR/history_schema.sql" \
  --file "$RESTORE_WORK_DIR/history_data.sql"
unset PGPASSWORD
```

Resolve provider-owned role/extension warnings according to the official CLI restore guide; do not weaken errors globally or edit the only backup. Apply only reviewed compatibility changes to a copy and record its checksum.

Restore private objects separately after buckets/policies exist. The local source is the same asserted tree produced by recursive download. Under CLI 2.118.0 recursive copy appends the local source basename to the destination: uploading source basename `community-images` to `ss:///` therefore creates the target bucket path exactly once and preserves the original object keys. Uploading that directory to `ss:///community-images/` is forbidden because it can create `community-images/community-images/...`. The target listing is normalized and compared with the backup inventory after upload.

```bash
: "${RECOVERY_STORAGE_APPROVAL:?record Storage restore approval}"
read -rsp 'Supabase access token: ' SUPABASE_ACCESS_TOKEN
printf '\n'
export SUPABASE_ACCESS_TOKEN
normalize_storage_inventory() {
  local pipeline_status
  LC_ALL=C awk -v prefix='/community-images/' '
    length($0) == 0 || index($0, prefix) != 1 || length($0) == length(prefix) {
      print "unexpected Storage inventory record: " $0 > "/dev/stderr"
      exit 1
    }
    { print substr($0, length(prefix) + 1) }
  ' | LC_ALL=C sort
  pipeline_status=("${PIPESTATUS[@]}")
  [ "${pipeline_status[0]}" -eq 0 ] && [ "${pipeline_status[1]}" -eq 0 ]
}
test -d "$RESTORE_WORK_DIR/storage-objects/community-images"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  storage cp --experimental --recursive --project-ref "$RECOVERY_PROJECT_REF" \
  "$RESTORE_WORK_DIR/storage-objects/community-images" ss:///
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  storage ls --experimental --recursive --project-ref "$RECOVERY_PROJECT_REF" \
  ss:///community-images/ | normalize_storage_inventory > "$RESTORE_WORK_DIR/restored-storage-inventory.txt"
diff --unified "$RESTORE_WORK_DIR/private-storage-inventory.txt" "$RESTORE_WORK_DIR/restored-storage-inventory.txt"
RESTORED_STORAGE_OBJECT_COUNT="$(wc -l < "$RESTORE_WORK_DIR/restored-storage-inventory.txt" | tr -d ' ')"
RESTORED_STORAGE_INVENTORY_SHA256="$(sha256sum "$RESTORE_WORK_DIR/restored-storage-inventory.txt" | cut -d' ' -f1)"
test "$RESTORED_STORAGE_OBJECT_COUNT" = "$(sed -n 's/^storage_object_count=//p' "$RESTORE_WORK_DIR/manifest.txt")"
test "$RESTORED_STORAGE_INVENTORY_SHA256" = "$(sed -n 's/^storage_inventory_sha256=//p' "$RESTORE_WORK_DIR/manifest.txt")"
unset SUPABASE_ACCESS_TOKEN RECOVERY_STORAGE_APPROVAL
```

Reconfigure and verify Auth provider settings, the separate recovery OAuth app/redirects if used, publishable and privileged keys, Functions, Realtime, extensions, Vault/schedules, network restrictions, and custom domains. Database restore alone does not guarantee those settings.

## Verification, evidence, cleanup, and cutover

Run schema/migration checks, RLS tests, representative read-only RPCs, snapshot generation, OAuth, private Storage, Function, and browser smoke checks against the recovery ref. Keep production write-disabled during incident recovery. A cutover needs a separate approval and endpoint/key rotation plan. Retain the old production project and all encrypted backup/evidence until both the incident and rollback windows close.

A quarterly restore drill stops before production cutover. Measure elapsed time against target RTO 4 hours and record whether the newest recoverable data satisfies RPO 24 hours. Stage only non-sensitive drill evidence in the separate canonical evidence directory. Cleanup must then succeed and the plaintext work path must be absent before the evidence rename can publish a passed result:

```bash
RESTORE_EVIDENCE_TMP="$(mktemp "$EVIDENCE_PARENT/.$EVIDENCE_BASENAME.tmp.XXXXXX")"
printf '%s\n' \
  "archive_sha256=$(cut -d' ' -f1 "$CHECKSUM")" \
  "storage_object_count=$RESTORED_STORAGE_OBJECT_COUNT" \
  "storage_inventory_sha256=$RESTORED_STORAGE_INVENTORY_SHA256" \
  'database_restore=passed' \
  'storage_restore=passed' \
  'zero_plaintext_retained=true' \
  > "$RESTORE_EVIDENCE_TMP"
chmod 600 "$RESTORE_EVIDENCE_TMP"
cleanup_restore
test ! -e "$RESTORE_WORK_DIR"
test ! -L "$RESTORE_WORK_DIR"
mv -- "$RESTORE_EVIDENCE_TMP" "$RESTORE_DRILL_EVIDENCE_PATH"
sync -f "$RESTORE_DRILL_EVIDENCE_PATH"
sync -f "$EVIDENCE_PARENT"
RESTORE_EVIDENCE_PUBLISHED=1
trap - EXIT INT TERM
```

The final explicit `cleanup_restore` and absence assertions run before the atomic evidence rename. Any cleanup, absence-check, rename, or sync failure reaches the fail-closed trap, which removes staged or prematurely renamed success evidence. As with backup cleanup, deletion minimizes exposure but does not guarantee physical secure erase on SSDs or snapshotting filesystems.

## Official references

- Database backups and Free Plan export guidance: https://supabase.com/docs/guides/platform/backups
- CLI backup/restore procedure: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Paid duplicate-project limitation reference: https://supabase.com/docs/guides/platform/clone-project
- Storage object downloads and inventory options: https://supabase.com/docs/guides/storage/management/download-objects
- Free active-project capacity: https://supabase.com/docs/guides/platform/billing-faq
- Free project pausing/resume: https://supabase.com/docs/guides/platform/free-project-pausing
