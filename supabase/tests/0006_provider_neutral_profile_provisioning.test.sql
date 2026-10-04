begin;

select plan(38);

select col_is_null(
  'public',
  'profiles',
  'github_user_id',
  'legacy GitHub id is nullable for provider-neutral profiles'
);
select has_function(
  'private',
  'provision_oauth_profile_identity',
  array['text', 'text', 'uuid', 'jsonb'],
  'private provisioning helper exists for triggers and backfill'
);
select function_returns(
  'private',
  'provision_oauth_profile_identity',
  array['text', 'text', 'uuid', 'jsonb'],
  'void',
  'private provisioning helper returns void'
);
select ok(
  not has_function_privilege('anon', 'private.provision_oauth_profile_identity(text,text,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.provision_oauth_profile_identity(text,text,uuid,jsonb)', 'EXECUTE'),
  'browser roles cannot execute the private provisioning helper'
);
select ok(
  exists (
    select 1
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('provision_oauth_profile', 'provision_oauth_profile_identity')
     group by n.nspname
    having pg_catalog.bool_and(
      p.prosecdef
      and p.proconfig = array['search_path=""']
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    )
       and pg_catalog.count(*) = 2
  ),
  'private provisioning functions have an explicit owner, security definer, and empty search path'
);
select is(
  (
    select pg_get_triggerdef(t.oid)
      from pg_trigger as t
      join pg_class as c on c.oid = t.tgrelid
      join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'auth'
       and c.relname = 'identities'
       and t.tgname = 'identities_provision_oauth_profile'
       and not t.tgisinternal
  ),
  'CREATE TRIGGER identities_provision_oauth_profile AFTER INSERT OR UPDATE OF provider_id, user_id, identity_data, provider ON auth.identities FOR EACH ROW EXECUTE FUNCTION private.provision_oauth_profile()',
  'provider-neutral trigger watches only trusted identity fields'
);

insert into auth.users (id, aud, role, email)
values ('62000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'private.person@example.test');

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '109876543210987654321',
      '62000000-0000-0000-0000-000000000001',
      '{"email":"private.person@example.test","full_name":"  Google Person  ","avatar_url":"https://lh3.googleusercontent.com/a/avatar"}'::jsonb,
      'google'
    )$$,
  'trusted Google identity provisions a profile'
);
select is((select github_user_id from public.profiles where id = '62000000-0000-0000-0000-000000000001'), null, 'Google profile has no legacy GitHub claim');
select is(
  (select login from public.profiles where id = '62000000-0000-0000-0000-000000000001'),
  'google-' || md5('62000000-0000-0000-0000-000000000001'),
  'Google login is deterministic and derived only from the user UUID'
);
select is((select char_length(login) from public.profiles where id = '62000000-0000-0000-0000-000000000001'), 39, 'Google login fits the existing login bound');
select ok(
  (select login not like '%private%' and login not like '%example%' from public.profiles where id = '62000000-0000-0000-0000-000000000001'),
  'Google login does not expose email data'
);
select is((select display_name from public.profiles where id = '62000000-0000-0000-0000-000000000001'), 'Google Person', 'Google display name is trimmed');
select is((select avatar_url from public.profiles where id = '62000000-0000-0000-0000-000000000001'), 'https://lh3.googleusercontent.com/a/avatar', 'valid Google HTTPS avatar is retained');

set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.create_post(
    'Google author',
    'A Google-created profile can use the protected mutation path.',
    array['a1000000-0000-0000-0000-000000000002'::uuid],
    'google-profile-protected-mutation'
  )$$,
  'Google user can perform a representative protected mutation'
);
reset role;

