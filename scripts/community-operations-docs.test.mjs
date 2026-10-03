#!/usr/bin/env node

import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const operationsRoot = path.join(repoRoot, 'docs/operations')
const verifier = path.join(repoRoot, 'scripts/verify-site.mjs')
const operationFiles = [
  'community-release-runbook.md',
  'community-backup-restore.md',
  'community-rollback.md',
  'community-release-checklist.md',
]

async function operationText(name) {
  return readFile(path.join(operationsRoot, name), 'utf8')
}

async function allOperationsText() {
  return (await Promise.all(operationFiles.map(operationText))).join('\n')
}

function assertMatches(text, patterns) {
  for (const pattern of patterns) assert.match(text, pattern)
}

function bashCommands(text) {
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap(([, block]) => block.replaceAll(/\\\n\s*/g, ' ').split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
}

async function put(root, relativePath, content = '') {
  const destination = path.join(root, relativePath)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}

async function makeValidArtifact() {
  const root = await mkdtemp(path.join(tmpdir(), 'community-operations-docs-'))
  const routes = [
    ['index.html', '<title>Ria & Seoa PaPa – 0 → 1</title>', 'https://www.breadlab.ai/', '<a href="/community/">Community</a>'],
    ['blog/index.html', '<title>Blog – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/', ''],
    ['lab/index.html', '<title>0 → 1 – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/lab/', ''],
    ['blog/ceph-cluster-install-with-helm.html', '<title>[Kubernets] Ceph Cluster install with helm – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm', ''],
    ['404.html', '<title>Page Not Found – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/404.html', ''],
  ]
  for (const [relativePath, title, canonical, body] of routes) {
    await put(root, relativePath, `${title}<link rel="canonical" href="${canonical}">${body}`)
  }
  const shellTitles = new Map([
    ['community/index.html', '<title>Breadlab 커뮤니티</title>'],
    ['community/write/index.html', '<title>글쓰기 | Breadlab 커뮤니티</title>'],
    ['community/post/index.html', '<title>게시글 | Breadlab 커뮤니티</title>'],
    ['community/edit/index.html', '<title>글 수정 | Breadlab 커뮤니티</title>'],
    ['community/admin/reports/index.html', '<title>신고 관리 | Breadlab 커뮤니티</title>'],
    ['community/auth/callback/index.html', '<title>로그인 처리 | Breadlab 커뮤니티</title>'],
  ])
  for (const [relativePath, title] of shellTitles) {
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script>`)
  }
  const snapshotId = '11111111-1111-4111-8111-111111111111'
  const snapshotUrl = `https://www.breadlab.ai/community/content/${snapshotId}/`
  await put(root, `community/content/${snapshotId}/index.html`, `<link rel="canonical" href="${snapshotUrl}"><meta property="og:type" content="article"><meta property="og:url" content="${snapshotUrl}"><script type="application/ld+json">{"@type":"BlogPosting"}</script>`)
  await put(root, 'privacy.html', '<title>개인정보처리방침 – Ria & Seoa PaPa</title><link rel="canonical" href="https://www.breadlab.ai/privacy">GitHub OAuth 처리 완료 후 최대 3년')
  await put(root, 'CNAME', 'www.breadlab.ai\n')
  await put(root, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://www.breadlab.ai/sitemap.xml\n')
  await put(root, 'sitemap.xml', [
    'https://www.breadlab.ai/',
    'https://www.breadlab.ai/blog/',
    'https://www.breadlab.ai/lab/',
    'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    'https://www.breadlab.ai/privacy',
    snapshotUrl,
  ].map((location) => `<loc>${location}</loc>`).join('\n'))
  for (const relativePath of ['css/style.css', 'js/personal-min.js', 'images/favicon.ico', 'community/assets/main-Ab12Cd34.js']) {
    await put(root, relativePath)
  }
  return root
}

function verify(root) {
  return spawnSync(process.execPath, [verifier, root], { encoding: 'utf8' })
}

test('defines three isolated environments and exact OAuth boundaries', async () => {
  const text = await allOperationsText()
  const oauth = await operationText('community-oauth-setup.md')
  assertMatches(text, [
    /local Docker/i,
    /hosted development/i,
    /production/i,
    /distinct project ref/i,
    /separate GitHub OAuth App/i,
    /redirect allow-list/i,
    /separate (?:publishable )?keys/i,
    /separate Storage/i,
    /separate test identit/i,
  ])
  assert.doesNotMatch(oauth, /staging|스테이징/i)
  assertMatches(oauth, [
    /http:\/\/localhost:5173\/community\/auth\/callback\//,
    /https:\/\/www\.breadlab\.ai\/community\/auth\/callback\//,
    /https:\/\/\$\{DEVELOPMENT_PROJECT_REF\}\.supabase\.co\/auth\/v1\/callback/,
    /https:\/\/\$\{PRODUCTION_PROJECT_REF\}\.supabase\.co\/auth\/v1\/callback/,
  ])
})

test('documents Free Plan pause, capacity, quota, and backup constraints', async () => {
  const text = await allOperationsText()
  assertMatches(text, [
    /paused project/i,
    /Resume project/i,
    /never fall(?:s)? back to production/i,
    /no artificial keepalive/i,
    /Free Plan/i,
    /managed daily backups?.*(?:not available|unavailable)/is,
    /PITR.*(?:not available|unavailable|must not)/is,
    /managed restore-to-new-project.*(?:not available|unavailable|must not)/is,
    /project clone.*(?:not available|unavailable|must not)/is,
    /temporary (?:paid )?upgrade.*(?:not a fallback|must not)/is,
    /paid.overage.*(?:never|must not)/is,
    /pause development.*(?:clean recovery target|recovery project)/is,
    /never repurpose production as development/i,
    /pg_cron/i,
    /pg_net/i,
    /current Free Plan quotas/i,
    /low.frequency/i,
  ])
})

test('documents encrypted logical backup, inventory, and recovery objectives', async () => {
  const text = await allOperationsText()
  assertMatches(text, [
    /pre-production migration/i,
    /logical database backup/i,
    /encrypt/i,
    /SHA-256/i,
    /private Storage inventory/i,
    /outside (?:the )?repository/i,
    /chmod 700/,
    /chmod 600/,
    /RPO.*24 hours?/is,
    /target RTO.*4 hours?/is,
    /quarterly restore drill/i,
    /database backups?.*do not include.*Storage.*object/is,
  ])
})

test('backup and restore plaintext cleanup is fail-closed and ciphertext publication is atomic', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /mkdir -m 700 "\$WORK_DIR"[\s\S]{0,1200}trap [^\n]*EXIT[\s\S]{0,300}trap [^\n]*INT[\s\S]{0,300}trap [^\n]*TERM/,
    /unset [^\n]*SUPABASE_DB_PASSWORD[^\n]*SUPABASE_ACCESS_TOKEN[^\n]*PRODUCTION_BACKUP_APPROVAL/,
    /rm -rf -- "\$WORK_DIR"/,
    /ARCHIVE_TMP=.*\$BACKUP_ROOT/,
    /age [^\n]*--output "\$ARCHIVE_TMP"/,
    /chmod 600 "\$ARCHIVE_TMP"[\s\S]*mv -- "\$ARCHIVE_TMP" "\$ARCHIVE"/,
    /sha256sum "\$ARCHIVE_BASENAME"/,
    /secure erase.*(?:not guaranteed|cannot be guaranteed).*SSD/is,
    /RESTORE_WORK_DIR[\s\S]{0,1200}trap [^\n]*EXIT[\s\S]{0,300}trap [^\n]*INT[\s\S]{0,300}trap [^\n]*TERM/,
    /cleanup_restore[\s\S]*trap - EXIT INT TERM/,
    /non-sensitive drill evidence/i,
  ])
})

