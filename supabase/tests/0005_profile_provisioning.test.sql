begin;

select plan(71);

select has_function(
  'private',
  'provision_github_profile',
  array[]::text[],
  'GitHub profile provisioning function exists'
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
  'identities_provision_github_profile',
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
      '{"provider_id":"99999","user_name":"attacker","full_name":"Attacker","avatar_url":"https://attacker.test/avatar.png"}'::jsonb
    )
  $$,
  'auth user insert remains available before its identity is inserted'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  0,
  'user-editable metadata cannot provision a profile'
);
select lives_ok(
  $$
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '96001',
      '61000000-0000-0000-0000-000000000001',
      '{"user_name":"  Octo-Cat  ","full_name":"  Octo Cat  ","avatar_url":"https://avatars.githubusercontent.com/u/96001?v=4"}'::jsonb,
      'github'
    )
  $$,
  'trusted GitHub identity provisions without blocking identity insert'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  96001::bigint,
  'numeric GitHub provider id is persisted from auth identities'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Octo-Cat',
  'GitHub identity login is trimmed'
);
select is(
  (select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Octo Cat',
  'optional identity display name is trimmed'
);
select is(
  (select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'https://avatars.githubusercontent.com/u/96001?v=4',
  'safe HTTPS identity avatar URL is retained'
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
  'identity-provisioned GitHub user can call protected mutations immediately'
);
reset role;

select lives_ok(
  $$
    update auth.users
       set raw_user_meta_data = '{"provider_id":"97001","user_name":"attacker-renamed","full_name":"Owned","avatar_url":"https://attacker.test/owned.png"}'::jsonb
     where id = '61000000-0000-0000-0000-000000000001'
  $$,
  'direct raw user metadata update remains an allowed auth operation'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  96001::bigint,
  'raw user metadata cannot rebind the immutable GitHub identity'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Octo-Cat',
  'raw user metadata cannot alter login'
);
select is(
  (select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Octo Cat',
  'raw user metadata cannot alter display name'
);
select is(
  (select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'https://avatars.githubusercontent.com/u/96001?v=4',
  'raw user metadata cannot alter avatar URL'
);

select lives_ok(
  $$
    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data
    ) values (
      '61000000-0000-0000-0000-000000000002',
      'authenticated',
      'authenticated',
      'raw-only@example.test',
      '{"provider":"github"}'::jsonb,
      '{"provider_id":"96002","user_name":"raw-only"}'::jsonb
    )
  $$,
  'raw metadata-only auth user remains insertable'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000002'),
  0,
  'raw metadata-only auth user receives no profile'
);

select lives_ok(
  $$
    update auth.identities
       set identity_data = '{"user_name":" octo-cat-renamed ","full_name":" Renamed Cat ","avatar_url":"javascript:alert(1)"}'::jsonb
     where provider = 'github'
       and provider_id = '96001'
  $$,
  'trusted GitHub identity metadata refresh is idempotent'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  96001::bigint,
  'trusted refresh preserves immutable GitHub identity'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'octo-cat-renamed',
  'trusted refresh updates login'
);
select is(
  (select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  'Renamed Cat',
  'trusted refresh updates display name'
);
select is(
  (select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  null,
  'invalid trusted avatar URL degrades to null'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000001'),
  1,
  'trusted refresh does not duplicate the profile'
);
select throws_ok(
  $$
    update auth.identities
       set provider_id = '96002'
     where provider = 'github'
       and provider_id = '96001'
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

select lives_ok(
  $$
    insert into auth.users (id, aud, role, email)
    values (
      '61000000-0000-0000-0000-000000000011',
      'authenticated',
      'authenticated',
      'github-conflict@example.test'
    )
  $$,
  'conflicting identity auth user remains insertable'
);
select throws_ok(
  $$
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '96001',
      '61000000-0000-0000-0000-000000000011',
      '{"user_name":"another-account"}'::jsonb,
      'github'
    )
  $$,
  '23505'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000011'),
  0,
  'GitHub identity conflict creates no second profile'
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
  'non-GitHub auth user remains insertable'
);
select lives_ok(
  $$
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      'email-provider@example.test',
      '61000000-0000-0000-0000-000000000003',
      '{"user_name":"not-github"}'::jsonb,
      'email'
    )
  $$,
  'non-GitHub identity remains insertable'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000003'),
  0,
  'non-GitHub identity does not provision a profile'
);
select lives_ok(
  $$
    update auth.users
       set raw_app_meta_data = '{"provider":"github","providers":["github"]}'::jsonb,
           raw_user_meta_data = '{"provider_id":"96003","user_name":"raw-linked-github"}'::jsonb
     where id = '61000000-0000-0000-0000-000000000003'
  $$,
  'user-editable provider metadata update remains an allowed auth operation'
);
select is(
  (select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000003'),
  0,
  'user-editable provider metadata cannot create a profile'
);
select lives_ok(
  $$
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      '96003',
      '61000000-0000-0000-0000-000000000003',
      '{"user_name":" linked-github ","full_name":"Linked User","avatar_url":"https://example.test/avatar.png"}'::jsonb,
      'github'
    )
  $$,
  'trusted GitHub account linking provisions the missing profile'
);
select is(
  (select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000003'),
  96003::bigint,
  'trusted GitHub account linking persists provider id'
);

select lives_ok(
  $$
    insert into auth.users (id, aud, role, email)
    values
      ('61000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'zero-id@example.test'),
      ('61000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'nonnumeric-id@example.test'),
      ('61000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'negative-id@example.test'),
      ('61000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'overflow-id@example.test')
  $$,
  'invalid provider id auth users remain insertable'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values ('0', '61000000-0000-0000-0000-000000000004', '{"user_name":"zero-id"}'::jsonb, 'github')$$,
  'zero GitHub provider id does not block identity insert'
);
select is((select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000004'), 0, 'zero GitHub provider id fails closed');
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values ('not-a-number', '61000000-0000-0000-0000-000000000005', '{"user_name":"nonnumeric-id"}'::jsonb, 'github')$$,
  'nonnumeric GitHub provider id does not block identity insert'
);
select is((select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000005'), 0, 'nonnumeric GitHub provider id fails closed');
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values ('-96009', '61000000-0000-0000-0000-000000000009', '{"user_name":"negative-id"}'::jsonb, 'github')$$,
  'negative GitHub provider id does not block identity insert'
);
select is((select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000009'), 0, 'negative GitHub provider id fails closed');
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values ('999999999999999999999999', '61000000-0000-0000-0000-000000000010', '{"user_name":"overflow-id"}'::jsonb, 'github')$$,
  'overflowing GitHub provider id does not block identity insert'
);
select is((select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000010'), 0, 'overflowing GitHub provider id fails closed');

select lives_ok(
  $$insert into auth.users (id, aud, role, email)
     values ('61000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'bad-login@example.test')$$,
  'invalid login auth user remains insertable'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values ('96006', '61000000-0000-0000-0000-000000000006', '{"user_name":"bad login!"}'::jsonb, 'github')$$,
  'invalid GitHub login does not block identity insert'
);
select is((select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000006'), 0, 'invalid GitHub login fails closed');

select lives_ok(
  $$insert into auth.users (id, aud, role, email)
     values ('61000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'consecutive-hyphens@example.test')$$,
  'consecutive-hyphen login auth user remains insertable'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values ('96012', '61000000-0000-0000-0000-000000000012', '{"user_name":"octo--cat"}'::jsonb, 'github')$$,
  'consecutive-hyphen GitHub login does not block identity insert'
);
select is((select count(*)::integer from public.profiles where id = '61000000-0000-0000-0000-000000000012'), 0, 'consecutive-hyphen GitHub login fails closed');

select lives_ok(
  $$insert into auth.users (id, aud, role, email)
     values ('61000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'optional-invalid@example.test')$$,
  'invalid optional metadata auth user remains insertable'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
     values (
       '96007',
       '61000000-0000-0000-0000-000000000007',
       '{"user_name":"valid-login","full_name":"   ","avatar_url":"javascript:alert(1)"}'::jsonb,
       'github'
     )$$,
  'invalid optional identity metadata does not block profile creation'
);
select is((select github_user_id from public.profiles where id = '61000000-0000-0000-0000-000000000007'), 96007::bigint, 'valid identity still provisions with invalid optional metadata');
select is((select login from public.profiles where id = '61000000-0000-0000-0000-000000000007'), 'valid-login', 'valid identity login is preserved');
select is((select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000007'), null, 'blank display name degrades to null');
select is((select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000007'), null, 'invalid avatar URL degrades to null');
select lives_ok(
  $$update auth.identities
       set identity_data = jsonb_build_object(
         'user_name', 'valid-login',
         'full_name', repeat('x', 121),
         'avatar_url', '   '
       )
     where provider = 'github'
       and provider_id = '96007'$$,
  'other invalid optional identity metadata also permits trusted refresh'
);
select is((select display_name from public.profiles where id = '61000000-0000-0000-0000-000000000007'), null, 'overlong display name degrades to null');
select is((select avatar_url from public.profiles where id = '61000000-0000-0000-0000-000000000007'), null, 'blank avatar URL degrades to null');

select lives_ok(
  $$insert into auth.users (id, aud, role, email)
    values ('61000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'manual-fixture@example.test')$$,
  'existing manual auth fixture shape remains insertable'
);
select lives_ok(
  $$insert into public.profiles (id, github_user_id, login, display_name)
    values ('61000000-0000-0000-0000-000000000008', 96008, 'manual-fixture', 'Manual Fixture')$$,
  'existing manual profile fixture shape remains insertable'
);
select is(
  (select login from public.profiles where id = '61000000-0000-0000-0000-000000000008'),
  'manual-fixture',
  'manual profile fixture is preserved'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$update public.profiles set display_name = 'Browser overwrite' where id = '61000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'browser role cannot write profile presentation fields directly'
);
reset role;

select * from finish();
rollback;
