import { expectTypeOf, it } from 'vitest'
import type { BenefitDirectoryPublication } from './benefitDirectory'

it('versions the v2 publication linkage as an exact nullable UUID-shaped string field', () => {
  expectTypeOf<BenefitDirectoryPublication['originClaimId']>().toEqualTypeOf<string | null>()
})