test('backup includes migration history and restores all SQL atomically', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /db dump --project-ref "\$PRODUCTION_PROJECT_REF" --schema supabase_migrations[\s\\]*--file "\$WORK_DIR\/history_schema\.sql"/,
    /db dump --project-ref "\$PRODUCTION_PROJECT_REF" --data-only --use-copy[\s\\]*--schema supabase_migrations[\s\\]*--file "\$WORK_DIR\/history_data\.sql"/,
    /--exclude storage\.buckets_vectors[\s\\]*--exclude storage\.vector_indexes/,
    /psql --single-transaction --variable ON_ERROR_STOP=1[\s\S]*--file "\$RESTORE_WORK_DIR\/roles\.sql"[\s\S]*--file "\$RESTORE_WORK_DIR\/schema\.sql"[\s\S]*--file "\$RESTORE_WORK_DIR\/data\.sql"[\s\S]*--file "\$RESTORE_WORK_DIR\/history_schema\.sql"[\s\S]*--file "\$RESTORE_WORK_DIR\/history_data\.sql"/,
    /one `psql` process/i,
    /clean(?:,| ) empty recovery target/i,
    /plain SQL.*not.*pg_restore/is,
  ])
})

test('Storage copy commands use one verified local tree and explicit project targets', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /mkdir -m 700 "\$WORK_DIR\/storage-objects"[\s\S]*mkdir -m 700 "\$WORK_DIR\/storage-objects\/community-images"/,
    /storage cp --experimental --recursive --project-ref "\$PRODUCTION_PROJECT_REF"[\s\\]*ss:\/\/\/community-images\/ "\$WORK_DIR\/storage-objects"/,
    /test -d "\$WORK_DIR\/storage-objects\/community-images"/,
    /storage cp --experimental --recursive --project-ref "\$RECOVERY_PROJECT_REF"[\s\\]*"\$RESTORE_WORK_DIR\/storage-objects\/community-images" ss:\/\/\//,
  ])
})

