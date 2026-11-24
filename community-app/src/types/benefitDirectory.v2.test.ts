import { it } from 'vitest'
import type {
  BenefitCompanyDetail,
  BenefitCompanyDetailV1,
  BenefitCompanyDetailV2,
  BenefitDirectoryPublication,
  BenefitDirectoryPublicationV1,
  BenefitDirectoryPublicationV2,
} from './benefitDirectory'

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false
type Expect<Value extends true> = Value

it('keeps the v1 publication contract exact and versions linkage only in v2', () => {
  type V1Keys =
    | 'publicationId' | 'categoryId' | 'title' | 'description'
    | 'eligibilityText' | 'conditionText' | 'trustLabel' | 'revision'

  type _V1KeysAreExact = Expect<Equal<keyof BenefitDirectoryPublicationV1, V1Keys>>
  type _LegacyNameStaysV1 = Expect<Equal<BenefitDirectoryPublication, BenefitDirectoryPublicationV1>>
  type _V2AddsOnlyLinkage = Expect<Equal<keyof BenefitDirectoryPublicationV2, V1Keys | 'originClaimId'>>
  type _V2LinkageIsRequiredNullable = Expect<Equal<BenefitDirectoryPublicationV2['originClaimId'], string | null>>
  type _V1DetailUsesV1 = Expect<Equal<BenefitCompanyDetailV1['publications'][number], BenefitDirectoryPublicationV1>>
  type _V2DetailUsesV2 = Expect<Equal<BenefitCompanyDetailV2['publications'][number], BenefitDirectoryPublicationV2>>
  type _CurrentDetailIsV2 = Expect<Equal<BenefitCompanyDetail, BenefitCompanyDetailV2>>

  const checked: [_V1KeysAreExact, _LegacyNameStaysV1, _V2AddsOnlyLinkage, _V2LinkageIsRequiredNullable, _V1DetailUsesV1, _V2DetailUsesV2, _CurrentDetailIsV2] = [true, true, true, true, true, true, true]
  void checked
})
