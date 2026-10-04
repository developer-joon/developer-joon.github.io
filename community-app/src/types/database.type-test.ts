import type { Tables, TablesInsert, TablesUpdate } from './database'

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

export type ProfileTypeAssertions = [
  ProfileRowHasNullableGithubId,
  ProfileInsertMayOmitOrNullGithubId,
  ProfileUpdateMayNullGithubId,
  ProfileRowHasNullableMetadataProvider,
  ProfileInsertMayOmitOrNullMetadataProvider,
  ProfileUpdateMayNullMetadataProvider,
]