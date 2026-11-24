import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'
import { categories } from '../community-app/src/types/benefits.ts'
import { researchActionKey } from '../community-app/src/data/researchActionKey.ts'

const baseHash = '2778a70adab5781812a26abc92cdb8dec108daa52b028f9393a6e5b57d03230a'
const limit = 1024 * 1024
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hex = /^[a-f0-9]{64}$/
const categoryIds = new Set(categories)
const conditionKeys = new Set(['occasion', 'education_level', 'covered_persons', 'purpose', 'residence', 'tenure', 'price'])
const own = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw Error(`research ${label} schema mismatch`)
}
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value) || /(?:file:\/\/|\/home\/|\/tmp\/|\/workspace\/|\\Users\\)/i.test(value)) throw Error(`research ${label} unsafe text`)
}
const digest = (value, label) => { if (typeof value !== 'string' || !hex.test(value)) throw Error(`research ${label} invalid digest`) }
const count = (value, label) => { if (!Number.isSafeInteger(value) || value < 1) throw Error(`research ${label} invalid count`) }
const researchText = (value, limit, label) => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > limit ||
      /[\u0000-\u001f\u007f]/u.test(value)) throw Error(`research ${label} invalid`)
  text(value, label)
}
const scopeValue = (value, label, allowEmpty = false) => {
  if (!Array.isArray(value)) return researchText(value, 160, label)
  if ((!allowEmpty && !value.length) || value.length > 8) throw Error(`research ${label} invalid`)
  value.forEach((part) => researchText(part, 160, label))
}

function safeUrl(value) {
  text(value, 'source URL')
  // Reject raw-authority percent escapes, credentials, empty hosts and noncanonical ports.
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(value)?.[1]
  if (!authority || /[%@\\\s]/u.test(authority) || /[\u0000-\u001f\u007f]/u.test(value)) throw Error('research source URL unsafe authority')
  let url
  try { url = new URL(value) } catch { throw Error('research source URL invalid') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port ||
      url.origin !== `https://${authority}` || !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      url.hostname.startsWith('.') || url.hostname.endsWith('.') || url.hostname.includes('..')) throw Error('research source URL unsafe')
  if ([...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|token|secret|password|passwd|session|auth|signature|sig|code)$/i.test(key))) throw Error('research source URL unsafe query')
}

