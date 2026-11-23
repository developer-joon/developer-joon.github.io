import { BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH, type BenefitCorrectionDraft } from '../types/benefitCorrections'
import type { BenefitDirectoryPublication } from '../types/benefitDirectory'

const JOINER = ' / '

function codePoints(value: string) { return Array.from(value) }
function codePointLength(value: string) { return codePoints(value).length }

function publicationText(publication: BenefitDirectoryPublication) {
  return [
    `${publication.title} — ${publication.description}`,
    publication.eligibilityText && `대상: ${publication.eligibilityText}`,
    publication.conditionText && `조건: ${publication.conditionText}`,
    publication.trustLabel,
  ].filter(Boolean).join(' · ')
}

function truncatedPublicationText(publication: BenefitDirectoryPublication, max: number, omitted: number) {
  const omission = omitted > 0 ? ` · 이후 ${omitted}건 생략` : ''
  const suffix = ` … [내용 잘림${omission}] · ${publication.trustLabel}`
  const body = [
    `${publication.title} — ${publication.description}`,
    publication.eligibilityText && `대상: ${publication.eligibilityText}`,
    publication.conditionText && `조건: ${publication.conditionText}`,
  ].filter(Boolean).join(' · ')
  const availableBody = max - codePointLength(suffix)
  if (availableBody < codePointLength(publication.title)) return null
  return `${codePoints(body).slice(0, availableBody).join('')}${suffix}`
}

export function renderBenefitCorrectionPublications(
  publications: BenefitDirectoryPublication[],
  category: BenefitCorrectionDraft['categoryId'],
): string | null {
  const matching = publications.filter(publication => publication.categoryId === category)
  if (matching.length === 0) return null

  const complete = matching.map(publicationText).join(JOINER)
  if (codePointLength(complete) <= BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH) return complete

  let rendered = ''
  for (let index = 0; index < matching.length; index += 1) {
    const publication = matching[index]
    const joiner = rendered ? JOINER : ''
    const omitted = matching.length - index - 1
    const completeCandidate = `${rendered}${joiner}${publicationText(publication)}`
    const laterMarker = omitted > 0 ? `${JOINER}… [이후 ${omitted}건 생략]` : ''
    if (codePointLength(`${completeCandidate}${laterMarker}`) <= BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH) {
      rendered = completeCandidate
      continue
    }

    const available = BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH - codePointLength(rendered) - codePointLength(joiner)
    const truncated = truncatedPublicationText(publication, available, omitted)
    if (truncated !== null) return `${rendered}${joiner}${truncated}`

    const omissionMarker = `… [이후 ${matching.length - index}건 생략]`
    return `${rendered}${joiner}${omissionMarker}`
  }
  return rendered
}
