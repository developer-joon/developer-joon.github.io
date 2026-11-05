import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync, inflateSync } from 'node:zlib'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brandName = '수익실험실'
const oldBrandName = '0 → 1'
const heroPath = '/images/revenue-lab/hero.png'
const socialImagePath = '/images/revenue-lab/cover.png'

function readRepositoryFile(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
}

function stripYamlInlineComment(value) {
  let quote

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]

    if (quote === '"' && character === '\\') {
      index += 1
      continue
    }
    if (quote === "'" && character === "'" && value[index + 1] === "'") {
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? undefined : quote ?? character
      continue
    }
    if (character === '#' && quote === undefined && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index)
    }
  }

  return value
}

function normalizeScalar(value) {
  const trimmed = stripYamlInlineComment(value).trim()
  const quote = trimmed[0]

  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseFrontMatterScalars(content, sourceName, requiredKeys) {
  const lines = content.split(/\r?\n/u)

  assert.equal(lines[0], '---', `${sourceName} must start with front matter`)
  const closingDelimiter = lines.indexOf('---', 1)
  assert.notEqual(closingDelimiter, -1, `${sourceName} front matter must have a closing ---`)

  const scalars = new Map()
  for (const line of lines.slice(1, closingDelimiter)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/u)
    if (!match) continue

    const [, key, rawValue] = match
    assert.ok(!scalars.has(key), `${sourceName} front matter must not duplicate ${key}`)
    scalars.set(key, normalizeScalar(rawValue))
  }

  for (const key of requiredKeys) {
    assert.ok(scalars.has(key), `${sourceName} front matter must define ${key}`)
  }

  return Object.fromEntries(scalars)
}

function readFrontMatterScalars(relativePath, requiredKeys) {
  return parseFrontMatterScalars(readRepositoryFile(relativePath), relativePath, requiredKeys)
}

function extractVisibleH1Text(html, sourceName) {
  const visibleHtml = html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
  const headings = [...visibleHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/giu)]

  assert.equal(headings.length, 1, `${sourceName} must contain exactly one visible h1`)
  return headings[0][1].replace(/<[^>]*>/gu, '').trim()
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

function inflatePngScanlines(compressed, expectedLength) {
  return inflateSync(compressed, { maxOutputLength: expectedLength })
}

function validatePngScanlineFilters(inflated, width, height, channels) {
  const rowStride = 1 + width * channels

  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[row * rowStride]
    assert.ok(filterType >= 0 && filterType <= 4, `PNG scanline ${row} filter type must be 0..4`)
  }
}

function validateRevenueLabPng(relativeImagePath) {
  const imagePath = resolve(repositoryRoot, `.${relativeImagePath}`)
  assert.ok(existsSync(imagePath), `${relativeImagePath} must exist`)
  const png = readFileSync(imagePath)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  assert.ok(png.length >= signature.length, 'PNG signature must be present')
  assert.deepEqual(png.subarray(0, signature.length), signature, 'PNG signature must be valid')

  let offset = signature.length
  let chunkIndex = 0
  let ihdr
  const idatParts = []
  let sawIend = false

  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, 'PNG chunk header and CRC must be complete')
    const length = png.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = typeStart + 4
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    assert.ok(chunkEnd <= png.length, 'PNG chunk data must stay within file bounds')

    const typeBytes = png.subarray(typeStart, dataStart)
    const type = typeBytes.toString('ascii')
    const data = png.subarray(dataStart, dataEnd)
    const expectedCrc = png.readUInt32BE(dataEnd)
    const actualCrc = crc32(Buffer.concat([typeBytes, data])) >>> 0
    assert.equal(actualCrc, expectedCrc, `${type || 'unknown'} chunk CRC must be valid`)

    if (chunkIndex === 0) {
      assert.equal(type, 'IHDR', 'first PNG chunk must be IHDR')
      assert.equal(length, 13, 'IHDR chunk length must be 13')
    }

    if (type === 'IHDR') {
      assert.equal(chunkIndex, 0, 'PNG must contain exactly one leading IHDR')
      ihdr = data
    } else if (type === 'IDAT') {
      assert.ok(length > 0, 'PNG IDAT chunks must be nonempty')
      idatParts.push(data)
    } else if (type === 'IEND') {
      assert.equal(length, 0, 'IEND chunk length must be 0')
      sawIend = true
      offset = chunkEnd
      assert.equal(offset, png.length, 'IEND must be terminal with no trailing bytes')
      break
    }

    offset = chunkEnd
    chunkIndex += 1
  }

  assert.ok(ihdr, 'PNG must contain IHDR')
  assert.ok(sawIend, 'PNG must contain exactly one terminal IEND')
  assert.ok(idatParts.length > 0, 'PNG must contain at least one nonempty IDAT')

  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  assert.equal(width, 1600, 'PNG width must be 1600')
  assert.equal(height, 900, 'PNG height must be 900')
  assert.equal(bitDepth, 8, 'PNG bit depth must be 8')
  assert.ok(colorType === 2 || colorType === 6, 'PNG color type must be RGB or RGBA')
  assert.equal(ihdr[10], 0, 'PNG compression method must be 0')
  assert.equal(ihdr[11], 0, 'PNG filter method must be 0')
  assert.equal(ihdr[12], 0, 'PNG interlace method must be 0')

  const channels = colorType === 2 ? 3 : 4
  const expectedInflatedLength = height * (1 + width * channels)
  let inflated
  assert.doesNotThrow(() => {
    inflated = inflatePngScanlines(Buffer.concat(idatParts), expectedInflatedLength)
  }, 'PNG IDAT data must inflate successfully')
  assert.equal(
    inflated.length,
    expectedInflatedLength,
    'PNG decompressed scanline length must match its dimensions and color type',
  )
  validatePngScanlineFilters(inflated, width, height, channels)
}

