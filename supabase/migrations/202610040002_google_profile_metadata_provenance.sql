-- Converge every recorded 001 revision on Google-only profile metadata.

begin;

lock table auth.identities in share row exclusive mode;
lock table public.profiles in share row exclusive mode;

alter table public.profiles
  add column metadata_provider text;

alter table public.profiles
  add constraint profiles_metadata_provider_check
  check (metadata_provider is null or metadata_provider in ('google', 'github'));

-- A legacy GitHub id is durable evidence of GitHub-owned metadata. The
-- deterministic login plus a valid trusted Google identity identifies profiles
-- created by either deployed 001 revision without persisting the provider id.
update public.profiles
   set metadata_provider = 'github'
 where github_user_id is not null;

update public.profiles as p
   set metadata_provider = 'google'
 where p.metadata_provider is null
   and p.github_user_id is null
   and p.login = 'google-' || pg_catalog.md5(p.id::text)
   and exists (
     select 1
       from auth.identities as i
      where i.user_id = p.id
        and i.provider = 'google'
        and pg_catalog.jsonb_typeof(i.identity_data) = 'object'
        and pg_catalog.char_length(pg_catalog.btrim(i.provider_id)) between 1 and 255
        and pg_catalog.btrim(i.provider_id) ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254})$'
   );

create or replace function private.provision_oauth_profile_identity(
  identity_provider text,
  identity_provider_id text,
  identity_user_id uuid,
  identity_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_id_text text;
  profile_login text;
  profile_display_name text;
  profile_avatar_url text;
begin
  if identity_provider is distinct from 'google'
     or identity_user_id is null
     or pg_catalog.jsonb_typeof(identity_data) is distinct from 'object' then
    return;
  end if;

  provider_id_text := pg_catalog.btrim(identity_provider_id);
  if provider_id_text is null
     or pg_catalog.char_length(provider_id_text) not between 1 and 255
     or provider_id_text !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254})$' then
    return;
  end if;

  profile_login := 'google-' || pg_catalog.md5(identity_user_id::text);

  profile_display_name := pg_catalog.btrim(
    coalesce(identity_data ->> 'full_name', identity_data ->> 'name')
  );
  if profile_display_name is not null
     and pg_catalog.char_length(profile_display_name) not between 1 and 120 then
    profile_display_name := null;
  end if;

  profile_avatar_url := pg_catalog.btrim(
    coalesce(identity_data ->> 'avatar_url', identity_data ->> 'picture')
  );
  if profile_avatar_url is not null
     and (
       pg_catalog.char_length(profile_avatar_url) not between 1 and 2048
       or profile_avatar_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$'
     ) then
    profile_avatar_url := null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oauth-profile-user:' || identity_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oauth-profile-provider:google:' || provider_id_text, 0)
  );

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url,
    metadata_provider
  ) values (
    identity_user_id,
    null,
    profile_login,
    profile_display_name,
    profile_avatar_url,
    'google'
  )
  on conflict (id) do update
     set display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         updated_at = pg_catalog.clock_timestamp()
   where public.profiles.metadata_provider = 'google';
end;
$$;

alter function private.provision_oauth_profile_identity(text, text, uuid, jsonb) owner to postgres;
revoke all on function private.provision_oauth_profile_identity(text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function private.provision_oauth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_oauth_profile_identity(
    new.provider,
    new.provider_id,
    new.user_id,
    new.identity_data
  );
  return new;
end;
$$;

alter function private.provision_oauth_profile() owner to postgres;
revoke all on function private.provision_oauth_profile() from public, anon, authenticated;

drop trigger if exists identities_provision_oauth_profile on auth.identities;
create trigger identities_provision_oauth_profile
after insert or update of provider_id, user_id, identity_data, provider on auth.identities
for each row execute function private.provision_oauth_profile();

create or replace function private.backfill_oauth_profiles()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_identity record;
begin
  for trusted_identity in
    select i.provider, i.provider_id, i.user_id, i.identity_data
      from auth.identities as i
     where i.provider = 'google'
       and not exists (
         select 1 from public.profiles as p where p.id = i.user_id
       )
     order by i.user_id, i.provider_id
  loop
    begin
      perform private.provision_oauth_profile_identity(
        trusted_identity.provider,
        trusted_identity.provider_id,
        trusted_identity.user_id,
        trusted_identity.identity_data
      );
    exception
      when unique_violation or check_violation then
        raise warning 'Skipped conflicting OAuth profile backfill for user %', trusted_identity.user_id;
    end;
  end loop;
end;
$$;

alter function private.backfill_oauth_profiles() owner to postgres;
revoke all on function private.backfill_oauth_profiles() from public, anon, authenticated;

select private.backfill_oauth_profiles();

revoke select (metadata_provider) on public.profiles from public, anon, authenticated;
revoke insert (metadata_provider), update (metadata_provider) on public.profiles from public, anon, authenticated;

commit;
