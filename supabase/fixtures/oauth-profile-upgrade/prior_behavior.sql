insert into auth.users (id, aud, role, email)
values
  ('64000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'upgrade-google@example.test'),
  ('64000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'upgrade-github@example.test'),
  ('64000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'upgrade-kakao@example.test'),
  ('64000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'upgrade-legacy-github@example.test'),
  ('64000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'upgrade-admin@example.test'),
  ('64000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'upgrade-backfill-google@example.test');

insert into public.profiles (id, github_user_id, login, display_name, avatar_url)
values
  (
    '64000000-0000-0000-0000-000000000004',
    64004,
    'legacy-github',
    'Legacy GitHub',
    'https://avatars.githubusercontent.com/u/64004'
  ),
  (
    '64000000-0000-0000-0000-000000000005',
    null,
    'admin-created',
    'Admin Controlled',
    'https://example.test/admin.png'
  );

insert into auth.identities (provider_id, user_id, identity_data, provider)
values
  ('google-upgrade-1', '64000000-0000-0000-0000-000000000001', '{"full_name":"Initial Google","avatar_url":"https://example.test/google-initial.png"}'::jsonb, 'google'),
  ('64002', '64000000-0000-0000-0000-000000000002', '{"user_name":"old-github","full_name":"Old GitHub"}'::jsonb, 'github'),
  ('64003', '64000000-0000-0000-0000-000000000003', '{"name":"Old Kakao","picture":"https://example.test/kakao.png"}'::jsonb, 'kakao'),
  ('64004', '64000000-0000-0000-0000-000000000004', '{"user_name":"legacy-github","full_name":"Legacy GitHub"}'::jsonb, 'github'),
  ('google-upgrade-5', '64000000-0000-0000-0000-000000000005', '{"full_name":"Must Not Replace Admin"}'::jsonb, 'google');

update auth.identities
   set identity_data = '{"full_name":"Old Helper Missed Refresh","avatar_url":"https://example.test/google-missed.png"}'::jsonb
 where provider = 'google'
   and provider_id = 'google-upgrade-1';

do $$
begin
  if (select display_name <> 'Initial Google' from public.profiles where id = '64000000-0000-0000-0000-000000000001') then
    raise exception 'original 001 unexpectedly refreshed Google metadata';
  end if;
  if not exists (select 1 from public.profiles where id = '64000000-0000-0000-0000-000000000002' and github_user_id = 64002) then
    raise exception 'original 001 did not provision GitHub';
  end if;
  if not exists (select 1 from public.profiles where id = '64000000-0000-0000-0000-000000000003' and login = 'kakao-' || md5('64000000-0000-0000-0000-000000000003')) then
    raise exception 'original 001 did not provision Kakao';
  end if;
  if (select display_name <> 'Admin Controlled' from public.profiles where id = '64000000-0000-0000-0000-000000000005') then
    raise exception 'original 001 unexpectedly overwrote an existing null-GitHub profile';
  end if;
end
$$;

drop trigger identities_provision_oauth_profile on auth.identities;

insert into auth.identities (provider_id, user_id, identity_data, provider)
values (
  'google-upgrade-9',
  '64000000-0000-0000-0000-000000000009',
  '{"full_name":"  Backfilled Google  ","avatar_url":"http://example.test/not-https.png","email":"private@example.test"}'::jsonb,
  'google'
);

do $$
begin
  if not exists (
    select 1 from auth.identities
     where provider = 'google'
       and provider_id = 'google-upgrade-9'
       and user_id = '64000000-0000-0000-0000-000000000009'
       and pg_catalog.jsonb_typeof(identity_data) = 'object'
  ) then
    raise exception 'eligible Google identity is missing before 002';
  end if;
  if exists (
    select 1 from public.profiles
     where id = '64000000-0000-0000-0000-000000000009'
  ) then
    raise exception 'Google backfill fixture already has a profile before 002';
  end if;
end
$$;
