import { useEffect, useMemo, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { domesticDirectoryClient, selectDomestic, type DomesticEntry, type DomesticState, type SizeFilter } from '../data/domesticDirectoryClient'
import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'

const sizeOptions: Array<[SizeFilter, string]> = [['all', '전체 규모'], ['large', '대기업 집단 소속'], ['mid', '중견기업 기록'], ['sme', '중소기업'], ['medium', '중기업'], ['small', '소기업'], ['unknown', '분류 미확인']]
function parse(search: string): DomesticState {
  const p = new URLSearchParams(search.slice(0, 2000))
  const size = p.get('size')
  const page = Number(p.get('page'))
  return { q: (p.get('q') ?? '').slice(0, 120), size: sizeOptions.some(([value]) => size === value) ? size as SizeFilter : 'all', benefits: p.get('benefits') === '1', page: Number.isSafeInteger(page) && page > 0 ? page : 1 }
}
function serialize(state: DomesticState) {
  const p = new URLSearchParams()
  if (state.q.trim()) p.set('q', state.q.trim())
  if (state.size !== 'all') p.set('size', state.size)
  if (state.benefits) p.set('benefits', '1')
  if (state.page > 1) p.set('page', String(state.page))
  const q = p.toString()
  return q ? `?${q}` : ''
}
const sizeName = (entry: DomesticEntry) => ({ large_affiliate: '공시대상기업집단 소속', mid_history: '중견기업 기록', sme_unspecified: '중소기업(세부 규모 미확인)', medium: '중기업', small: '소기업', unclassified: '분류 미확인' })[entry.size_class]
const sourceLinks = {
  ftc: 'https://www.ftc.go.kr/www/selectBbsNttView.do?bordCd=3&key=12&nttSn=48244',
  mid: 'https://www.data.go.kr/data/15102331/fileData.do',
  sme: 'https://www.data.go.kr/data/15018880/fileData.do',
  recruitment: 'https://www.data.go.kr/data/15100246/fileData.do',
}

export function mergeDomesticEntries(directory: DomesticEntry[], base: Array<{ id: string; name: string }>, labels: Map<string, DomesticEntry['size_evidence']>): DomesticEntry[] {
  const seen = new Set(directory.map(entry => entry.id))
  const names = new Map(base.map(entry => [entry.id, entry.name]))
  return [
    ...directory.map(entry => entry.id.startsWith('KR-CRN-') ? { ...entry, name: names.get(entry.id) ?? entry.name } : entry),
    ...base.filter(entry => !seen.has(entry.id)).map((entry): DomesticEntry => ({ ...entry, source_type: 'base_legal_identity', size_class: labels.get(entry.id)?.size_class ?? 'unclassified', size_evidence: labels.get(entry.id) })),
  ]
}

export function DirectoryResults({ entries, research, edition, state, update }: { entries: DomesticEntry[]; research: Map<string, number>; edition: string; state: DomesticState; update: (patch: Partial<DomesticState>) => void }) {
  const { total, pages, page, pageEntries } = selectDomestic(entries, state, research)
  return <section className="domestic-directory" aria-labelledby="directory-heading">
    <div className="domestic-directory__heading"><p className="domestic-directory__eyebrow">KOREAN COMPANY INDEX / 공개 근거의 범위 안에서</p><h2 id="directory-heading">국내 기업을 찾아보세요</h2><p>기업명으로 찾고, 공개 복지 조사 현황과 날짜가 있는 규모 근거를 구분해 보세요. 검색 결과는 현재 영업·고용 상태를 보증하지 않습니다.</p></div>
    <div className="domestic-directory__filters"><label>기업명 검색<input type="search" value={state.q} maxLength={120} placeholder="기업명을 입력하세요" onChange={event => update({ q: event.target.value, page: 1 })} /></label><label>기업 규모 근거<select value={state.size} onChange={event => update({ size: event.target.value as SizeFilter, page: 1 })}>{sizeOptions.map(([value, title]) => <option value={value} key={value}>{title}</option>)}</select></label><label className="domestic-directory__check"><input type="checkbox" checked={state.benefits} onChange={event => update({ benefits: event.target.checked, page: 1 })} /> 구체적 복지 조사 항목 있는 기업만</label></div>
    <p className="domestic-directory__count" aria-live="polite">검색 결과 <strong>{total.toLocaleString('ko-KR')}</strong>개 기업 · {page} / {pages}쪽</p>
    {total === 0 && <p role="status">현재 조건에 맞는 공식 근거 또는 조사 항목이 없습니다. 복지가 없다는 뜻이 아닙니다. 중기업·소기업 세부 구분은 확인된 공식 근거가 없어 비어 있을 수 있습니다.</p>}
    <div className="domestic-directory__list">{pageEntries.map(entry => {
      const count = entry.id.startsWith('KR-CRN-') ? research.get(entry.id) ?? 0 : 0
      return <article key={entry.id} className="domestic-directory__record"><div className="domestic-directory__record-main"><p className="domestic-directory__status">{count ? `조사 중 ${count}건` : '공개 복지 정보 미확인'}</p><h3>{count ? <a href={`/community/benefits/company/?id=${encodeURIComponent(entry.id)}`}>{entry.name} <span aria-hidden="true">↗</span></a> : entry.name}</h3><p className="domestic-directory__size">{sizeName(entry)}{entry.size_evidence && ` · 기준 ${entry.size_evidence.as_of}`}</p>{count > 0 && <p className="domestic-directory__note">구체적 조사 항목 · 승인 혜택 아님. 기업 상세에서 실제 제공 내용과 제한을 확인하세요.</p>}</div><details><summary>출처·관측 범위</summary><p>{entry.source_type === 'ftc_affiliate' ? `공정거래위원회 계열회사 기록 · ${entry.size_evidence?.as_of} 기준${entry.group ? ` · ${entry.group} 집단` : ''}. 고용·복지 정책 확인 자료가 아닙니다. 공공누리 제1유형(출처표시).` : entry.source_type === 'base_legal_identity' ? '기존 법인 명부 · 복지 조사 범위와 현재 정책은 별도 확인이 필요합니다.' : `중소벤처기업진흥공단 채용 관측 · 공고일 ${entry.observation_date} · 자료 판본 ${edition}${entry.region ? ` · 관측 지역 ${entry.region}` : ''}${entry.employee_count !== undefined ? ` · 당시 자료의 종업원 수 ${entry.employee_count}명` : ''}. 현재 고용 상태나 법적 기업 규모가 아닙니다.`}</p>{entry.source_type !== 'base_legal_identity' && <a href={sourceLinks[entry.source_type === 'ftc_affiliate' ? 'ftc' : 'recruitment']} rel="noopener noreferrer" target="_blank">원본 자료 보기</a>}{entry.size_evidence && <p>규모 근거: {entry.size_evidence.source === 'ftc' ? '공정거래위원회 계열회사 지정' : entry.size_evidence.source === 'mid' ? '중견기업 기록 (현재 인증 아님)' : '유효기간이 있는 중소기업 지정'} · 기준 {entry.size_evidence.as_of}{entry.size_evidence.expires_on && ` · 만료 ${entry.size_evidence.expires_on}`} · <a href={sourceLinks[entry.size_evidence.source]} rel="noopener noreferrer" target="_blank">공식 근거</a></p>}</details></article>
    })}</div>
    <nav aria-label="기업 검색 페이지" className="domestic-directory__pagination"><button type="button" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>이전 페이지</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>다음 페이지</button></nav>
  </section>
}

export function BenefitsDirectoryPage({ search }: { search: string }) {
  const [raw, setRaw] = useState(search)
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<{ entries: DomesticEntry[]; research: Map<string, number>; edition: string; totals: { new_records: number }; approved: number | undefined }>()
  const [error, setError] = useState(false)
  useEffect(() => { const callback = () => setRaw(window.location.search); window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback) }, [])
  useEffect(() => {
    const controller = new AbortController(); let active = true
    const load = async () => {
      const atlas = await benefitsClient.loadAtlas(controller.signal)
      const base = atlas.companies.filter(c => c.company_id.startsWith('KR-CRN-'))
      const directory = await domesticDirectoryClient.load(new Set(base.map(c => c.company_id)), controller.signal)
      const entries = mergeDomesticEntries(directory.entries, base.map(c => ({ id: c.company_id, name: c.legal_name })), directory.baseLabels)
      const research = new Map<string, number>()
      for (const lead of atlas.research.leads) research.set(lead.company_id, (research.get(lead.company_id) ?? 0) + 1)
      entries.sort((a, b) => (research.get(b.id) ?? 0) - (research.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
      if (active) setData({ entries, research, edition: directory.edition, totals: directory.totals, approved: atlas.manifest.approved_v2_projection?.verified_proposition_count })
    }
    void load().catch(() => { if (active) setError(true) })
    return () => { active = false; controller.abort() }
  }, [attempt])
  const state = useMemo(() => parse(raw), [raw])
  const update = (patch: Partial<DomesticState>) => { const next = serialize({ ...state, ...patch }); window.history.pushState({}, '', `/community/benefits/directory/${next}`); setRaw(next) }
  return <BenefitsExplorerShell route="directory" query=""><div className="domestic-directory__intro"><p>국내 법인 명부 1,000 · 추가 채용 관측 사업자 {data?.totals.new_records.toLocaleString('ko-KR') ?? '—'} · 계열회사 별도 {data ? (data.entries.length - 1000 - data.totals.new_records).toLocaleString('ko-KR') : '—'}</p><p>구체적 복지 조사 {data ? data.research.size : '—'}개 기업 · 승인된 혜택 {data?.approved === undefined ? '미집계' : `${data.approved}건`}. 채용 관측과 법적 기업 정보는 다른 자료입니다.</p></div>{error ? <div role="alert"><p>국내 기업 자료의 무결성을 확인하지 못했습니다. 일부 자료나 예시 자료로 대체하지 않습니다.</p><button type="button" onClick={() => { setError(false); setData(undefined); setAttempt(n => n + 1) }}>다시 시도</button></div> : !data ? <p role="status">국내 기업 자료의 출처와 해시를 확인하고 있습니다.</p> : <DirectoryResults {...data} state={state} update={update} />}</BenefitsExplorerShell>
}
