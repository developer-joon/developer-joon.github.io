import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('browser cleanup waits for Chromium exit before removing its profile', async () => {
  const { cleanupBrowserSmoke } = await import('./browser-smoke-cleanup.mjs')
  class Browser extends EventEmitter {
    exitCode = null
    signalCode = null
    kill(signal) {
      setTimeout(() => {
        this.signalCode = signal
        this.emit('close', null, signal)
      }, 10)
      return true
    }
  }
  const browser = new Browser()
  let serverClosed = false
  let socketClosed = false
  let profileRemoved = false
  const server = {
    close(callback) {
      serverClosed = true
      callback()
    },
  }

  await cleanupBrowserSmoke({
    socket: { close: () => { socketClosed = true } },
    browser,
    server,
    profile: '/ephemeral/profile',
    removeProfile: async () => {
      assert.notEqual(browser.signalCode, null)
      profileRemoved = true
    },
  })

  assert.equal(socketClosed, true)
  assert.equal(serverClosed, true)
  assert.equal(profileRemoved, true)
})
test('browser smoke verifies the published Atlas and concrete benefit states', async () => {
  const source = await readFile(path.join(root, 'scripts/check-benefits-browser.mjs'), 'utf8')
  assert.match(source, /manifest\.json/)
  assert.match(source, /querySelectorAll\('tr\[data-company-id\]'\)\.length > 0/)
  assert.match(source, /혜택 내용 확인/)
  assert.match(source, /구체 혜택 확인 필요/)
  assert.match(source, /benefits-specific-card/)
  assert.match(source, /benefits-evidence h2/)
  assert.match(source, /benefits\/rankings\/index\.html/)
  assert.doesNotMatch(source, /absent manifest|zero company rows|fixture-v1|rankings_url|fitScore|rankOrder/)
})

test('built Atlas source contract consumes approved-v2 lineage and tiered evidence', async () => {
  const client = await readFile(path.join(root, 'community-app/src/data/benefitsArtifactClient.ts'), 'utf8')
  const explorer = await readFile(path.join(root, 'community-app/src/components/benefits/BenefitsExplorerShell.tsx'), 'utf8')
  const detail = await readFile(path.join(root, 'community-app/src/components/benefits/BenefitV2EvidenceGroup.tsx'), 'utf8')
  const company = await readFile(path.join(root, 'community-app/src/pages/BenefitsCompanyPage.tsx'), 'utf8')
  assert.match(client, /loadApprovedV2Projection/)
  assert.match(client, /runBounded/)
  assert.match(client, /approved projection canonical company join mismatch/)
  assert.match(client, /assertCompanyDetailEvidence/)
  assert.match(client, /loadAtlasCompanyDetails/)
  assert.match(explorer, /승인 v2 조사 · 전체/)
  assert.match(company, /BenefitV2EvidenceSection/)
  assert.match(company, /기존 공개 기록/)
  assert.match(detail, /확인된 복지 혜택/)
  assert.match(detail, /record\.statement/)
  assert.match(detail, /record\.supporting_quote/)
  assert.match(detail, /커뮤니티 보고/)
  assert.match(detail, /target="_blank" rel="noopener noreferrer"/)
})
