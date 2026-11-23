import type { Database, Json, Tables, TablesInsert, TablesUpdate } from './database'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type Expect<Value extends true> = Value

type ProfileRow = Tables<'profiles'>
type ProfileInsert = TablesInsert<'profiles'>
type ProfileUpdate = TablesUpdate<'profiles'>

type ProfileRowHasNullableGithubId = Expect<Equal<ProfileRow['github_user_id'], number | null>>
type ProfileInsertMayOmitOrNullGithubId = Expect<Equal<ProfileInsert['github_user_id'], number | null | undefined>>
type ProfileUpdateMayNullGithubId = Expect<Equal<ProfileUpdate['github_user_id'], number | null | undefined>>
type ProfileRowHasNullableMetadataProvider = Expect<Equal<ProfileRow['metadata_provider'], string | null>>
type ProfileInsertMayOmitOrNullMetadataProvider = Expect<Equal<ProfileInsert['metadata_provider'], string | null | undefined>>
type ProfileUpdateMayNullMetadataProvider = Expect<Equal<ProfileUpdate['metadata_provider'], string | null | undefined>>

type ClaimEventOperation = 'create' | 'withdraw' | 'moderate' | 'promote' | 'review' | 'merge_target'
type ClaimEventRowOperationExact = Expect<Equal<Tables<'benefit_claim_events'>['operation'], ClaimEventOperation>>
type ClaimEventInsertOperationExact = Expect<Equal<TablesInsert<'benefit_claim_events'>['operation'], ClaimEventOperation>>
type ClaimEventUpdateOperationExact = Expect<Equal<TablesUpdate<'benefit_claim_events'>['operation'], ClaimEventOperation | undefined>>
type OfficialVerifyArgs = Database['public']['Functions']['officially_verify_benefit_claim_v1']['Args']
type OfficialVerifyStatusExact = Expect<Equal<OfficialVerifyArgs['p_expected_status'], 'submitted' | 'community_confirmed' | 'disputed'>>
type OfficialVerifyArgsExact = Expect<Equal<OfficialVerifyArgs, {
  p_claim_id: string
  p_client_key: string
  p_condition_text: string | null
  p_description: string
  p_eligibility_text: string | null
  p_evidence_observed_on: string
  p_evidence_source_url: string
  p_evidence_type: 'official_website' | 'company_policy' | 'regulatory_filing' | 'employment_document' | 'other_official'
  p_expected_revision: number
  p_expected_status: 'submitted' | 'community_confirmed' | 'disputed'
  p_title: string
  p_verification_note: string
}>>
type OfficialVerifyReturnExact = Expect<Equal<Database['public']['Functions']['officially_verify_benefit_claim_v1']['Returns'], Json>>
type ModerateClaimArgsExact = Expect<Equal<Database['public']['Functions']['moderate_benefit_claim_v1']['Args'], {
  p_action: 'hide' | 'restore' | 'withdraw' | 'merge' | 'withdraw_official'
  p_claim_id: string
  p_client_key: string
  p_evidence_observed_on?: string | null
  p_evidence_source_url?: string | null
  p_evidence_type?: 'official_website' | 'company_policy' | 'regulatory_filing' | 'employment_document' | 'other_official' | null
  p_expected_revision: number
  p_expected_status: 'submitted' | 'community_confirmed' | 'disputed' | 'hidden' | 'withdrawn'
  p_reason?: string | null
  p_target_claim_id?: string | null
}>>
type ModerateClaimReturnExact = Expect<Equal<Database['public']['Functions']['moderate_benefit_claim_v1']['Returns'], Json>>

export type ProfileTypeAssertions = [
  ProfileRowHasNullableGithubId,
  ProfileInsertMayOmitOrNullGithubId,
  ProfileUpdateMayNullGithubId,
  ProfileRowHasNullableMetadataProvider,
  ProfileInsertMayOmitOrNullMetadataProvider,
  ProfileUpdateMayNullMetadataProvider,
  ClaimEventRowOperationExact,
  ClaimEventInsertOperationExact,
  ClaimEventUpdateOperationExact,
  OfficialVerifyStatusExact,
  OfficialVerifyArgsExact,
  OfficialVerifyReturnExact,
  ModerateClaimArgsExact,
  ModerateClaimReturnExact,
]