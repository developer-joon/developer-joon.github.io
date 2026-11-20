import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'

const pinnedSha256 = 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594'
const pinnedBytes = 8392604
const parts = ['community', 'data', 'company-benefits', 'domestic-search-index-v1']
export async function verifyDomesticSearchIndex(root) {
  const opened = []
  try {
    let parent = await open(path.resolve(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    opened.push(parent)
    for (const part of parts) {
      parent = await open(`/proc/self/fd/${parent.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      opened.push(parent)
      if (!(await parent.stat()).isDirectory()) throw Error(`index unsafe directory ${part}`)
    }
    const names = await readdir(`/proc/self/fd/${parent.fd}`)
    if (names.length !== 1 || names[0] !== 'index.json') throw Error('index inventory mismatch')
    const file = await open(`/proc/self/fd/${parent.fd}/index.json`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    opened.push(file)
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.size !== BigInt(pinnedBytes)) throw Error('index unsafe file or count/bytes mismatch')
    const bytes = Buffer.alloc(pinnedBytes)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error('index truncated')
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw Error('index changed during read')
    if (createHash('sha256').update(bytes).digest('hex') !== pinnedSha256) throw Error('index SHA mismatch')
    const doc = JSON.parse(bytes.toString('utf8'))
    if (doc.schema_version !== 'domestic-search-index-v1' || doc.entries?.length !== 40053 || doc.approved !== 0 || doc.totals?.records !== 40053 || doc.totals?.new_records !== 35910 || doc.totals?.base_aliases !== 174 || doc.totals?.ftc_only !== 3143 || doc.totals?.research_companies !== 12 || doc.totals?.research_leads !== 128) throw Error('index count or approval mismatch')
    const ids = new Set(); let biz = 0; let ftc = 0; let aliases = 0; let leads = 0; let companies = 0
    for (const row of doc.entries) {
      if (!row || !/^KR-(?:BIZ-\d{10}|CRN-\d{13})$/.test(row.id) || ids.has(row.id) || typeof row.name !== 'string' || !row.name || !['unclassified', 'large_affiliate', 'mid_history', 'sme_unspecified'].includes(row.size_class) || Object.hasOwn(row, 'approved') || Object.hasOwn(row, 'benefit_action')) throw Error('index duplicate/unknown ID or false approval')
      ids.add(row.id)
      if (row.source_type === 'ftc_affiliate') ftc++
      else if (row.id.startsWith('KR-BIZ-')) biz++
      else if (row.source_type === 'dated_recruitment_observation') aliases++
      if (row.research_count !== undefined) { if (!row.id.startsWith('KR-CRN-') || !Number.isSafeInteger(row.research_count) || row.research_count < 1) throw Error('index research count invalid'); companies++; leads += row.research_count }
    }
    if (ids.size !== 40053 || biz !== 35910 || ftc !== 3143 || aliases !== 174 || companies !== 12 || leads !== 128) throw Error('index derived count mismatch')
    return `search index: ${ids.size} identities, ${leads} research-only leads, 0 approved; SHA ${pinnedSha256}`
  } finally { for (const handle of opened.reverse()) await handle.close() }
}
