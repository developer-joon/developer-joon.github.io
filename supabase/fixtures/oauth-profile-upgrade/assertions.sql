do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_metadata_provider_check'
  ) then
    raise exception 'metadata provenance constraint is missing after upgrade';
  end if;

  if (select metadata_provider is distinct from 'google' from public.profiles where id = '64000000-0000-0000-0000-000000000001') then
    raise exception 'eligible original Google profile was not marked google';
  end if;
  if (select metadata_provider is distinct from 'github' from public.profiles where id = '64000000-0000-0000-0000-000000000002') then
    raise exception 'original 001 GitHub profile was not marked github';
  end if;
  if (select metadata_provider is not null from public.profiles where id = '64000000-0000-0000-0000-000000000003') then
    raise exception 'original 001 Kakao profile was incorrectly claimed by the Google migration';
  end if;
  if (select metadata_provider is distinct from 'github' from public.profiles where id = '64000000-0000-0000-0000-000000000004') then
    raise exception 'legacy GitHub profile was not marked github';
  end if;
  if (select metadata_provider is not null from public.profiles where id = '64000000-0000-0000-0000-000000000005') then
    raise exception 'admin-created profile was incorrectly claimed by the Google migration';
  end if;

  if has_column_privilege('anon', 'public.profiles', 'metadata_provider', 'SELECT')
     or has_column_privilege('authenticated', 'public.profiles', 'metadata_provider', 'SELECT') then
    raise exception 'metadata provenance is browser-readable';
  end if;
end
$$;

update auth.identities
   set identity_data = '{"full_name":"Refreshed After 002","avatar_url":"https://example.test/google-refreshed.png"}'::jsonb
 where provider = 'google'
   and provider_id = 'google-upgrade-1';

update auth.identities
   set identity_data = '{"user_name":"stale-github","full_name":"Stale GitHub Must Not Run"}'::jsonb
 where provider = 'github'
   and provider_id = '64002';

update auth.identities
   set identity_data = '{"name":"Stale Kakao Must Not Run"}'::jsonb
 where provider = 'kakao'
   and provider_id = '64003';

update auth.identities
   set identity_data = '{"full_name":"Still Must Not Replace Admin"}'::jsonb
 where provider = 'google'
   and provider_id = 'google-upgrade-5';

insert into auth.users (id, aud, role, email)
values
  ('64000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'upgrade-new-google@example.test'),
  ('64000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'upgrade-new-github@example.test'),
  ('64000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'upgrade-new-kakao@example.test');

insert into auth.identities (provider_id, user_id, identity_data, provider)
values
  ('google-upgrade-6', '64000000-0000-0000-0000-000000000006', '{"full_name":"New Google"}'::jsonb, 'google'),
  ('64007', '64000000-0000-0000-0000-000000000007', '{"user_name":"new-github"}'::jsonb, 'github'),
  ('64008', '64000000-0000-0000-0000-000000000008', '{"name":"New Kakao"}'::jsonb, 'kakao');

do $$
begin
  if not exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000001'
       and metadata_provider = 'google'
       and display_name = 'Refreshed After 002'
       and avatar_url = 'https://example.test/google-refreshed.png'
  ) then
    raise exception '002 did not enable Google metadata refresh';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000002'
       and github_user_id = 64002
       and login = 'old-github'
       and display_name = 'Old GitHub'
       and metadata_provider = 'github'
  ) then
    raise exception 'stale original GitHub helper behavior survived 002';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000003'
       and login = 'kakao-' || md5('64000000-0000-0000-0000-000000000003')
       and display_name = 'Old Kakao'
       and metadata_provider is null
  ) then
    raise exception 'stale original Kakao helper behavior survived 002';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000004'
       and github_user_id = 64004
       and login = 'legacy-github'
       and display_name = 'Legacy GitHub'
       and metadata_provider = 'github'
  ) then
    raise exception 'legacy GitHub profile was not preserved';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000005'
       and login = 'admin-created'
       and display_name = 'Admin Controlled'
       and avatar_url = 'https://example.test/admin.png'
       and metadata_provider is null
  ) then
    raise exception 'Google refresh overwrote admin-created null-provenance metadata';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000006'
       and metadata_provider = 'google'
       and display_name = 'New Google'
  ) then
    raise exception 'new Google identity was not provisioned with provenance';
  end if;
  if exists (
    select 1 from public.profiles
     where id in (
       '64000000-0000-0000-0000-000000000007',
       '64000000-0000-0000-0000-000000000008'
     )
  ) then
    raise exception 'disabled GitHub or Kakao identity was provisioned after 002';
  end if;
end
$$;
