#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
    /sha256sum "\$ARCHIVE"/,
    /secure erase.*(?:not guaranteed|cannot be guaranteed).*SSD/is,
    /RESTORE_WORK_DIR[\s\S]{0,1200}trap [^\n]*EXIT[\s\S]{0,300}trap [^\n]*INT[\s\S]{0,300}trap [^\n]*TERM/,
    /cleanup_restore[\s\S]*trap - EXIT INT TERM/,
    /non-sensitive drill evidence/i,
  ])
})

test('backup includes migration history and restores all SQL atomically', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /db dump --linked --schema supabase_migrations --file "\$WORK_DIR\/history_schema\.sql"/,
    /db dump --linked --data-only --use-copy --schema supabase_migrations[\s\\]*--file "\$WORK_DIR\/history_data\.sql"/,
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
    /mkdir -m 700 "\$WORK_DIR\/storage-objects"/,
    /storage cp --experimental --recursive --project-ref "\$PRODUCTION_PROJECT_REF"[\s\\]*ss:\/\/\/community-images "\$WORK_DIR\/storage-objects"/,
    /test -d "\$WORK_DIR\/storage-objects\/community-images"/,
    /storage cp --experimental --recursive --project-ref "\$RECOVERY_PROJECT_REF"[\s\\]*"\$RESTORE_WORK_DIR\/storage-objects\/community-images" ss:\/\/\/community-images/,
  ])
})

test('Storage inventory is deterministic, counted, hashed, and compared to downloaded bytes', async () => {
  const backup = await operationText('community-backup-restore.md')
  assertMatches(backup, [
    /storage ls --experimental --recursive --project-ref "\$PRODUCTION_PROJECT_REF"[\s\\]*ss:\/\/\/community-images \| LC_ALL=C sort > "\$WORK_DIR\/private-storage-inventory\.txt"/,
    /find "\$WORK_DIR\/storage-objects\/community-images" -type f[^\n]*[\s\\]*\| LC_ALL=C sort > "\$WORK_DIR\/downloaded-storage-paths\.txt"/,
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
