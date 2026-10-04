-- Provision provider-neutral application profiles from trusted Google identities.

alter table public.profiles
  alter column github_user_id drop not null;

drop trigger if exists identities_provision_github_profile on auth.identities;
drop trigger if exists identities_provision_oauth_profile on auth.identities;

drop function if exists private.provision_github_profile();

create function private.provision_oauth_profile_identity(
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

  profile_login := identity_provider || '-' || pg_catalog.md5(identity_user_id::text);

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
    pg_catalog.hashtextextended('oauth-profile-provider:' || identity_provider || ':' || provider_id_text, 0)
  );

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url
  ) values (
    identity_user_id,
    null,
    profile_login,
    profile_display_name,
    profile_avatar_url
  )
  on conflict (id) do nothing;
end;
$$;

alter function private.provision_oauth_profile_identity(text, text, uuid, jsonb) owner to postgres;
revoke all on function private.provision_oauth_profile_identity(text, text, uuid, jsonb) from public, anon, authenticated;

create function private.provision_oauth_profile()
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

create trigger identities_provision_oauth_profile
after insert or update of provider_id, user_id, identity_data, provider on auth.identities
for each row execute function private.provision_oauth_profile();

-- Backfill only pre-existing Google identities whose users are still missing
-- an application profile. Existing legacy profiles are deliberately untouched,
-- and auth-managed rows are never updated merely to fire a trigger.
create function private.backfill_oauth_profiles()
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