// Every component is opened relative to its already-open parent with NOFOLLOW.
// Bound reads also recheck entry identity after reading, not just the descriptor.
async function child(parent, name, directory) {
  const handle = await open(path.join(`/proc/self/fd/${parent.fd}`, name), constants.O_RDONLY | constants.O_NOFOLLOW | (directory ? constants.O_DIRECTORY : constants.O_NONBLOCK))
  const stat = await handle.stat({ bigint: true })
  if (directory ? !stat.isDirectory() : !stat.isFile()) { await handle.close(); throw Error(`research unsafe ${name}`) }
  return { handle, stat, name, parent }
}
async function stable(entry) {
  const check = await child(entry.parent, entry.name, entry.stat.isDirectory())
  try {
    const a = entry.stat, b = check.stat
    if (a.dev !== b.dev || a.ino !== b.ino || a.size !== b.size || a.mtimeNs !== b.mtimeNs || a.ctimeNs !== b.ctimeNs) throw Error(`research ${entry.name} changed during verification`)
  } finally { await check.handle.close() }
}
async function bounded(parent, name) {
  const entry = await child(parent, name, false)
  try {
    if (entry.stat.size > BigInt(limit)) throw Error(`research ${name} exceeds byte limit`)
    const bytes = Buffer.alloc(Number(entry.stat.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await entry.handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error(`research ${name} truncated`)
      offset += bytesRead
    }
    const after = await entry.handle.stat({ bigint: true })
    if (after.size !== entry.stat.size || after.mtimeNs !== entry.stat.mtimeNs || after.ctimeNs !== entry.stat.ctimeNs) throw Error(`research ${name} changed during read`)
    await stable(entry)
    return bytes
  } finally { await entry.handle.close() }
}
async function verify(root) {
  const site = await open(path.resolve(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const entries = []
  try {
    let parent = site
    for (const name of ['community', 'data', 'company-benefits']) {
      const entry = await child(parent, name, true)
      entries.push(entry)
      parent = entry.handle
    }
    const baseRoot = parent
    const baseBytes = await bounded(baseRoot, 'manifest.json')
    if (sha(baseBytes) !== baseHash) throw Error('research base manifest original bytes mismatch')
    const base = JSON.parse(baseBytes.toString('utf8'))
    const research = await child(baseRoot, 'research-leads-v1', true)
    entries.push(research)
    const inventory = (await readdir(`/proc/self/fd/${research.handle.fd}`)).sort()
    if (inventory.join('\0') !== 'leads.json\0manifest.json') throw Error('research sibling inventory mismatch')
    const manifestBytes = await bounded(research.handle, 'manifest.json')
    const leadsBytes = await bounded(research.handle, 'leads.json')
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    own(manifest, ['artifact_kind', 'base_manifest_sha256', 'company_count', 'leads_byte_count', 'leads_sha256', 'record_count', 'schema_version', 'status'], 'manifest')
    if (manifest.schema_version !== 1 || manifest.artifact_kind !== 'company_benefits_research_manifest' || manifest.status !== 'research_only' || manifest.base_manifest_sha256 !== baseHash) throw Error('research manifest authority mismatch')
    digest(manifest.leads_sha256, 'leads SHA')
    count(manifest.company_count, 'company')
    count(manifest.record_count, 'record')
    count(manifest.leads_byte_count, 'leads bytes')
    if (manifest.leads_byte_count !== leadsBytes.length || manifest.leads_sha256 !== sha(leadsBytes)) throw Error('research leads bytes or SHA mismatch')
    const payload = JSON.parse(leadsBytes.toString('utf8'))
    own(payload, ['artifact_kind', 'leads', 'schema_version', 'status'], 'payload')
    if (payload.artifact_kind !== 'company_benefits_research_leads' || payload.schema_version !== 1 || payload.status !== 'research_only' || !Array.isArray(payload.leads) || payload.leads.length !== manifest.record_count) throw Error('research leads schema or count mismatch')
    const identities = new Map()
    const seen = new Set()
    for (const [index, row] of payload.leads.entries()) {
      own(row, ['benefit_action', 'company_id', 'currentness', 'limitations', 'observed_at', 'primary_category', 'scope', 'source_registry_id', 'source_text_sha256', 'source_url', 'status'], `lead ${index}`)
      if (row.status !== 'research_only' || row.currentness !== 'unknown') throw Error(`research lead ${index} cannot claim verification`)
      researchText(row.benefit_action, 300, `lead ${index} benefit_action`)
      researchText(row.source_registry_id, 240, `lead ${index} source_registry_id`)
      for (const key of ['company_id', 'observed_at']) text(row[key], `lead ${index} ${key}`)
      if (!categoryIds.has(row.primary_category)) throw Error(`research lead ${index} primary_category invalid`)
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(row.observed_at) || !Number.isFinite(Date.parse(row.observed_at))) throw Error(`research lead ${index} invalid observation time`)
      digest(row.source_text_sha256, `lead ${index} source text`)
      safeUrl(row.source_url)
      if (!Array.isArray(row.limitations) || !row.limitations.length || row.limitations.length > 8) throw Error(`research lead ${index} limitations invalid`)
      row.limitations.forEach((item) => researchText(item, 240, `lead ${index} limitation`))
      own(row.scope, ['conditions', 'employment_types', 'legal_entity', 'roles'], `lead ${index} scope`)
      researchText(row.scope.legal_entity, 160, `lead ${index} scope legal_entity`)
      scopeValue(row.scope.roles, `lead ${index} scope roles`)
      scopeValue(row.scope.employment_types, `lead ${index} scope employment_types`)
      const conditions = row.scope.conditions
      if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
        if (Object.keys(conditions).length > 7 || Object.keys(conditions).some((key) => !conditionKeys.has(key))) throw Error(`research lead ${index} scope conditions invalid`)
        Object.values(conditions).forEach((part) => researchText(part, 160, `lead ${index} scope conditions`))
      } else scopeValue(conditions, `lead ${index} scope conditions`, true)
      const descriptor = base.company_shards?.[row.company_id]
      if (!descriptor || descriptor.company_id !== row.company_id) throw Error(`research lead ${index} company not in base shards`)
      if (!identities.has(row.company_id)) {
        const prefix = 'community/data/company-benefits/'
        if (typeof descriptor.url !== 'string' || !descriptor.url.startsWith(prefix)) throw Error('research base shard path invalid')
        const parts = descriptor.url.slice(prefix.length).split('/')
        if (parts.some((part) => !part || part === '.' || part === '..')) throw Error('research base shard path unsafe')
        let directory = baseRoot
        const opened = []
        try {
          for (const part of parts.slice(0, -1)) { const entry = await child(directory, part, true); opened.push(entry); directory = entry.handle }
          const bytes = await bounded(directory, parts.at(-1))
          if (bytes.length !== descriptor.byte_count || sha(bytes) !== descriptor.sha256) throw Error(`research base company shard mismatch: ${row.company_id}`)
          const detail = JSON.parse(bytes.toString('utf8'))
          if (detail.company?.company_id !== row.company_id) throw Error(`research base shard identity mismatch: ${row.company_id}`)
          identities.set(row.company_id, detail.company.legal_name)
          for (const entry of opened.reverse()) await stable(entry)
        } finally { for (const entry of opened.reverse()) await entry.handle.close() }
      }
      if (row.scope.legal_entity !== identities.get(row.company_id)) throw Error(`research lead ${index} legal entity mismatch`)
      const key = `${row.company_id}\0${researchActionKey(row.benefit_action)}`
      if (seen.has(key)) throw Error(`research lead ${index} duplicate atomic benefit action`)
      seen.add(key)
    }
    if (identities.size !== manifest.company_count) throw Error('research company count mismatch')
    for (const entry of entries.toReversed()) await stable(entry)
    return `research artifacts: ${payload.leads.length} leads across ${identities.size} companies (research only)`
  } finally {
    for (const entry of entries.toReversed()) await entry.handle.close()
    await site.close()
  }
}

export const verifyBenefitsResearchArtifacts = verify