test('Storage inventory is deterministic, counted, hashed, and compared to downloaded bytes', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /storage ls --experimental --recursive --project-ref "\$PRODUCTION_PROJECT_REF"[\s\\]*ss:\/\/\/community-images\/ \| normalize_storage_inventory > "\$WORK_DIR\/private-storage-inventory\.txt"/,
    /find "\$WORK_DIR\/storage-objects\/community-images" -type f -printf '%P\\n'[\s\\]*\| LC_ALL=C sort > "\$WORK_DIR\/downloaded-storage-paths\.txt"/,
    /diff --unified[^\n]*private-storage-inventory\.txt[^\n]*downloaded-storage-paths\.txt/,
    /STORAGE_OBJECT_COUNT="\$\(wc -l < "\$WORK_DIR\/private-storage-inventory\.txt"[^\n]*\)"/,
    /STORAGE_INVENTORY_SHA256="\$\(sha256sum "\$WORK_DIR\/private-storage-inventory\.txt"[^\n]*\)"/,
    /test "\$STORAGE_OBJECT_COUNT" = "\$\(wc -l < "\$WORK_DIR\/downloaded-storage-paths\.txt"[^\n]*\)"/,
    /find \. -type f[^\n]*-print0[\s\\]*\| LC_ALL=C sort -z \| xargs -0 sha256sum > payload-sha256\.txt/,
    /sha256sum --check payload-sha256\.txt/,
    /restored-storage-inventory\.txt/,
    /diff --unified[^\n]*private-storage-inventory\.txt[^\n]*restored-storage-inventory\.txt/,
    /RESTORED_STORAGE_OBJECT_COUNT="\$\(wc -l < "\$RESTORE_WORK_DIR\/restored-storage-inventory\.txt"[^\n]*\)"/,
    /RESTORED_STORAGE_INVENTORY_SHA256="\$\(sha256sum "\$RESTORE_WORK_DIR\/restored-storage-inventory\.txt"[^\n]*\)"/,
    /test "\$RESTORED_STORAGE_OBJECT_COUNT" = "\$\(sed -n 's\/\^storage_object_count=/,
    /test "\$RESTORED_STORAGE_INVENTORY_SHA256" = "\$\(sed -n 's\/\^storage_inventory_sha256=/,
    /no signed URLs?[^.]*no object bod(?:y|ies)/is,
  ])
})

