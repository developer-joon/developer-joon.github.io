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
