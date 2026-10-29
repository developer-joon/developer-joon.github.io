import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'
import methodology from '../data/benefitsMethodology.json'
export function BenefitsMethodologyPage() {
  return (
    <BenefitsExplorerShell route="methodology" query="">
      <section className="benefits-evidence">
        <h2>{methodology.title}</h2>
        {methodology.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <h3 id="corrections">정정 제보</h3>
        <p>
          해당 Community 게시글의 댓글·신고 기능으로 제보하면 원장 검증 후 다음
          버전에 반영합니다. 비공개 문서나 개인정보를 게시하지 마세요.
        </p>
        <a href="/community/">Community 댓글·신고 정책과 게시글</a>
      </section>
    </BenefitsExplorerShell>
  )
}