test('Storage inventories normalize CLI 2.118 paths to relative object keys including an empty bucket', async () => {
  const backup = await operationText('community-backup-restore.md')
  const definition = backup.match(/normalize_storage_inventory\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(definition, 'the documented inventory normalizer must be executable')
  assert.match(backup, /storage ls --experimental --recursive --project-ref "\$PRODUCTION_PROJECT_REF"[\s\\]*ss:\/\/\/community-images\/ \| normalize_storage_inventory/)
  assert.match(backup, /find "\$WORK_DIR\/storage-objects\/community-images" -type f -printf '%P\\n'/)
  const emptyBucketRoot = backup.indexOf('mkdir -m 700 "$WORK_DIR/storage-objects/community-images"')
  const download = backup.indexOf('storage cp --experimental --recursive --project-ref "$PRODUCTION_PROJECT_REF"')
  assert.ok(emptyBucketRoot >= 0 && emptyBucketRoot < download, 'the local bucket root must exist before an empty recursive download')

  const runNormalizer = (input) => spawnSync('bash', ['-c', `${definition}\nnormalize_storage_inventory`], {
    encoding: 'utf8',
    input,
  })
  const populated = runNormalizer('/community-images/root.txt\n/community-images/nested/file.txt\n')
  assert.equal(populated.status, 0, populated.stderr)
  assert.equal(populated.stdout, 'nested/file.txt\nroot.txt\n')
  const empty = runNormalizer('')
  assert.equal(empty.status, 0, empty.stderr)
  assert.equal(empty.stdout, '')
  const malformed = runNormalizer('ss:///community-images/root.txt\n')
  assert.notEqual(malformed.status, 0, 'unexpected CLI listing formats must fail closed')

  const storageBlock = backup.match(/```bash\n(normalize_storage_inventory\(\) \{[\s\S]*?chmod 600 "\$WORK_DIR"\/\*\.sql "\$WORK_DIR"\/\*\.txt)\n```/)?.[1]
  assert.ok(storageBlock, 'the documented Storage backup block must be executable')
  const root = await mkdtemp(path.join(tmpdir(), 'community-empty-storage-'))
  try {
    const cli = path.join(root, 'community-app/node_modules/.bin/supabase')
    const work = path.join(root, 'work')
    const marker = path.join(root, 'cp-called')
    await mkdir(path.dirname(cli), { recursive: true })
    await mkdir(work)
    await writeFile(path.join(work, 'dummy.sql'), '')
    await writeFile(cli, `#!/usr/bin/env bash\nif [[ " $* " == *" storage ls "* ]]; then exit 0; fi\nif [[ " $* " == *" storage cp "* ]]; then : > "$CP_MARKER"; exit 17; fi\nexit 99\n`)
    await chmod(cli, 0o700)
    const result = spawnSync('bash', ['-c', `set -euo pipefail\n${storageBlock}`], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, WORK_DIR: work, REPO_ROOT: root, PRODUCTION_PROJECT_REF: 'example-ref', CP_MARKER: marker },
    })
    assert.equal(result.status, 0, result.stderr)
    await assert.rejects(readFile(marker), 'an empty bucket must not invoke recursive storage cp')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Storage restore uploads the downloaded bucket subtree exactly once and verifies target keys', async () => {
  const backup = await operationText('community-backup-restore.md')
  assert.match(backup, /storage cp --experimental --recursive --project-ref "\$RECOVERY_PROJECT_REF"[\s\\]*"\$RESTORE_WORK_DIR\/storage-objects\/community-images" ss:\/\/\/[\s\n]/)
  assert.doesNotMatch(backup, /"\$RESTORE_WORK_DIR\/storage-objects\/community-images" ss:\/\/\/community-images\/?/)
  assert.match(backup, /CLI 2\.118\.0[\s\S]*source basename `community-images`[\s\S]*exactly once[\s\S]*original object keys/i)
  assert.match(backup, /storage ls --experimental --recursive --project-ref "\$RECOVERY_PROJECT_REF"[\s\\]*ss:\/\/\/community-images\/ \| normalize_storage_inventory/)
  assert.match(backup, /diff --unified "\$RESTORE_WORK_DIR\/private-storage-inventory\.txt" "\$RESTORE_WORK_DIR\/restored-storage-inventory\.txt"/)
})

