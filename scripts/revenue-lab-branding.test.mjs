import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brandName = '수익실험실'
const coverPath = '/images/revenue-lab/cover.png'

function readRepositoryFile(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
}

function readFrontMatter(relativePath) {
  const content = readRepositoryFile(relativePath)
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)

  assert.ok(match, `${relativePath} must contain front matter`)
  return match[1]
}

const exactBrandScalar = `(?:"${brandName}"|'${brandName}'|${brandName})`

test('index.html uses the 수익실험실 brand in its title and hero heading', () => {
  const frontMatter = readFrontMatter('index.html')
  const homepage = readRepositoryFile('index.html')

  assert.match(frontMatter, new RegExp(`^title:\\s*${exactBrandScalar}\\s*$`, 'mu'))
  assert.match(homepage, /<h1>수익실험실<\/h1>/u)
})

test('_pages/lab.md uses 수익실험실 as its front-matter title', () => {
  const frontMatter = readFrontMatter('_pages/lab.md')

  assert.match(frontMatter, new RegExp(`^title:\\s*${exactBrandScalar}\\s*$`, 'mu'))
})

test('_pages/about.md starts its front-matter subtitle with 수익실험실', () => {
  const frontMatter = readFrontMatter('_pages/about.md')

  assert.match(frontMatter, /^subtitle:\s*(?:"수익실험실,|'수익실험실,|수익실험실,)/mu)
})

test('_data/settings.yml labels the /lab/ menu item 수익실험실', () => {
  const settings = readRepositoryFile('_data/settings.yml')

  assert.match(settings, /- title:\s*(?:"수익실험실"|'수익실험실'|수익실험실)\s*\r?\n\s*url:\s*["']\/lab\/["']\s*$/mu)
})

test('AppHeader labels the /lab/ link 수익실험실', () => {
  const appHeader = readRepositoryFile('community-app/src/components/AppHeader.tsx')

  assert.match(appHeader, /\{\s*label:\s*['"]수익실험실['"],\s*href:\s*['"]\/lab\/['"]\s*\}/u)
})

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
