import type { Company } from '../../types/benefits'
export function CompanyEvidenceHeader({
  company,
  version,
}: {
  company: Company
  version: string
}) {
  return (
    <section aria-label="기업 기본 정보">
      <h2>{company.display_name}</h2>
      <dl>
        <dt>법인명</dt>
        <dd>{company.legal_name}</dd>
        <dt>본사 국가·업종</dt>
        <dd>
          {company.headquarters_country} · {company.industry}
        </dd>
        <dt>규모·기준 회계연도</dt>
        <dd>
          {company.scale_band} · {company.fiscal_year}
        </dd>
        <dt>기업 범위</dt>
        <dd>{company.scope === 'domestic' ? '국내' : '해외'}</dd>
        <dt>마지막 전체 검증일</dt>
        <dd>{company.last_verified_at}</dd>
        <dt>데이터 버전</dt>
        <dd>{version}</dd>
      </dl>
      <p>정확한 전체 매출순위가 아님</p>
    </section>
  )
}