test('hosted Supabase procedures never persist a link and every remote command has an explicit target', async () => {
  const text = await allOperationsText()
  assert.doesNotMatch(text, /\bsupabase\b[^\n]*[\s\\]*\blink --project-ref|\bdb (?:dump|push) --linked\b/)
  const hostedCommands = bashCommands(text).filter((command) =>
    /\bsupabase\b/.test(command) && /\b(?:db (?:dump|push)|storage (?:ls|cp)|functions deploy)\b/.test(command))
  assert.ok(hostedCommands.length >= 15, 'expected all documented hosted CLI commands')
  for (const command of hostedCommands) {
    assert.match(command, /--project-ref "\$(?:DEVELOPMENT|PRODUCTION|RECOVERY)_PROJECT_REF"/, `implicit hosted target: ${command}`)
    assert.doesNotMatch(command, /\s--linked(?:\s|$)/, `linked-state target: ${command}`)
  }
})

test('archive checksum stores a basename and verifies the relocated archive/checksum pair', async () => {
  const backup = await operationText('community-backup-restore.md')
  assert.doesNotMatch(backup, /sha256sum "\$ARCHIVE" > "\$CHECKSUM_TMP"/)
  assert.match(backup, /ARCHIVE_DIR="\$\(dirname -- "\$ARCHIVE"\)"[\s\S]*ARCHIVE_BASENAME="\$\(basename -- "\$ARCHIVE"\)"/)
  assert.match(backup, /cd "\$ARCHIVE_DIR"[\s\S]{0,200}sha256sum "\$ARCHIVE_BASENAME" > "\$CHECKSUM_TMP"/)
  assert.match(backup, /mv -- "\$CHECKSUM_TMP" "\$CHECKSUM"/)
  assert.match(backup, /cd "\$ARCHIVE_DIR"[\s\S]{0,200}sha256sum --check "\$CHECKSUM_BASENAME"/)
  assert.match(backup, /CHECKSUM="\$ARCHIVE_DIR\/\$ARCHIVE_BASENAME\.sha256"/)
  assert.match(backup, /EXPECTED_ARCHIVE_CHECKSUM_RECORD="\$\(sha256sum "\$ARCHIVE_BASENAME"\)"/)
  assert.match(backup, /test "\$\(cat -- "\$CHECKSUM_BASENAME"\)" = "\$EXPECTED_ARCHIVE_CHECKSUM_RECORD"/)

  const root = await mkdtemp(path.join(tmpdir(), 'community-checksum-binding-'))
  try {
    await writeFile(path.join(root, 'A.tar.age'), 'archive-a')
    await writeFile(path.join(root, 'B.tar.age'), 'archive-b')
    const wrong = spawnSync('bash', ['-c', 'cd "$1"; sha256sum B.tar.age > A.tar.age.sha256; EXPECTED_ARCHIVE_CHECKSUM_RECORD="$(sha256sum A.tar.age)"; test "$(cat -- A.tar.age.sha256)" = "$EXPECTED_ARCHIVE_CHECKSUM_RECORD"', 'bash', root], { encoding: 'utf8' })
    assert.notEqual(wrong.status, 0, 'a sidecar naming another valid archive must be rejected')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restore path guards canonicalize external directories and publish evidence only after verified cleanup', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /RESTORE_ROOT="\$\(realpath -e -- "\$RESTORE_ROOT_INPUT"\)"/,
    /EVIDENCE_PARENT="\$\(realpath -e -- "\$EVIDENCE_PARENT_INPUT"\)"/,
    /"\$RESTORE_ROOT_INPUT" = "\$RESTORE_ROOT"/,
    /"\$EVIDENCE_PARENT_INPUT" = "\$EVIDENCE_PARENT"/,
    /\[ -d "\$RESTORE_ROOT" \] && \[ ! -L "\$RESTORE_ROOT" \]/,
    /\[ -d "\$EVIDENCE_PARENT" \] && \[ ! -L "\$EVIDENCE_PARENT" \]/,
    /case "\$RESTORE_DRILL_EVIDENCE_PATH" in "\$RESTORE_ROOT\/"\*\)/,
  ])
  const cleanup = backup.indexOf('cleanup_restore\ntest ! -e "$RESTORE_WORK_DIR"')
  const publish = backup.indexOf('mv -- "$RESTORE_EVIDENCE_TMP" "$RESTORE_DRILL_EVIDENCE_PATH"')
  assert.ok(cleanup >= 0, 'cleanup and an absence assertion must be adjacent')
  assert.ok(publish > cleanup, 'passed evidence must publish only after zero-residue verification')
  assert.match(backup, /restore_exit\(\)[\s\S]*if \[ "\$\{RESTORE_EVIDENCE_PUBLISHED:-0\}" -ne 1 \]; then[\s\S]*rm -f -- "\$\{RESTORE_EVIDENCE_TMP:-\}" "\$RESTORE_DRILL_EVIDENCE_PATH"/)

  const cleanupDefinition = backup.match(/cleanup_restore\(\) \{[\s\S]*?\n\}/)?.[0]
  const evidenceBlock = backup.match(/```bash\n(RESTORE_EVIDENCE_TMP="\$\(mktemp[\s\S]*?trap - EXIT INT TERM)\n```/)?.[1]
  assert.ok(cleanupDefinition && evidenceBlock, 'cleanup and evidence publication blocks must be executable')
  const root = await mkdtemp(path.join(tmpdir(), 'community-restore-evidence-'))
  try {
    const restoreWork = path.join(root, 'restore-work')
    const evidencePath = path.join(root, 'restore-evidence.txt')
    const checksum = path.join(root, 'archive.sha256')
    await mkdir(restoreWork)
    await writeFile(path.join(restoreWork, 'plaintext.sql'), 'sensitive')
    await writeFile(checksum, 'abc123  archive.tar.age\n')
    const result = spawnSync('bash', ['-c', `set -euo pipefail
RESTORE_WORK_DIR="$TEST_RESTORE_WORK"
RESTORE_DRILL_EVIDENCE_PATH="$TEST_EVIDENCE_PATH"
EVIDENCE_PARENT="$TEST_EVIDENCE_PARENT"
EVIDENCE_BASENAME="restore-evidence.txt"
CHECKSUM="$TEST_CHECKSUM"
RESTORED_STORAGE_OBJECT_COUNT=0
RESTORED_STORAGE_INVENTORY_SHA256=empty
RESTORE_EVIDENCE_TMP=''
RESTORE_EVIDENCE_PUBLISHED=0
${cleanupDefinition}
${evidenceBlock}`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TEST_RESTORE_WORK: restoreWork,
        TEST_EVIDENCE_PATH: evidencePath,
        TEST_EVIDENCE_PARENT: root,
        TEST_CHECKSUM: checksum,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(await readFile(evidencePath, 'utf8'), /zero_plaintext_retained=true/)
    await assert.rejects(readFile(path.join(restoreWork, 'plaintext.sql')), 'plaintext must be absent before evidence publication')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('documents safe credentials and explicit project targeting', async () => {
  const text = await allOperationsText()
  assertMatches(text, [
    /read -rsp ['"]Production database password: ['"] SUPABASE_DB_PASSWORD/,
    /export SUPABASE_DB_PASSWORD/,
    /nonempty/i,
    /DEVELOPMENT_PROJECT_REF.*PRODUCTION_PROJECT_REF.*(?:must differ|distinct)/is,
    /--project-ref "\$DEVELOPMENT_PROJECT_REF"/,
    /--project-ref "\$PRODUCTION_PROJECT_REF"/,
    /publishable key.*public/is,
    /(?:service-role|privileged).*password.*OAuth secret.*(?:private|secret|must not)/is,
    /never.*(?:CLI literal|command-line literal)/is,
    /never.*repository.*evidence.*Pages/is,
    /manual approval/i,
    /release-gate\.mjs.*never (?:runs|invokes)/is,
  ])
})

test('documents development integration and exact zero-residue cleanup', async () => {
  const text = await allOperationsText()
  assertMatches(text, [
    /development migration/i,
    /Functions/i,
    /OAuth/i,
    /Storage integration/i,
    /operator-recorded fixture IDs/i,
    /zero-residue read-back/i,
  ])
})

test('documents exact promotion order and separates probes from canary writes', async () => {
  const checklist = await operationText('community-release-checklist.md')
  const ordered = [
    'local exhaustive',
    'Task 16 E2E',
    'development cloud integration',
    'production backup',
    'additive backend deployment',
    'production read-only probes',
    'Pages deployment',
    'separately approved bounded write canary',
    'exact cleanup/read-back',
    'snapshots re-enable/observe',
  ]
  let cursor = -1
  for (const phrase of ordered) {
    const next = checklist.indexOf(phrase)
    assert.ok(next > cursor, `${phrase} must occur in promotion order`)
    cursor = next
  }
  assertMatches(checklist, [
    /read-only production probe.*strictly separate.*approved write canary/is,
    /pause.*community-snapshots\.yml.*canary/is,
    /restore.*community-snapshots\.yml.*cleanup/is,
    /deterministic prefix.*UUID/is,
    /exact canary fixture IDs/i,
    /zero-residue read-back/i,
  ])
})

test('production canary is an exact fail-closed Task 16 command contract', async () => {
  const runbook = await operationText('community-release-runbook.md')
  const checklist = await operationText('community-release-checklist.md')
  assertMatches(runbook, [
    /scripts\/community-production-canary\.mjs/,
    /currently (?:absent|not implemented).*Task 16.*prerequisite.*production release remains blocked/is,
    /PRODUCTION_CANARY_APPROVAL/,
    /CANARY_RUN_ID=.*randomUUID/,
    /release-canary-\$\{CANARY_RUN_ID\}/,
    /PRODUCTION_CANARY_EVIDENCE_PATH.*absolute.*outside (?:the )?repository/is,
    /CANARY_MAX_POSTS=1[\s\S]*CANARY_MAX_COMMENTS=1[\s\S]*CANARY_MAX_REACTIONS=1[\s\S]*CANARY_MAX_REPORTS=1[\s\S]*CANARY_MAX_OBJECTS=1/,
    /post ID.*comment ID.*reaction ID.*report ID.*object (?:ID|path)/is,
    /exact-ID cleanup/i,
    /exit nonzero.*zero-residue read-back.*(?:finds|detects).*residue/is,
    /gh workflow disable community-snapshots\.yml[\s\S]*community-production-canary\.mjs[\s\S]*gh workflow enable community-snapshots\.yml/,
    /community-production-canary\.mjs[\s\\]*--cleanup-exact-ids[\s\\]*--assert-zero-residue/,
    /re-enable[^.]*only after[^.]*cleanup[^.]*zero-residue read-back/is,
  ])
  assertMatches(checklist, [
    /node scripts\/community-production-canary\.mjs/,
    /currently (?:absent|not implemented).*Task 16/is,
    /hard write limits/i,
    /post.*comment.*reaction.*report.*object IDs/is,
    /do not re-enable.*community-snapshots\.yml.*until.*zero-residue/is,
    /community-production-canary\.mjs[\s\\]*--cleanup-exact-ids[\s\\]*--assert-zero-residue/,
  ])
})

test('documents forward-only database and source-driven Pages rollback', async () => {
  const text = await allOperationsText()
  assertMatches(text, [
    /additive migration/i,
    /no destructive down migration/i,
    /write-disable/i,
    /forward-fix/i,
    /disable writes.*backend mutation surface.*rollback Pages.*known-good source commit.*workflow.*forward-fix/is,
    /no destructive rollback/i,
    /preserve.*backup.*evidence/is,
  ])
})

test('uses only official Supabase and GitHub documentation links', async () => {
  const text = await allOperationsText()
  assertMatches(text, [
    /https:\/\/supabase\.com\/docs\/guides\/local-development\/cli\/getting-started/,
    /https:\/\/supabase\.com\/docs\/guides\/platform\/migrating-within-supabase\/backup-restore/,
    /https:\/\/supabase\.com\/docs\/guides\/auth\/redirect-urls/,
    /https:\/\/supabase\.com\/docs\/guides\/storage\/management\/download-objects/,
    /https:\/\/supabase\.com\/docs\/guides\/functions\/deploy/,
    /https:\/\/supabase\.com\/docs\/guides\/functions\/schedule-functions/,
    /https:\/\/docs\.github\.com\/en\/apps\/oauth-apps\/building-oauth-apps\/creating-an-oauth-app/,
    /https:\/\/docs\.github\.com\/en\/pages\/getting-started-with-github-pages\/using-custom-workflows-with-github-pages/,
  ])
  const documentationUrls = text.match(/https:\/\/(?:supabase\.com\/docs|docs\.github\.com)\/[^\s)>]+/g) ?? []
  for (const url of documentationUrls) {
    assert.ok(url.startsWith('https://supabase.com/docs/') || url.startsWith('https://docs.github.com/'), `non-authoritative documentation URL: ${url}`)
  }
})

test('contains no unresolved markers or secret-looking examples', async () => {
  const oauth = await operationText('community-oauth-setup.md')
  assert.ok(oauth.trim().length > 0, 'OAuth setup must be nonempty')
  const text = `${await allOperationsText()}\n${oauth}\n${await readFile(path.join(repoRoot, 'README.md'), 'utf8')}`
  assert.ok(text.includes(oauth), 'OAuth setup path must be included in the safety scan')
  assert.doesNotMatch(text, /\b(?:TODO|TBD|CHANGEME)\b/)
  assert.doesNotMatch(text, /\bsb_secret_[A-Za-z0-9._-]+/)
  assert.doesNotMatch(text, /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/)
  assert.doesNotMatch(text, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/)
  assert.doesNotMatch(text, /postgres(?:ql)?:\/\/[^\s"'<>]+/i)
})

test('README links runbooks and states the non-deploying gate boundary', async () => {
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8')
  for (const name of operationFiles) assert.match(readme, new RegExp(`docs/operations/${name.replaceAll('.', '\\.')}`))
  assert.match(readme, /release gate.*(?:does not|never).*(?:deploy|hosted mutation)/is)
})

for (const leakedSource of operationFiles) {
  test(`verify-site rejects docs/operations/${leakedSource}`, async () => {
    const root = await makeValidArtifact()
    try {
      await put(root, `docs/operations/${leakedSource}`, 'operational source')
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${leakedSource}`)
      assert.match(result.stderr, /implementation\/private path leaked/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

for (const leakedSource of operationFiles) {
  test(`verify-site rejects ${leakedSource} from an arbitrary publishable path`, async () => {
    const root = await makeValidArtifact()
    try {
      await put(root, `public-copy/${leakedSource}`, 'operational source')
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted public-copy/${leakedSource}`)
      assert.match(result.stderr, /community operations source leaked/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
