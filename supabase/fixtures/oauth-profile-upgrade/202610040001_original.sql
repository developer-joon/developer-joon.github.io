-- Provision provider-neutral application profiles from trusted OAuth identities.

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
  github_id bigint;
  profile_login text;
  profile_display_name text;
  profile_avatar_url text;
  existing_github_id bigint;
begin
  if identity_provider not in ('google', 'github', 'kakao')
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

  if identity_provider = 'github' then
    if provider_id_text !~ '^[0-9]+$' then
      return;
    end if;

    begin
      github_id := provider_id_text::bigint;
    exception
      when numeric_value_out_of_range then
        return;
    end;

    if github_id <= 0 then
      return;
    end if;

    profile_login := pg_catalog.btrim(identity_data ->> 'user_name');
    if profile_login is null
       or pg_catalog.char_length(profile_login) not between 1 and 39
       or profile_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
       or profile_login ~ '--' then
      return;
    end if;
  else
    profile_login := identity_provider || '-' || pg_catalog.md5(identity_user_id::text);
  end if;

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

  if identity_provider <> 'github' then
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

    return;
  end if;

  select p.github_user_id
    into existing_github_id
    from public.profiles as p
   where p.id = identity_user_id
   for update;

  if found
     and existing_github_id is not null
     and existing_github_id <> github_id then
    raise exception 'GitHub identity does not match existing profile'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.profiles as p
     where p.github_user_id = github_id
       and p.id <> identity_user_id
  ) then
    raise exception 'GitHub identity is already linked to another profile'
      using errcode = '23505';
  end if;

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url
  ) values (
    identity_user_id,
    github_id,
    profile_login,
    profile_display_name,
    profile_avatar_url
  )
  on conflict (id) do update
    set github_user_id = excluded.github_user_id,
        login = excluded.login,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = pg_catalog.clock_timestamp()
    where public.profiles.github_user_id is null
       or public.profiles.github_user_id = excluded.github_user_id;
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

-- Backfill only users that are still missing an application profile. Existing
-- GitHub profiles are deliberately untouched, and auth-managed rows are never
-- updated merely to fire a trigger.
do $$
declare
  trusted_identity record;
begin
  for trusted_identity in
    select i.provider, i.provider_id, i.user_id, i.identity_data
      from auth.identities as i
     where i.provider in ('google', 'github', 'kakao')
       and not exists (
         select 1 from public.profiles as p where p.id = i.user_id
       )
     order by i.user_id,
              case i.provider when 'github' then 0 when 'google' then 1 else 2 end,
              i.provider_id
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
