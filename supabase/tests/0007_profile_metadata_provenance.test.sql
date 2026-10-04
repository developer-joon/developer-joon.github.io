begin;

select plan(19);

select has_column(
  'public',
  'profiles',
  'metadata_provider',
  'profiles record private metadata provenance'
);
select col_type_is(
  'public',
  'profiles',
  'metadata_provider',
  'text',
  'metadata provenance uses text constrained by the database'
);
select col_is_null(
  'public',
  'profiles',
  'metadata_provider',
  'metadata provenance remains nullable for admin-created and unknown legacy rows'
);
select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_metadata_provider_check'
       and pg_get_constraintdef(oid) = 'CHECK (((metadata_provider IS NULL) OR (metadata_provider = ANY (ARRAY[''google''::text, ''github''::text]))))'
  ),
  'metadata provenance is constrained to supported profile metadata sources'
);
select ok(
  not has_column_privilege('anon', 'public.profiles', 'metadata_provider', 'SELECT')
  and not has_column_privilege('authenticated', 'public.profiles', 'metadata_provider', 'SELECT'),
  'browser roles cannot read metadata provenance'
);

insert into auth.users (id, aud, role, email)
values
  ('63000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'provenance-google@example.test'),
  ('63000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'provenance-admin@example.test'),
  ('63000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'provenance-github@example.test'),
  ('63000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'provenance-kakao@example.test');

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('google-provenance-1', '63000000-0000-0000-0000-000000000001', '{"full_name":"Google Provenance"}'::jsonb, 'google')$$,
  'Google provisioning succeeds with durable provenance'
);
select is(
  (select metadata_provider from public.profiles where id = '63000000-0000-0000-0000-000000000001'),
  'google',
  'new Google profiles are marked as Google metadata'
);

select lives_ok(
  $$insert into public.profiles (id, github_user_id, login, display_name, avatar_url)
    values (
      '63000000-0000-0000-0000-000000000002',
      null,
      'admin-created',
      'Admin Controlled',
      'https://example.test/admin.png'
    )$$,
  'an admin-created profile may retain null metadata provenance'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (
      'google-provenance-2',
      '63000000-0000-0000-0000-000000000002',
      '{"full_name":"Must Not Replace Admin","avatar_url":"https://example.test/google.png"}'::jsonb,
      'google'
    )$$,
  'linking Google to an admin-created profile is safe'
);
select is(
  (select metadata_provider from public.profiles where id = '63000000-0000-0000-0000-000000000002'),
  null,
  'linking Google does not claim provenance for an admin-created profile'
);
select is(
  (select jsonb_build_array(login, display_name, avatar_url) from public.profiles where id = '63000000-0000-0000-0000-000000000002'),
  jsonb_build_array('admin-created', 'Admin Controlled', 'https://example.test/admin.png'),
  'linking Google does not overwrite admin-created metadata'
);
select lives_ok(
  $$update auth.identities
       set identity_data = '{"full_name":"Still Must Not Replace Admin"}'::jsonb
     where provider = 'google'
       and provider_id = 'google-provenance-2'$$,
  'Google identity refresh remains safe for null-provenance profiles'
);
select is(
  (select jsonb_build_array(metadata_provider, login, display_name, avatar_url) from public.profiles where id = '63000000-0000-0000-0000-000000000002'),
  jsonb_build_array(null, 'admin-created', 'Admin Controlled', 'https://example.test/admin.png'),
  'Google refresh only updates profiles explicitly marked as Google metadata'
);

select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('63003', '63000000-0000-0000-0000-000000000003', '{"user_name":"disabled-github"}'::jsonb, 'github')$$,
  'GitHub identity insertion remains a no-op'
);
select is(
  (select count(*)::integer from public.profiles where id = '63000000-0000-0000-0000-000000000003'),
  0,
  'GitHub identity insertion creates no profile'
);
select lives_ok(
  $$insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('63004', '63000000-0000-0000-0000-000000000004', '{"name":"Disabled Kakao"}'::jsonb, 'kakao')$$,
  'Kakao identity insertion remains a no-op'
);
select is(
  (select count(*)::integer from public.profiles where id = '63000000-0000-0000-0000-000000000004'),
  0,
  'Kakao identity insertion creates no profile'
);
select lives_ok(
  $$select private.provision_oauth_profile_identity(
      'github',
      '63003',
      '63000000-0000-0000-0000-000000000003',
      '{"user_name":"stale-helper-must-not-run"}'::jsonb
    )$$,
  'replaced helper ignores GitHub even when called directly'
);
select is(
  (select count(*)::integer from public.profiles where id = '63000000-0000-0000-0000-000000000003'),
  0,
  'no stale GitHub helper behavior remains'
);

select * from finish();
rollback;
