import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, copyFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
const sha = (raw) => createHash('sha256').update(raw).digest('hex')
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'benefits-generator-'))
  try {
    await mkdir(path.join(root, 'scripts'), { recursive: true })
    await mkdir(path.join(root, 'community-app/src/data'), { recursive: true })
    const script = path.join(root, 'scripts/generate-benefits-fixtures.mjs')
    await copyFile(
      new URL('./generate-benefits-fixtures.mjs', import.meta.url),
      script,
    )
    const generate = () => {
      const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
    generate()
    await run(root, generate)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('fixture generator emits fictional-only version/count/hash-consistent artifacts', async () =>
  fixture(async (root) => {
    const base = path.join(root, 'community-app/public')
    const manifest = JSON.parse(
      await readFile(
        path.join(base, 'data/company-benefits/manifest.json'),
        'utf8',
      ),
    )
    assert.equal(manifest.fixture, true)
    assert.equal(manifest.company_count, 56)
    assert.equal(new Set(Object.values(manifest.detail_shards)).size, 56)
    assert.ok(
      Object.entries(manifest.detail_shards).every(
        ([id, url]) => url.endsWith(`/details/${id}.json`),
      ),
    )
    for (const [url, descriptor] of Object.entries(manifest.artifact_sha256)) {
      const raw = await readFile(
        path.join(base, url.replace('/community/', '')),
        'utf8',
      )
      assert.equal(sha(raw), descriptor.sha256)
      const data = JSON.parse(raw)
      assert.equal(data.data_version, manifest.data_version)
      assert.equal(
        (data.companies ?? data.rows ?? data.paragraphs).length,
        descriptor.record_count,
      )
    }
    const index = JSON.parse(
      await readFile(
        path.join(base, 'data/company-benefits/fixture-v1/company-index.json'),
        'utf8',
      ),
    )
    assert.equal(new Set(index.companies.map((c) => c.company_id)).size, 56)
    assert.ok(
      index.companies.every(
        (c) =>
          c.company_id.startsWith('example-') &&
          c.display_name.startsWith('예시 '),
      ),
    )
    const details = {
      companies: (
        await Promise.all(
          Object.values(manifest.detail_shards).map(async (url) =>
            JSON.parse(
              await readFile(path.join(base, url.replace('/community/', '')), 'utf8'),
            ),
          ),
        )
      ).flatMap((shard) => {
        assert.equal(shard.companies.length, 1)
        return shard.companies
      }),
    }
    assert.ok(
      details.companies.every(
        (c) =>
          c.community_post_id === null &&
          c.claims.every(
            (claim) =>
              claim.source.url === 'https://example.org/benefits' &&
              claim.description.includes('가상의'),
          ),
      ),
    )
  }))
test('identical fixture inputs generate byte-identical artifacts and local methodology', async () =>
  fixture(async (root, generate) => {
    const base = path.join(root, 'community-app/public')
    const manifestFile = path.join(base, 'data/company-benefits/manifest.json')
    const first = await readFile(manifestFile, 'utf8')
    const manifest = JSON.parse(first)
    const paths = [
      manifestFile,
      path.join(base, 'data/company-benefits/fixture-v1/manifest.json'),
      path.join(root, 'community-app/src/data/benefitsMethodology.json'),
      ...Object.keys(manifest.artifact_sha256).map((url) =>
        path.join(base, url.replace('/community/', '')),
      ),
    ]
    const before = await Promise.all(
      paths.map((file) => readFile(file, 'utf8')),
    )
    generate()
    assert.deepEqual(
      await Promise.all(paths.map((file) => readFile(file, 'utf8'))),
      before,
    )
  }))
