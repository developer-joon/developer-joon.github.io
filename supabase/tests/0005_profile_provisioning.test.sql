begin;

select plan(24);

select has_function(
  'private',
  'provision_oauth_profile',
  array[]::text[],
  'provider-neutral OAuth profile trigger function exists'
);
select hasnt_trigger(
  'auth',
  'users',
  'users_provision_github_profile',
  'auth users no longer trusts user-editable metadata'
);
select has_trigger(
  'auth',
  'identities',
  'identities_provision_oauth_profile',
  'trusted auth identities provisioning trigger exists'
);
select ok(not has_table_privilege('anon', 'public.profiles', 'INSERT'), 'anon cannot insert profiles directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'authenticated cannot insert profiles directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'authenticated cannot update profiles directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'authenticated cannot delete profiles directly');
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('provision_oauth_profile', 'provision_oauth_profile_identity')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot execute the provisioning functions'
);
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('provision_oauth_profile', 'provision_oauth_profile_identity')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated cannot execute the provisioning functions'
);

select lives_ok(
  $$insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000001',
      'authenticated',
      'authenticated',
      'github-disabled@example.test',
      '{"provider":"github","providers":["github"]}'::jsonb,
      '{"provider_id":"99999","user_name":"attacker"}'::jsonb
    )$$,
  'auth user insert remains available before its identity is inserted'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  0,
  'user-editable metadata cannot provision a profile'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '96001',
      '61000000-0000-0000-0000-000000000001',
      '{"user_name":"Octo-Cat","full_name":"Octo Cat","avatar_url":"https://avatars.githubusercontent.com/u/96001"}'::jsonb,
      'github'
    )$$,
  'valid GitHub identity remains insertable while GitHub login is disabled'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  0,
  'valid GitHub identity does not provision a profile'
);
select lives_ok(
  $$update auth.users
       set raw_user_meta_data = '{"provider_id":"97001","user_name":"attacker-renamed"}'::jsonb
     where id = '61000000-0000-0000-0000-000000000001'$$,
  'direct raw user metadata update remains an allowed auth operation'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  0,
  'raw user metadata update cannot create a profile'
);
select lives_ok(
  $$update auth.identities
       set identity_data = '{"user_name":"octo-cat-renamed","full_name":"Renamed Cat"}'::jsonb
     where provider = 'github'
       and provider_id = '96001'$$,
  'disabled GitHub identity metadata remains updatable'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  0,
  'disabled GitHub identity update does not provision a profile'
);

select lives_ok(
  $$insert into auth.users (id, aud, role, email)
    values ('61000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'legacy-github@example.test')$$,
  'legacy GitHub auth user remains insertable'
);
select lives_ok(
  $$insert into public.profiles (id, github_user_id, login, display_name, avatar_url)
    values (
      '61000000-0000-0000-0000-000000000008',
      96008,
      'legacy-fixture',
      'Legacy Fixture',
      'https://avatars.githubusercontent.com/u/96008'
    )$$,
  'legacy GitHub profile shape remains insertable after github_user_id becomes nullable'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '96008',
      '61000000-0000-0000-0000-000000000008',
      '{"user_name":"replacement","full_name":"Must Not Replace"}'::jsonb,
      'github'
    )$$,
  'linking the matching disabled GitHub identity leaves the legacy profile available'
);
select is(
  (select jsonb_build_array(github_user_id, login, display_name, avatar_url)
     from public.profiles
    where id = '61000000-0000-0000-0000-000000000008'),
  jsonb_build_array(96008, 'legacy-fixture', 'Legacy Fixture', 'https://avatars.githubusercontent.com/u/96008'),
  'legacy GitHub profile data is preserved after identity insertion'
);
select lives_ok(
  $$update auth.identities
       set provider_id = '96009',
           identity_data = '{"user_name":"replacement-again"}'::jsonb
     where provider = 'github'
       and provider_id = '96008'$$,
  'disabled GitHub identity changes do not conflict with legacy profile claims'
);
select is(
  (select jsonb_build_array(github_user_id, login, display_name, avatar_url)
     from public.profiles
    where id = '61000000-0000-0000-0000-000000000008'),
  jsonb_build_array(96008, 'legacy-fixture', 'Legacy Fixture', 'https://avatars.githubusercontent.com/u/96008'),
  'legacy GitHub profile data is preserved after identity update'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000008', true);
select throws_ok(
  $$update public.profiles set display_name = 'Browser overwrite' where id = '61000000-0000-0000-0000-000000000008'$$,
  '42501',
  'permission denied for table profiles',
  'browser role cannot write profile presentation fields directly'
);
reset role;

select * from finish();
rollback;
