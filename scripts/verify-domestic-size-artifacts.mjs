import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'

// Immutable v1 acquisition. Changing this epoch requires a new version and reviewed pins.
const pins = Object.freeze({
  base: '2778a70adab5781812a26abc92cdb8dec108daa52b028f9393a6e5b57d03230a',
  directory: '4b78f137f798aabfd698b5690da354f6343a27d4bbb3c619baa99f57fd55de9e',
  records: 'e9f3eb2e877459815b1ce075fb4c4dc834d762accac6538d6c7c4aec31b6bd43',
  sources: Object.freeze({
    dart_bridge: ['6dcf6031e8e9eecbcefc120a7461f9a7bd3ef97c88ba55d20d80f416285de1c3', 'https://dart.fss.or.kr/dsae001/downloadExcel.do'],
    ftc: ['080238dc8e95bc7cff0100534854d317ed6948a25a291688f451fa5be23053fb', 'https://www.ftc.go.kr/www/selectBbsNttView.do?bordCd=3&key=12&nttSn=48244'],
    mid: ['962e10cb95b8b8ee274d420f4e89293dbc8da8e4ba9966178ef6af068fe6e040', 'https://www.data.go.kr/data/15102331/fileData.do'],
    recruitment: ['16756d002508995b70f158bd279a48fb825af6a79820eb82b0009efcbeb82365', 'https://www.data.go.kr/data/15100246/fileData.do'],
    sme: ['c8242d45872ffb1d35241b434b4dfce828a39697fc27bb6f9d8b565730bed4ba', 'https://www.data.go.kr/data/15018880/fileData.do'],
  }),
})
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function shape(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw Error(`size ${label} schema mismatch`)
}
function count(value, expected, label) {
  if (value !== expected) throw Error(`size ${label} epoch/count mismatch`)
}
function safeText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) throw Error(`size ${label} invalid text`)
}
async function child(parent, name, directory) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '..') throw Error('size unsafe path')
  const handle = await open(path.join(`/proc/self/fd/${parent.fd}`, name),
    constants.O_RDONLY | constants.O_NOFOLLOW | (directory ? constants.O_DIRECTORY : constants.O_NONBLOCK))
  const stat = await handle.stat({ bigint: true })
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    await handle.close()
    throw Error(`size unsafe ${name}`)
  }
  return { handle, stat, name, parent, directory }
}
async function stable(entry) {
  const again = await child(entry.parent, entry.name, entry.directory)
  try {
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      if (entry.stat[key] !== again.stat[key]) throw Error(`size ${entry.name} changed during verification`)
    }
  } finally { await again.handle.close() }
}
async function bounded(parent, name, max) {
  const entry = await child(parent, name, false)
  try {
    if (entry.stat.size > BigInt(max)) throw Error(`size ${name} exceeds byte limit`)
    const bytes = Buffer.alloc(Number(entry.stat.size))
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await entry.handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error(`size ${name} truncated`)
      offset += bytesRead
    }
    const after = await entry.handle.stat({ bigint: true })
    for (const key of ['size', 'mtimeNs', 'ctimeNs']) {
      if (entry.stat[key] !== after[key]) throw Error(`size ${name} changed during read`)
    }
    await stable(entry)
    return bytes
  } finally { await entry.handle.close() }
}
const inventory = async (handle, names, label) => {
  const actual = (await readdir(`/proc/self/fd/${handle.fd}`)).sort()
  if (actual.join('\0') !== [...names].sort().join('\0')) throw Error(`size ${label} inventory mismatch`)
}

