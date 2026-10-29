import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('2,000-company browser boundary covers bounded detail shard requests', async () => {
  const source = await readFile(
    path.join(root, 'scripts/check-benefits-browser.mjs'),
    'utf8',
  )

  assert.match(source, /await navigate\('rankings\/\?categories=family'/)
  assert.match(source, /2000-company rankings[^\n]*50-row cap/)
  assert.match(source, /await navigate\('fit\/\?preset=custom&weights=family:5'/)
  assert.match(source, /detailRequestCount/)
  assert.match(source, /detailResponseBytes/)
  assert.match(source, /detailLoadMs/)
  assert.match(source, /2000-company fit[^\n]*bounded detail shards/)
})