const indexFrontMatter = readFrontMatterScalars('index.html', ['title', 'description', 'featured_image', 'social_image'])
const labFrontMatter = readFrontMatterScalars('_pages/lab.md', ['title', 'description', 'permalink', 'featured_image', 'social_image'])
const aboutFrontMatter = readFrontMatterScalars('_pages/about.md', ['subtitle'])
const defaultLayout = readRepositoryFile('_layouts/default.html')

const brandFrontMatter = [
  ['index.html', indexFrontMatter],
  ['_pages/lab.md', labFrontMatter],
  ['_pages/about.md', aboutFrontMatter],
]

test('PNG inflation rejects data expanding beyond the expected scanline length', () => {
  const expectedLength = 8
  const compressed = deflateSync(Buffer.alloc(1024 * 1024))

  assert.throws(
    () => inflatePngScanlines(compressed, expectedLength),
    {
      code: 'ERR_BUFFER_TOO_LARGE',
      message: `Cannot create a Buffer larger than ${expectedLength} bytes`,
    },
  )
})

test('PNG scanline validation rejects filter type 5', () => {
  const inflated = Buffer.from([0, 0, 0, 0, 5, 0, 0, 0])

  assert.throws(
    () => validatePngScanlineFilters(inflated, 1, 2, 3),
    /PNG scanline 1 filter type must be 0\.\.4/u,
  )
})

test('front-matter scalar parsing strips only unquoted YAML comments', () => {
  const parsed = parseFrontMatterScalars([
    '---',
    'description: 실제 설명 # 수익실험실',
    'double_quoted: "실제 설명 # 수익실험실"',
    "single_quoted: '실제 설명 # 수익실험실'",
    '---',
  ].join('\n'), 'inline fixture', ['description', 'double_quoted', 'single_quoted'])

  assert.equal(parsed.description, '실제 설명')
  assert.doesNotMatch(parsed.description, /수익실험실/u)
  assert.equal(parsed.double_quoted, '실제 설명 # 수익실험실')
  assert.equal(parsed.single_quoted, '실제 설명 # 수익실험실')
})

test('visible h1 parsing ignores commented and inert decoys', () => {
  const fixture = [
    '<!-- <h1>수익실험실</h1> -->',
    '<script><h1>수익실험실</h1></script>',
    '<style><h1>수익실험실</h1></style>',
    '<template><h1>수익실험실</h1></template>',
    '<h1><span>0 → 1</span></h1>',
  ].join('\n')

  assert.equal(extractVisibleH1Text(fixture, 'h1 fixture'), oldBrandName)
  assert.notEqual(extractVisibleH1Text(fixture, 'h1 fixture'), brandName)
})

test('brand page front matter contains no exact stale brand', () => {
  for (const [relativePath, frontMatter] of brandFrontMatter) {
    for (const [key, value] of Object.entries(frontMatter)) {
      assert.ok(!value.includes(oldBrandName), `${relativePath} front matter ${key} must not contain ${oldBrandName}`)
    }
  }
})

test('index.html uses 수익실험실 as its exact front-matter title', () => {
  assert.equal(indexFrontMatter.title, brandName)
})

test('index.html description names 수익실험실', () => {
  assert.match(indexFrontMatter.description, /수익실험실/u)
})

test('index.html visible hero heading is exactly 수익실험실', () => {
  assert.equal(extractVisibleH1Text(readRepositoryFile('index.html'), 'index.html'), brandName)
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

test('the homepage and lab page share separate hero and social images', () => {
  assert.equal(indexFrontMatter.featured_image, heroPath)
  assert.equal(labFrontMatter.featured_image, heroPath)
  assert.equal(indexFrontMatter.social_image, socialImagePath)
  assert.equal(labFrontMatter.social_image, socialImagePath)
})

test('the revenue lab hero and social card are valid 1600×900 PNGs', () => {
  for (const imagePath of [heroPath, socialImagePath]) {
    validateRevenueLabPng(imagePath)
  }
})

test('Twitter and Open Graph metadata prefer social_image then featured_image', () => {
  const assignment = "{% assign social_image = page.social_image | default: page.featured_image | default: '/images/demo/about.jpg' %}"
  assert.equal(defaultLayout.match(/\{% assign social_image = [^%]+%\}/gu)?.length, 1)
  assert.ok(defaultLayout.includes(assignment))

  assert.match(
    defaultLayout,
    /<meta name="twitter:image:src" content="\{\{ social_image \| absolute_url \}\}">/u,
  )
  assert.match(
    defaultLayout,
    /<meta property="og:image" content="\{\{ social_image \| absolute_url \}\}" \/>/u,
  )
})
