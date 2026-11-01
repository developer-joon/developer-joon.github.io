import type { CompanyListing } from '../../types/benefits'
export function CompanyEvidenceHeader({ company, version }: { company: CompanyListing; version: string }) {
  return <section aria-label="기업 기본 정보"><h2>{company.display_name}</h2><dl><dt>법인명</dt><dd>{company.legal_name}</dd><dt>선정 보고 법인</dt><dd>{company.selected_reporting_legal_entity}</dd><dt>관할·본점 국가</dt><dd>{company.jurisdiction} · {company.registered_head_office_country}</dd><dt>부문</dt><dd>{company.sector === 'financial' ? '금융' : '비금융'}</dd><dt>기업 범위</dt><dd>{company.scope === 'domestic' ? '국내' : '해외'}</dd><dt>데이터 버전</dt><dd>{version}</dd></dl></section>
}
