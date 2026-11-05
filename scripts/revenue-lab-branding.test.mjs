import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brandName = '수익실험실'
const oldBrandName = '0 → 1'
const coverPath = '/images/revenue-lab/cover.png'

function readRepositoryFile(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
}

const publicBrandSurfaces = [
  'index.html',
  '_pages/lab.md',
  '_pages/about.md',
  '_data/settings.yml',
  'community-app/src/components/AppHeader.tsx',
]

for (const relativePath of publicBrandSurfaces) {
  test(`${relativePath} uses the public 수익실험실 brand`, () => {
    const content = readRepositoryFile(relativePath)

    assert.ok(content.includes(brandName), `${relativePath} must include ${brandName}`)
    assert.ok(!content.includes(oldBrandName), `${relativePath} must not include ${oldBrandName}`)
  })
}

test('the canonical lab route remains /lab/ across Jekyll and React', () => {
  const labPage = readRepositoryFile('_pages/lab.md')
  const homepage = readRepositoryFile('index.html')
  const settings = readRepositoryFile('_data/settings.yml')
  const appHeader = readRepositoryFile('community-app/src/components/AppHeader.tsx')

  assert.match(labPage, /^permalink:\s*\/lab\/\s*$/mu)
  assert.match(homepage, /href=["']\/lab\/["']/u)
  assert.match(settings, /- title:\s*["'][^"']+["']\s*\n\s*url:\s*["']\/lab\/["']/u)
  assert.match(appHeader, /\{\s*label:\s*['"][^'"]+['"],\s*href:\s*['"]\/lab\/['"]\s*\}/u)
})

test('the homepage and lab page share the revenue lab cover image', () => {
  const homepage = readRepositoryFile('index.html')
  const labPage = readRepositoryFile('_pages/lab.md')
  const featuredImage = /^featured_image:\s*(\S+)\s*$/mu
  const homepageMatch = homepage.match(featuredImage)
  const labPageMatch = labPage.match(featuredImage)

  assert.ok(homepageMatch, 'index.html must define featured_image')
  assert.ok(labPageMatch, '_pages/lab.md must define featured_image')
  assert.equal(homepageMatch[1], coverPath)
  assert.equal(labPageMatch[1], coverPath)
})

test('the revenue lab cover is a 1600×900 PNG', () => {
  const imagePath = resolve(repositoryRoot, `.${coverPath}`)
  assert.ok(existsSync(imagePath), `${coverPath} must exist`)

  const png = readFileSync(imagePath)
  assert.ok(png.length >= 24, 'PNG must contain a signature and IHDR dimensions')
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR')
  assert.equal(png.readUInt32BE(16), 1600)
  assert.equal(png.readUInt32BE(20), 900)
})
