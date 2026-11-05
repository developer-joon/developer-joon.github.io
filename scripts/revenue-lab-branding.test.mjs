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

function normalizeScalar(value) {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function readFrontMatterScalars(relativePath, requiredKeys) {
  const content = readRepositoryFile(relativePath)
  const lines = content.split(/\r?\n/u)

  assert.equal(lines[0], '---', `${relativePath} must start with front matter`)
  const closingDelimiter = lines.indexOf('---', 1)
  assert.notEqual(closingDelimiter, -1, `${relativePath} front matter must have a closing ---`)

  const scalars = new Map()
  for (const line of lines.slice(1, closingDelimiter)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/u)
    if (!match) continue

    const [, key, rawValue] = match
    assert.ok(!scalars.has(key), `${relativePath} front matter must not duplicate ${key}`)
    scalars.set(key, normalizeScalar(rawValue))
  }

  for (const key of requiredKeys) {
    assert.ok(scalars.has(key), `${relativePath} front matter must define ${key}`)
  }

  return Object.fromEntries(scalars)
}

function readMenuItems() {
  const relativePath = '_data/settings.yml'
  const lines = readRepositoryFile(relativePath).split(/\r?\n/u)
  const menuSettingsIndexes = lines.flatMap((line, index) => line === 'menu_settings:' ? [index] : [])
  assert.equal(menuSettingsIndexes.length, 1, `${relativePath} must define one menu_settings block`)

  const menuSettingsIndex = menuSettingsIndexes[0]
  const menuItemsIndexes = lines.flatMap((line, index) => (
    index > menuSettingsIndex && line === '  menu_items:' ? [index] : []
  ))
  const menuItemsIndex = menuItemsIndexes.find((index) => {
    const intervening = lines.slice(menuSettingsIndex + 1, index)
    return intervening.every((line) => line.trim() === '' || /^\s/u.test(line))
  })
  assert.notEqual(menuItemsIndex, undefined, `${relativePath} must define menu_settings.menu_items`)

  const block = []
  for (const line of lines.slice(menuItemsIndex + 1)) {
    if (line.trim() !== '' && !/^\s{4,}/u.test(line)) break
    block.push(line)
  }

  const items = []
  let currentItem
  for (const line of block) {
    if (line.trim() === '' || /^\s*#/u.test(line)) continue

    const firstField = line.match(/^\s{4}-\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/u)
    const subsequentField = line.match(/^\s{6}([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/u)
    const field = firstField ?? subsequentField
    if (!field) continue

    if (firstField) {
      currentItem = {}
      items.push(currentItem)
    }
    assert.ok(currentItem, `${relativePath} menu item field must follow a list item`)

    const [, key, rawValue] = field
    assert.ok(!(key in currentItem), `${relativePath} menu item must not duplicate ${key}`)
    currentItem[key] = normalizeScalar(rawValue)
  }

  return items
}

const indexFrontMatter = readFrontMatterScalars('index.html', ['title', 'description', 'featured_image'])
const labFrontMatter = readFrontMatterScalars('_pages/lab.md', ['title', 'description', 'permalink', 'featured_image'])
const aboutFrontMatter = readFrontMatterScalars('_pages/about.md', ['subtitle'])

test('index.html uses 수익실험실 as its exact front-matter title', () => {
  assert.equal(indexFrontMatter.title, brandName)
})

test('index.html description names 수익실험실', () => {
  assert.match(indexFrontMatter.description, /수익실험실/u)
})

test('index.html hero heading is exactly 수익실험실', () => {
  const homepage = readRepositoryFile('index.html')
  assert.match(homepage, /<h1\b[^>]*>\s*수익실험실\s*<\/h1>/u)
})

test('_pages/lab.md uses 수익실험실 as its exact front-matter title', () => {
  assert.equal(labFrontMatter.title, brandName)
})

test('_pages/lab.md description names 수익실험실', () => {
  assert.match(labFrontMatter.description, /수익실험실/u)
})

test('_pages/about.md uses the exact 수익실험실 subtitle', () => {
  assert.equal(aboutFrontMatter.subtitle, '수익실험실, 코드로 수익모델을 검증하는 실험')
})

test('the canonical lab permalink remains /lab/', () => {
  assert.equal(labFrontMatter.permalink, '/lab/')
})

test('_data/settings.yml labels exactly one /lab/ menu item 수익실험실', () => {
  const labItems = readMenuItems().filter(({ url }) => url === '/lab/')

  assert.equal(labItems.length, 1, '_data/settings.yml must define exactly one /lab/ menu item')
  assert.equal(labItems[0].title, brandName)
})

test('the homepage and lab page share the revenue lab cover image', () => {
  assert.equal(indexFrontMatter.featured_image, coverPath)
  assert.equal(labFrontMatter.featured_image, coverPath)
})

test('the revenue lab cover is a 1600×900 PNG', () => {
  const imagePath = resolve(repositoryRoot, `.${coverPath}`)
  assert.ok(existsSync(imagePath), `${coverPath} must exist`)

  const png = readFileSync(imagePath)
  assert.ok(png.length >= 33, 'PNG must contain a complete IHDR chunk')
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'PNG signature must be valid',
  )
  assert.equal(png.readUInt32BE(8), 13, 'first PNG chunk length must be 13')
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR', 'first PNG chunk must be IHDR')
  assert.equal(png.readUInt32BE(16), 1600, 'PNG width must be 1600')
  assert.equal(png.readUInt32BE(20), 900, 'PNG height must be 900')
})
