import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
test('browser smoke covers supported routes and the absent-manifest fail-closed state', async () => {
  const source = await readFile(path.join(root, 'scripts/check-benefits-browser.mjs'), 'utf8')
  assert.match(source, /\['', 'fit\/', 'company\/', 'methodology\/'\]/)
  assert.match(source, /manifest\.json/)
  assert.match(source, /querySelectorAll\('\[data-company-id\]'\)\.length/)
  assert.match(source, /benefits\/rankings\/index\.html/)
  assert.doesNotMatch(source, /fixture-v1|rankings_url|fitScore|rankOrder/)
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
  assert.match(company, /승인 v2 조사 근거/)
  assert.match(company, /기존 공개 기록/)
  assert.match(detail, /record\.statement/)
  assert.match(detail, /record\.supporting_quote/)
  assert.match(detail, /커뮤니티 보고 · 하위 근거 계층/)
  assert.match(detail, /target="_blank" rel="noopener noreferrer"/)
})
