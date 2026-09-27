begin;

select plan(44);

select has_function(
  'private',
  'provision_github_profile',
  array[]::text[],
  'GitHub profile provisioning function exists'
);
select has_trigger(
  'auth',
  'users',
  'users_provision_github_profile',
  'auth users provisioning trigger exists'
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
       and p.proname = 'provision_github_profile'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot execute the provisioning function'
);
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'provision_github_profile'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated cannot execute the provisioning function'
);

select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000001',
      'authenticated',
      'authenticated',
      'github-valid@example.test',
      '{"provider":"github","providers":["github"]}'::jsonb,
      '{"provider_id":"96001","user_name":"  Octo-Cat  ","full_name":"  Octo Cat  ","avatar_url":"https://avatars.githubusercontent.com/u/96001?v=4"}'::jsonb
    )
  $$,
  'valid GitHub auth metadata provisions without blocking auth insert'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  96001::bigint,
  'numeric GitHub provider id is persisted'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Octo-Cat',
  'GitHub login is trimmed'
);
select is(
  (select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Octo Cat',
  'optional display name is trimmed'
);
select is(
  (select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'https://avatars.githubusercontent.com/u/96001?v=4',
  'safe HTTPS avatar URL is retained'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  1,
  'exactly one profile is provisioned'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.create_post(
    'Provisioned author',
    'The OAuth-created user can mutate immediately.',
    array['a1000000-0000-0000-0000-000000000002'::uuid],
    'profile-provisioning-immediate-mutation'
  )$$,
  'newly provisioned GitHub user can call protected mutations immediately'
);
reset role;

select lives_ok(
  $$
    update auth.users
       set raw_user_meta_data = '{"provider_id":"96001","user_name":" octo-cat-renamed ","full_name":" Renamed Cat ","avatar_url":"javascript:alert(1)"}'::jsonb
     where id = '61000000-0000-0000-0000-000000000001'
  $$,
  'relevant GitHub metadata updates are idempotent'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  96001::bigint,
  'metadata refresh preserves immutable GitHub identity'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'octo-cat-renamed',
  'metadata refresh updates the mutable login'
);
select is(
  (select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Renamed Cat',
  'metadata refresh updates the mutable display name'
);
select is(
  (select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  null,
  'unsafe avatar URL is stored as null'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  1,
  'metadata refresh does not duplicate the profile'
);
select throws_ok(
  $$
    update auth.users
       set raw_user_meta_data = jsonb_set(raw_user_meta_data, '{provider_id}', '"96002"')
     where id = '61000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'GitHub identity does not match existing profile',
  'an existing profile cannot be rebound to another GitHub identity'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  96001::bigint,
  'failed identity takeover leaves the profile unchanged'
);
select throws_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000002',
      'authenticated',
      'authenticated',
      'github-conflict@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"96001","user_name":"another-account"}'::jsonb
    )
  $$,
  '23505',
  'GitHub identity is already linked to another profile',
  'a GitHub identity conflict fails closed'
);
select is(
  (select count(*)::integer from auth.users where id = '61000000-0000-0000-0000-000000000002'),
  0,
  'identity conflict rolls back the auth user insert'
);

select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000003',
      'authenticated',
      'authenticated',
      'email-provider@example.test',
      '{"provider":"email"}'::jsonb,
      '{"provider_id":"96003","user_name":"not-github"}'::jsonb
    )
  $$,
  'non-GitHub auth insert remains available'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000003'),
  0,
  'non-GitHub metadata does not provision a profile'
);
select lives_ok(
  $$
    update auth.users
       set raw_app_meta_data = '{"provider":"github","providers":["github"]}'::jsonb,
           raw_user_meta_data = '{"provider_id":"96003","user_name":" linked-github ","full_name":"Linked User","avatar_url":"https://example.test/avatar.png"}'::jsonb
     where id = '61000000-0000-0000-0000-000000000003'
  $$,
  'a relevant provider metadata update can provision a missing profile'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000003'),
  96003::bigint,
  'GitHub account linking provisions the missing profile'
);

select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000004',
      'authenticated',
      'authenticated',
      'missing-id@example.test',
      '{"provider":"github"}'::jsonb,
      '{"user_name":"missing-id"}'::jsonb
    )
  $$,
  'missing GitHub id does not block the auth platform insert'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000004'),
  0,
  'missing GitHub id fails closed at profile provisioning'
);
select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000005',
      'authenticated',
      'authenticated',
      'bad-id@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"0","user_name":"bad-id"}'::jsonb
    )
  $$,
  'non-positive GitHub id does not block the auth platform insert'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000005'),
  0,
  'non-positive GitHub id fails closed at profile provisioning'
);
select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000009',
      'authenticated',
      'authenticated',
      'nonnumeric-id@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"not-a-number","user_name":"nonnumeric-id"}'::jsonb
    )
  $$,
  'nonnumeric GitHub id does not block the auth platform insert'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000009'),
  0,
  'nonnumeric GitHub id fails closed at profile provisioning'
);
select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000010',
      'authenticated',
      'authenticated',
      'negative-id@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"-96010","user_name":"negative-id"}'::jsonb
    )
  $$,
  'negative GitHub id does not block the auth platform insert'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000010'),
  0,
  'negative GitHub id fails closed at profile provisioning'
);
select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000006',
      'authenticated',
      'authenticated',
      'bad-login@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"96006","user_name":"bad login!"}'::jsonb
    )
  $$,
  'invalid GitHub login does not block the auth platform insert'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000006'),
  0,
  'invalid GitHub login fails closed at profile provisioning'
);
select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000007',
      'authenticated',
      'authenticated',
      'bad-name@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"96007","user_name":"valid-login","full_name":"   "}'::jsonb
    )
  $$,
  'invalid optional display name does not block the auth platform insert'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000007'),
  0,
  'invalid supplied display name fails closed at profile provisioning'
);

select lives_ok(
  $$
    insert into auth.users (id, aud, role, email)
    values (
      '61000000-0000-0000-0000-000000000008',
      'authenticated',
      'authenticated',
      'manual-fixture@example.test'
    )
  $$,
  'existing manual auth fixture shape remains insertable'
);
select lives_ok(
  $$
    insert into public.profiles (id, github_user_id, login, display_name)
    values (
      '61000000-0000-0000-0000-000000000008',
      96008,
      'manual-fixture',
      'Manual Fixture'
    )
  $$,
  'existing manual profile fixture shape remains insertable'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000008'),
  'manual-fixture',
  'manual profile fixture is preserved'
);

select * from finish();
rollback;
