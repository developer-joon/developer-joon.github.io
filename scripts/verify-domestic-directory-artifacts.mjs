import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'

const baseHash = 'cd971b70d4fb0d9860a6c9f0903610cb20d9cc8f9d98757478a1592cf82ed99b'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hex = /^[a-f0-9]{64}$/
const own = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw Error(`directory ${label} schema mismatch`)
}
const integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`directory ${label} invalid count`)
}
const text = (value, label, max = 160) => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max ||
      /[\u0000-\u001f\u007f]/u.test(value)) throw Error(`directory ${label} invalid text`)
}
const date = (value, label) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw Error(`directory ${label} invalid date`)
}

// Open each component relative to the verified parent: never follow symlink leaves or parents.
async function child(parent, name, directory) {
  let handle
  try {
    handle = await open(path.join(`/proc/self/fd/${parent.fd}`, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | (directory ? constants.O_DIRECTORY : constants.O_NONBLOCK))
  } catch (error) { throw Error(`directory unsafe or missing ${name}: ${error.message}`) }
  const stat = await handle.stat({ bigint: true })
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    await handle.close()
    throw Error(`directory unsafe ${name}`)
  }
  return { handle, stat, name, parent }
}
async function stable(entry) {
  const check = await child(entry.parent, entry.name, entry.stat.isDirectory())
  try {
    const a = entry.stat, b = check.stat
    if (a.dev !== b.dev || a.ino !== b.ino || a.size !== b.size || a.mtimeNs !== b.mtimeNs || a.ctimeNs !== b.ctimeNs) {
      throw Error(`directory ${entry.name} changed during verification`)
    }
  } finally { await check.handle.close() }
}
async function bounded(parent, name, max) {
  const entry = await child(parent, name, false)
  try {
    if (entry.stat.size > BigInt(max)) throw Error(`directory ${name} exceeds byte limit`)
    const bytes = Buffer.alloc(Number(entry.stat.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await entry.handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error(`directory ${name} truncated`)
      offset += bytesRead
    }
    const after = await entry.handle.stat({ bigint: true })
    if (after.size !== entry.stat.size || after.mtimeNs !== entry.stat.mtimeNs || after.ctimeNs !== entry.stat.ctimeNs) throw Error(`directory ${name} changed during read`)
    await stable(entry)
    return bytes
  } finally { await entry.handle.close() }
}

export async function verifyDomesticDirectoryArtifacts(root) {
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
    if (sha(baseBytes) !== baseHash) throw Error('directory base manifest raw-byte SHA mismatch')
    const base = JSON.parse(baseBytes.toString('utf8'))
    if (base.company_count !== 2000 || !base.company_shards || typeof base.company_shards !== 'object' ||
        Array.isArray(base.company_shards) || Object.keys(base.company_shards).length !== 2000) throw Error('directory base identities invalid')
    const directory = await child(parent, 'domestic-directory-v1', true)
    entries.push(directory)
    const manifestBytes = await bounded(directory.handle, 'manifest.json', 256 * 1024)
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    own(manifest, ['base_manifest_sha256', 'chunks', 'limits', 'methodology', 'schema_version', 'sources', 'totals'], 'manifest')
    if (manifest.schema_version !== 'domestic-directory-v1' || manifest.base_manifest_sha256 !== sha(baseBytes)) throw Error('directory base binding mismatch')
    own(manifest.limits, ['max_records_per_shard', 'max_shard_bytes', 'max_shards'], 'limits')
    if (manifest.limits.max_records_per_shard !== 500 || manifest.limits.max_shard_bytes !== 262144 || manifest.limits.max_shards !== 400) throw Error('directory limits mismatch')
    text(manifest.methodology, 'methodology', 2048)
    own(manifest.sources, ['dart_bridge', 'recruitment'], 'sources')
    own(manifest.sources.dart_bridge, ['acquired_on', 'license', 'sha256', 'url'], 'DART source')
    own(manifest.sources.recruitment, ['edition', 'license', 'sha256', 'url'], 'recruitment source')
    date(manifest.sources.dart_bridge.acquired_on, 'acquisition')
    date(manifest.sources.recruitment.edition, 'edition')
    for (const source of Object.values(manifest.sources)) {
      text(source.license, 'license', 256)
      if (!hex.test(source.sha256) || typeof source.url !== 'string' || !/^https:\/\/[a-z0-9.-]+\/[a-zA-Z0-9_./-]+$/.test(source.url)) throw Error('directory source invalid')
    }
    const totalKeys = ['base_aliases', 'candidate_unique_bid', 'excluded_last_day_name_conflict', 'invalid_date_rows', 'job_rows', 'listing_records', 'new_records', 'valid_named_bid_before_date_filter']
    own(manifest.totals, totalKeys, 'totals')
    for (const key of totalKeys) integer(manifest.totals[key], key)
    if (!Array.isArray(manifest.chunks) || !manifest.chunks.length || manifest.chunks.length > 400) throw Error('directory chunk count invalid')
    const rootInventory = (await readdir(`/proc/self/fd/${directory.handle.fd}`)).sort()
    if (rootInventory.join('\0') !== 'manifest.json\0shards') throw Error('directory root inventory mismatch')
    const shards = await child(directory.handle, 'shards', true)
    entries.push(shards)
    const expected = new Set()
    const ids = new Set()
    let aliases = 0
    let newRecords = 0
    for (const [index, chunk] of manifest.chunks.entries()) {
      own(chunk, ['bytes', 'count', 'path', 'sha256'], `chunk ${index}`)
      if (chunk.path !== `shards/${String(index).padStart(4, '0')}.json`) throw Error(`directory chunk ${index} unsafe path/order`)
      const filename = chunk.path.slice('shards/'.length)
      expected.add(filename)
      integer(chunk.bytes, `chunk ${index} bytes`)
      integer(chunk.count, `chunk ${index} count`)
      if (!chunk.bytes || chunk.bytes > 262144 || !chunk.count || chunk.count > 500 || !hex.test(chunk.sha256)) throw Error(`directory chunk ${index} bounds or digest invalid`)
      const bytes = await bounded(shards.handle, filename, 262144)
      if (bytes.length !== chunk.bytes || sha(bytes) !== chunk.sha256) throw Error(`directory chunk ${index} byte count or SHA mismatch`)
      const payload = JSON.parse(bytes.toString('utf8'))
      own(payload, ['records'], `shard ${index}`)
      if (!Array.isArray(payload.records) || payload.records.length !== chunk.count) throw Error(`directory shard ${index} record count mismatch`)
      for (const row of payload.records) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('directory record invalid')
        const keys = ['id', 'name', 'observation_date', 'size_class', 'source_type']
        if (Object.hasOwn(row, 'region')) keys.push('region')
        if (Object.hasOwn(row, 'employee_count')) keys.push('employee_count')
        own(row, keys, 'record')
        if (!/^KR-(?:BIZ-\d{10}|CRN-\d{13})$/.test(row.id) || ids.has(row.id)) throw Error('directory duplicate or invalid identity')
        ids.add(row.id)
        if (row.id.startsWith('KR-CRN-')) {
          if (!Object.hasOwn(base.company_shards, row.id)) throw Error('directory alias absent from base')
          aliases += 1
        } else {
          if (Object.hasOwn(base.company_shards, row.id)) throw Error('directory new identity collides with base')
          newRecords += 1
        }
        text(row.name, 'name', 160)
        date(row.observation_date, 'observation')
        if (row.observation_date > manifest.sources.recruitment.edition) throw Error('directory observation after source edition')
        if (row.size_class !== 'unclassified' || row.source_type !== 'dated_recruitment_observation') throw Error('directory unsupported size or source')
        if (Object.hasOwn(row, 'region')) text(row.region, 'region', 80)
        if (Object.hasOwn(row, 'employee_count')) {
          integer(row.employee_count, 'employee_count')
          if (row.employee_count > 10000000) throw Error('directory employee_count exceeds limit')
        }
      }
    }
    const actual = (await readdir(`/proc/self/fd/${shards.handle.fd}`)).sort()
    if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) throw Error('directory shard inventory mismatch')
    const t = manifest.totals
    if (t.listing_records !== ids.size || t.base_aliases !== aliases || t.new_records !== newRecords ||
        t.listing_records !== t.base_aliases + t.new_records ||
        t.candidate_unique_bid !== t.listing_records + t.excluded_last_day_name_conflict ||
        t.valid_named_bid_before_date_filter !== t.candidate_unique_bid + t.invalid_date_rows ||
        t.job_rows < t.valid_named_bid_before_date_filter) throw Error('directory derived totals mismatch')
    for (const entry of entries.toReversed()) await stable(entry)
    return `directory artifacts: ${ids.size} records (${newRecords} new, ${aliases} base aliases) across ${manifest.chunks.length} shards`
  } finally {
    for (const entry of entries.toReversed()) await entry.handle.close()
    await site.close()
  }
}