export async function verifyDomesticSizeArtifacts(root) {
  const site = await open(path.resolve(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const entries = []
  try {
    let parent = site
    for (const name of ['community', 'data', 'company-benefits']) {
      const entry = await child(parent, name, true)
      entries.push(entry)
      parent = entry.handle
    }
    const baseBytes = await bounded(parent, 'manifest.json', 2 * 1024 * 1024)
    if (hash(baseBytes) !== pins.base) throw Error('size base raw-byte SHA mismatch')
    const base = JSON.parse(baseBytes)
    if (base.company_count !== 2000 || !base.company_shards || Object.keys(base.company_shards).length !== 2000) throw Error('size base IDs invalid')
    const baseIds = new Set(Object.keys(base.company_shards))

    const directory = await child(parent, 'domestic-directory-v1', true)
    entries.push(directory)
    const directoryBytes = await bounded(directory.handle, 'manifest.json', 256 * 1024)
    if (hash(directoryBytes) !== pins.directory) throw Error('size directory raw-byte SHA mismatch')
    const directoryManifest = JSON.parse(directoryBytes)
    const shards = await child(directory.handle, 'shards', true)
    entries.push(shards)
    if (!Array.isArray(directoryManifest.chunks) || directoryManifest.chunks.length !== 73) throw Error('size directory chunk count mismatch')
    const directoryIds = new Set()
    const shardNames = []
    for (const [index, chunk] of directoryManifest.chunks.entries()) {
      const name = `${String(index).padStart(4, '0')}.json`
      if (chunk.path !== `shards/${name}` || chunk.bytes > 262144 || chunk.count > 500) throw Error('size directory shard bounds/path mismatch')
      shardNames.push(name)
      const bytes = await bounded(shards.handle, name, 262144)
      if (bytes.length !== chunk.bytes || hash(bytes) !== chunk.sha256) throw Error('size directory shard SHA mismatch')
      const payload = JSON.parse(bytes)
      if (!Array.isArray(payload.records) || payload.records.length !== chunk.count) throw Error('size directory shard count mismatch')
      for (const row of payload.records) {
        if (directoryIds.has(row.id)) throw Error('size directory duplicate ID')
        directoryIds.add(row.id)
      }
    }
    await inventory(shards.handle, shardNames, 'directory shards')
    if (directoryIds.size !== 36084) throw Error('size directory ID count mismatch')

    const overlay = await child(parent, 'domestic-size-evidence-v1', true)
    entries.push(overlay)
    await inventory(overlay.handle, ['manifest.json', 'records.json'], 'overlay')
    const manifest = JSON.parse(await bounded(overlay.handle, 'manifest.json', 32 * 1024))
    shape(manifest, ['base_manifest_sha256', 'directory_manifest_sha256', 'methodology', 'records', 'schema_version', 'sources', 'totals'], 'manifest')
    if (manifest.schema_version !== 'domestic-size-evidence-v1' || manifest.base_manifest_sha256 !== pins.base || manifest.directory_manifest_sha256 !== pins.directory) throw Error('size epoch binding mismatch')
    if (manifest.methodology !== 'Dated identity-specific affiliation/designation evidence, not current employment, standalone assets, benefit policy or benefit approval. Mid-sized evidence historical only; SME designation is not a medium/small subtype. Unlabeled identities remain unclassified.') throw Error('size methodology epoch mismatch')
    shape(manifest.sources, Object.keys(pins.sources), 'sources')
    const sourceFields = { dart_bridge: ['role', 'sha256', 'url'], ftc: ['as_of', 'license', 'sha256', 'url'], mid: ['as_of', 'license', 'sha256', 'url'], recruitment: ['edition', 'sha256', 'url'], sme: ['as_of', 'license', 'sha256', 'url'] }
    const dates = { ftc: '2026-11-02', mid: '2026-06-30', recruitment: '2026-03-06', sme: '2025-12-31' }
    const licenses = { ftc: '공공누리 제1유형 (출처표시: 공정거래위원회)', mid: '이용허락범위 제한 없음', sme: '이용허락범위 제한 없음' }
    for (const [key, [digest, url]] of Object.entries(pins.sources)) {
      const source = manifest.sources[key]
      shape(source, sourceFields[key], `source ${key}`)
      if (source.sha256 !== digest || source.url !== url) throw Error(`size source ${key} epoch mismatch`)
      if (key === 'dart_bridge') {
        if (source.role !== 'private exact BID-to-CRN bridge only') throw Error('size DART source role mismatch')
      } else {
        if (source[key === 'recruitment' ? 'edition' : 'as_of'] !== dates[key]) throw Error(`size source ${key} date mismatch`)
        if (key !== 'recruitment' && source.license !== licenses[key]) throw Error(`size source ${key} license mismatch`)
      }
    }
    shape(manifest.records, ['bytes', 'count', 'ftc_only', 'labels', 'path', 'sha256'], 'records descriptor')
    for (const [key, expected] of Object.entries({ bytes: 523534, count: 3545, ftc_only: 3143, labels: 402, path: 'records.json', sha256: pins.records })) count(manifest.records[key], expected, `records ${key}`)
    const expectedTotals = { ambiguous_dart_bids: 0, base_labels: 270, conflicting_classes: 0, directory_labels: 132, ftc_conflicting_crns: 16, ftc_only: 3143, ftc_rows: 3529, ftc_unambiguous_crns: 3497, ftc_unique_crns: 3513, labels: 402, name_mismatch_ids: 87, records: 3545 }
    shape(manifest.totals, Object.keys(expectedTotals), 'totals')
    for (const [key, value] of Object.entries(expectedTotals)) count(manifest.totals[key], value, `totals ${key}`)
    const bytes = await bounded(overlay.handle, 'records.json', 600000)
    if (bytes.length !== manifest.records.bytes || hash(bytes) !== pins.records) throw Error('size records raw-byte SHA/length mismatch')
    const records = JSON.parse(bytes)
    shape(records, ['ftc_only', 'labels'], 'record payload')
    if (!Array.isArray(records.labels) || records.labels.length !== 402 || !Array.isArray(records.ftc_only) || records.ftc_only.length !== 3143) throw Error('size record count mismatch')
    const ids = new Set()
    const classes = { large_affiliate: 0, sme_unspecified: 0, mid_history: 0 }
    let baseLabels = 0
    for (const row of records.labels) {
      const source = { large_affiliate: 'ftc', sme_unspecified: 'sme', mid_history: 'mid' }[row?.size_class]
      shape(row, source === 'sme' ? ['as_of', 'expires_on', 'id', 'size_class', 'source'] : ['as_of', 'id', 'size_class', 'source'], 'label')
      if (!source || row.source !== source || row.as_of !== dates[source] ||
          (source === 'sme' && (!/^\d{4}-\d\d-\d\d$/.test(row.expires_on) || row.expires_on <= row.as_of || Number.isNaN(Date.parse(`${row.expires_on}T00:00:00Z`))))) throw Error('size label provenance/date mismatch')
      if (!/^KR-(?:CRN-\d{13}|BIZ-\d{10})$/.test(row.id) || (!baseIds.has(row.id) && !directoryIds.has(row.id)) || ids.has(row.id)) throw Error('size label unknown/duplicate exact ID')
      ids.add(row.id)
      classes[row.size_class]++
      if (baseIds.has(row.id)) baseLabels++
    }
    if (baseLabels !== 270 || ids.size - baseLabels !== 132 || classes.large_affiliate !== 323 || classes.sme_unspecified !== 75 || classes.mid_history !== 4) throw Error('size label class/cohort totals mismatch')
    for (const row of records.ftc_only) {
      shape(row, ['as_of', 'group', 'id', 'name', 'size_class', 'source'], 'FTC-only record')
      if (!/^KR-CRN-\d{13}$/.test(row.id) || ids.has(row.id) || baseIds.has(row.id) || directoryIds.has(row.id) || row.source !== 'ftc' || row.size_class !== 'large_affiliate' || row.as_of !== dates.ftc) throw Error('size FTC-only identity/provenance mismatch')
      safeText(row.group, 'FTC group')
      safeText(row.name, 'FTC name')
      ids.add(row.id)
    }
    if (ids.size !== 3545) throw Error('size unique record count mismatch')
    for (const entry of entries.toReversed()) await stable(entry)
    return `size artifacts: ${records.labels.length} labels (${baseLabels} base, ${records.labels.length - baseLabels} directory), ${records.ftc_only.length} FTC-only records`
  } catch (error) {
    if (error.message.startsWith('size ')) throw error
    throw Error(`size artifacts: ${error.message}`)
  } finally {
    for (const entry of entries.toReversed()) await entry.handle.close()
    await site.close()
  }
}
