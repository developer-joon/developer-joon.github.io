#!/usr/bin/env node
// Deterministic PUBLIC-only join. Source verifiers independently enforce each input contract.
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../community-app/public/data/company-benefits')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const pinned = {
  base: 'cd971b70d4fb0d9860a6c9f0903610cb20d9cc8f9d98757478a1592cf82ed99b',
  directory: '3ffb2259bb618e70c820005aebea1be24422d831faea908121d4884406c7ea0b',
  overlay: 'a75a6edb58e1c4258fd79451cb64efdc936fcd1cfaaccb0cd2391267b86adbd4',
  research: 'dee9a566771d7c03cd010c6c07d40fbd7cf2a3555a8c4f3043c5e159bb22b321',
}
async function checked(relative, digest, bytes) {
  const raw = await readFile(path.join(root, relative))
  if (sha(raw) !== digest || (bytes !== undefined && raw.length !== bytes)) throw Error(`source changed: ${relative}`)
  return JSON.parse(raw.toString('utf8'))
}
export async function buildDomesticSearchIndex() {
  const base = await checked('manifest.json', pinned.base)
  const directory = await checked('domestic-directory-v1/manifest.json', pinned.directory)
  const overlay = await checked('domestic-size-evidence-v1/manifest.json', pinned.overlay)
  const researchManifest = await checked('research-leads-v1/manifest.json', pinned.research)
  if (researchManifest.base_manifest_sha256 !== pinned.base || directory.base_manifest_sha256 !== pinned.base || overlay.directory_manifest_sha256 !== pinned.directory || overlay.base_manifest_sha256 !== pinned.base) throw Error('source binding mismatch')
  const research = await checked('research-leads-v1/leads.json', researchManifest.leads_sha256, researchManifest.leads_byte_count)
  const counts = new Map()
  for (const lead of research.leads) counts.set(lead.company_id, (counts.get(lead.company_id) ?? 0) + 1)
  if (research.leads.length !== researchManifest.record_count || counts.size !== researchManifest.company_count) throw Error('research totals mismatch')
  const names = new Map()
  for (const descriptor of base.listing_chunks) {
    const relative = descriptor.url.replace(/^community\/data\/company-benefits\//, '')
    const listing = await checked(relative, descriptor.sha256, descriptor.byte_count)
    for (const company of listing.companies) if (company.company_id.startsWith('KR-CRN-')) {
      if (names.has(company.company_id)) throw Error('duplicate base ID')
      names.set(company.company_id, company.legal_name)
    }
  }
  if (names.size !== 1000 || [...counts.keys()].some(id => !names.has(id))) throw Error('base or research identity mismatch')
  const labelsDoc = await checked('domestic-size-evidence-v1/records.json', overlay.records.sha256, overlay.records.bytes)
  const labels = new Map(labelsDoc.labels.map(item => [item.id, item]))
  const entries = new Map()
  for (const descriptor of directory.chunks) {
    const shard = await checked(`domestic-directory-v1/${descriptor.path}`, descriptor.sha256, descriptor.bytes)
    if (shard.records.length !== descriptor.count) throw Error('directory shard count mismatch')
    for (const row of shard.records) {
      if (entries.has(row.id)) throw Error('duplicate directory ID')
      entries.set(row.id, { ...row, name: names.get(row.id) ?? row.name, size_class: labels.get(row.id)?.size_class ?? 'unclassified', ...(labels.has(row.id) ? { size_evidence: labels.get(row.id) } : {}), ...(counts.has(row.id) ? { research_count: counts.get(row.id) } : {}) })
    }
  }
  for (const [id, name] of names) if (!entries.has(id)) entries.set(id, { id, name, source_type: 'base_legal_identity', size_class: labels.get(id)?.size_class ?? 'unclassified', ...(labels.has(id) ? { size_evidence: labels.get(id) } : {}), ...(counts.has(id) ? { research_count: counts.get(id) } : {}) })
  for (const item of labelsDoc.ftc_only) {
    if (entries.has(item.id)) throw Error('FTC duplicate ID')
    entries.set(item.id, { id: item.id, name: item.name, group: item.group, source_type: 'ftc_affiliate', size_class: item.size_class, size_evidence: item })
  }
  const totals = { records: entries.size, new_records: directory.totals.new_records, base_aliases: directory.totals.base_aliases, ftc_only: labelsDoc.ftc_only.length, research_companies: counts.size, research_leads: research.leads.length }
  if (totals.records !== 40053 || totals.new_records !== 35910 || totals.base_aliases !== 174 || totals.ftc_only !== 3143 || totals.research_companies !== 12 || totals.research_leads !== 128) throw Error('pinned join totals mismatch')
  const ordered = [...entries.values()].sort((a, b) => (b.research_count ?? 0) - (a.research_count ?? 0) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
  return Buffer.from(JSON.stringify({ schema_version: 'domestic-search-index-v1', edition: directory.sources.recruitment.edition, approved: base.approved_v2_projection?.verified_proposition_count ?? 0, totals, entries: ordered }) + '\n')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.join(root, 'domestic-search-index-v1/index.json')
  const expected = await buildDomesticSearchIndex()
  if (process.argv.includes('--check')) {
    const actual = await readFile(output)
    if (!actual.equals(expected)) throw Error('search index differs from pinned source join')
  } else {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, expected)
  }
  console.log(`search index: ${expected.length} bytes sha256 ${sha(expected)}${process.argv.includes('--check') ? ' checked' : ''}`)
}
