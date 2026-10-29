// Fictional UI fixtures only. Never accepts research or Community records.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const categories = [
  'leave',
  'family',
  'health',
  'growth',
  'housing',
  'commute',
  'remote',
  'retirement',
  'meals',
  'inclusion',
]
const statuses = [
  '확인됨',
  '범위 제한 확인',
  '과거 확인',
  '명칭만 확인',
  '확인 불가',
  '상충',
  '해당 없음',
]
const dir = new URL(
  '../community-app/public/data/company-benefits/',
  import.meta.url,
)
const base = '/community/data/company-benefits/fixture-v1/'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const data_version = 'fixture-v1',
  date = '2026-10-29'
const companies = Array.from({ length: 56 }, (_, i) => ({
  company_id: `example-${String(i + 1).padStart(3, '0')}`,
  legal_name: `가상 별빛연구소 ${i + 1} 주식회사`,
  display_name: `예시 별빛기업 ${String(i + 1).padStart(2, '0')}`,
  scope: i % 2 ? 'international' : 'domestic',
  headquarters_country: i % 2 ? '예시국' : '대한민국',
  industry: i % 3 ? '가상 기술' : '가상 제조',
  scale_band: i % 2 ? '예시 대기업' : '예시 중견기업',
  fiscal_year: 2025,
  category_summaries: Object.fromEntries(
    categories.map((c, j) => [
      c,
      {
        status: statuses[(i + j) % 7],
        confirmed_count: (i + j) % 7 < 2 ? 1 : 0,
        limited: (i + j) % 7 === 1,
        last_verified_at: date,
        coverage: (i + j) % 7 < 2 ? 1 : 0,
      },
    ]),
  ),
  source_coverage: 0.5,
  last_verified_at: date,
}))
const rows = companies.flatMap((c, i) =>
  categories.map((category, j) => {
    const eligible = (i + j) % 7 < 2
    const components = eligible
      ? {
          breadth: 21,
          applicability: (i + j) % 2 ? 18 : 30,
          specificity: 16,
          freshness: 15,
        }
      : { breadth: 0, applicability: 0, specificity: 0, freshness: 0 }
    return {
      company_id: c.company_id,
      category,
      eligible,
      reason: eligible ? '' : '현재 A/B 근거·적용 범위·최신성 부족 또는 상충',
      components,
      score: Object.values(components).reduce((a, b) => a + b, 0),
    }
  }),
)
const details = companies.map((c) => ({
  company_id: c.company_id,
  community_post_id: null,
  claims: categories.map((category) => ({
    claim_id: `${c.company_id}-${category}`,
    category,
    benefit_type: `${category}-example`,
    name: `예시 ${category} 지원`,
    status: c.category_summaries[category].status,
    description:
      'UI 검증을 위한 가상의 복지 설명입니다. 실제 기업 정책이 아닙니다.',
    country: c.headquarters_country,
    legal_entity: c.legal_name,
    jobs: '예시 연구직',
    employment: '예시 정규직',
    conditions: '예시: 입사 1년 후, 연 5일. 실제 조건이 아닙니다.',
    source: {
      title: '가상 공식 복지 안내 (예시)',
      owner: c.legal_name,
      published_at: date,
      verified_at: date,
      location: '예시 문서 2쪽: 복지 지원 안내',
      grade: 'A',
      url: 'https://example.org/benefits',
    },
  })),
}))
const methodology = {
  data_version,
  title: '조사 기준·정정 이력',
  paragraphs: [
    '현재 모든 기업·claim·점수는 UI 검증용 예시 데이터입니다. 실제 조사는 연결되지 않았습니다.',
    '확인 불가는 복지가 없다는 뜻이 아닙니다. 정확한 전체 매출순위가 아닙니다.',
    '분야별 점수: 확인된 세부 유형 범위 35, 적용 대상의 폭 30, 구체성 20, 공식성·최신성 15. 종합순위를 제공하지 않습니다.',
    '현재 A/B 근거, 적용 범위, 최신성이 부족하거나 상충하면 평가 근거 부족으로 분리합니다. 동점은 최신성, 적용 범위, canonical company ID 순입니다.',
    '정정은 Community 댓글·신고 정책을 따릅니다. 비공개 문서와 개인정보를 게시하지 마세요. 정정 이력: 2026-10-29 예시 데이터 최초 생성.',
  ],
}
const detailPayloads = Object.fromEntries(
  details.map((detail) => [
    `details/${detail.company_id}.json`,
    [{ data_version, companies: [detail] }, 1],
  ]),
)
const payloads = {
  'company-index.json': [{ data_version, companies }, companies.length],
  'rankings.json': [{ data_version, rows }, rows.length],
  ...detailPayloads,
  'methodology.json': [methodology, methodology.paragraphs.length],
}
const artifact_sha256 = {}
await rm(new URL('fixture-v1/details/', dir), { recursive: true, force: true })
for (const [name, [data, record_count]] of Object.entries(payloads)) {
  const raw = JSON.stringify(data) + '\n'
  const target = new URL('fixture-v1/' + name, dir)
  await mkdir(new URL('.', target), { recursive: true })
  await writeFile(target, raw)
  artifact_sha256[base + name] = { sha256: sha(raw), record_count }
}
const manifest = {
  schema_version: 1,
  data_version,
  fixture: true,
  generated_at: date + 'T00:00:00Z',
  protocol_hash: sha('fictional-fixture-protocol-v1'),
  effective_selection_hashes: [
    sha(companies.map((c) => c.company_id).join('\n')),
  ],
  company_count: companies.length,
  category_taxonomy: categories,
  status_taxonomy: statuses,
  index_url: base + 'company-index.json',
  rankings_url: base + 'rankings.json',
  methodology_url: base + 'methodology.json',
  detail_shards: Object.fromEntries(
    companies.map((c) => [
      c.company_id,
      base + `details/${c.company_id}.json`,
    ]),
  ),
  artifact_sha256,
}
for (const name of ['manifest.json', 'fixture-v1/manifest.json'])
  await writeFile(new URL(name, dir), JSON.stringify(manifest) + '\n')
console.log(
  'Generated 56 fictional companies, 560 category rows and 560 claims.',
)

// The local methodology remains readable independently of the network artifacts.
await writeFile(
  new URL(
    '../community-app/src/data/benefitsMethodology.json',
    import.meta.url,
  ),
  JSON.stringify(methodology, null, 2) + '\n',
)