insert into auth.users (id, aud, role, email)
values
  ('62000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'invalid-optionals@example.test'),
  ('62000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'unsupported@example.test'),
  ('62000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'malformed@example.test'),
  ('62000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'second-google@example.test'),
  ('62000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'legacy-github@example.test'),
  ('62000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'github-attacker@example.test'),
  ('62000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'backfill-helper@example.test'),
  ('62000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'future-kakao@example.test'),
  ('62000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'overlong-subject@example.test');

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '209876543210987654321',
      '62000000-0000-0000-0000-000000000002',
      jsonb_build_object('full_name', repeat('x', 121), 'avatar_url', 'http://example.test/avatar.png'),
      'google'
    )$$,
  'invalid optional Google metadata does not block profile creation'
);
select is((select display_name from public.profiles where id = '62000000-0000-0000-0000-000000000002'), null, 'overlong Google display name degrades to null');
select is((select avatar_url from public.profiles where id = '62000000-0000-0000-0000-000000000002'), null, 'non-HTTPS Google avatar degrades to null');

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('subject-1', '62000000-0000-0000-0000-000000000003', '{}'::jsonb, 'email')$$,
  'unsupported identity remains insertable'
);
select is((select count(*)::integer from public.profiles where id = '62000000-0000-0000-0000-000000000003'), 0, 'unsupported identity fails closed without a profile');
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('bad subject!', '62000000-0000-0000-0000-000000000004', '{}'::jsonb, 'google')$$,
  'malformed allowlisted identity remains insertable'
);
select is((select count(*)::integer from public.profiles where id = '62000000-0000-0000-0000-000000000004'), 0, 'malformed allowlisted identity fails closed without a profile');
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (repeat('1', 256), '62000000-0000-0000-0000-000000000010', '{}'::jsonb, 'google')$$,
  'overlong allowlisted provider id remains insertable'
);
select is((select count(*)::integer from public.profiles where id = '62000000-0000-0000-0000-000000000010'), 0, 'overlong allowlisted provider id fails closed without a profile');

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('309876543210987654321', '62000000-0000-0000-0000-000000000005', '{}'::jsonb, 'google')$$,
  'a second Google identity provisions independently'
);
select isnt(
  (select login from public.profiles where id = '62000000-0000-0000-0000-000000000001'),
  (select login from public.profiles where id = '62000000-0000-0000-0000-000000000005'),
  'deterministic Google logins remain collision-safe across profile primary keys'
);

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('987654321', '62000000-0000-0000-0000-000000000009', '{"name":" Kakao Person ","picture":"https://k.kakaocdn.net/avatar.png"}'::jsonb, 'kakao')$$,
  'future allowlisted Kakao identity provisions without a schema change'
);
select is(
  (select jsonb_build_array(login, display_name, avatar_url) from public.profiles where id = '62000000-0000-0000-0000-000000000009'),
  jsonb_build_array('kakao-' || md5('62000000-0000-0000-0000-000000000009'), 'Kakao Person', 'https://k.kakaocdn.net/avatar.png'),
  'Kakao profile uses deterministic login and sanitized provider metadata'
);

insert into public.profiles (id, github_user_id, login, display_name, avatar_url)
values (
  '62000000-0000-0000-0000-000000000006',
  98006,
  'legacy-octo',
  'Legacy Octo',
  'https://avatars.githubusercontent.com/u/98006'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('98006', '62000000-0000-0000-0000-000000000006', '{"user_name":"legacy-octo","full_name":"Legacy Octo","avatar_url":"https://avatars.githubusercontent.com/u/98006"}'::jsonb, 'github')$$,
  'matching GitHub identity preserves an existing legacy profile'
);
select is((select github_user_id from public.profiles where id = '62000000-0000-0000-0000-000000000006'), 98006::bigint, 'existing legacy GitHub claim is preserved');
select is((select login from public.profiles where id = '62000000-0000-0000-0000-000000000006'), 'legacy-octo', 'existing legacy GitHub login is preserved');
select throws_ok(
  $$select private.provision_oauth_profile_identity(
      'github',
      '98006',
      '62000000-0000-0000-0000-000000000007',
      '{"user_name":"claim-thief"}'::jsonb
    )$$,
  '23505',
  'GitHub identity is already linked to another profile',
  'another user cannot overwrite a legacy GitHub claim'
);
select is((select count(*)::integer from public.profiles where id = '62000000-0000-0000-0000-000000000007'), 0, 'failed cross-user GitHub claim creates no profile');

select is((select count(*)::integer from public.profiles where id = '62000000-0000-0000-0000-000000000008'), 0, 'eligible backfill user starts without a profile');
select lives_ok(
  $$select private.provision_oauth_profile_identity(
      'google',
      '409876543210987654321',
      '62000000-0000-0000-0000-000000000008',
      '{"full_name":"Backfilled Person"}'::jsonb
    )$$,
  'private helper can safely backfill without updating auth-managed rows'
);
select is((select login from public.profiles where id = '62000000-0000-0000-0000-000000000008'), 'google-' || md5('62000000-0000-0000-0000-000000000008'), 'backfill helper provisions the deterministic Google profile');

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('509876543210987654321', '62000000-0000-0000-0000-000000000006', '{"full_name":"Must Not Replace GitHub"}'::jsonb, 'google')$$,
  'linking Google to an existing GitHub profile is safe'
);
select is((select github_user_id from public.profiles where id = '62000000-0000-0000-0000-000000000006'), 98006::bigint, 'linked Google identity does not clear the legacy GitHub claim');
select is((select login from public.profiles where id = '62000000-0000-0000-0000-000000000006'), 'legacy-octo', 'linked Google identity does not overwrite the GitHub login');

select * from finish();
rollback;
