-- Replace user-editable auth.users metadata provisioning with trusted OAuth
-- identity records managed by Supabase Auth.

drop trigger if exists users_provision_github_profile on auth.users;

drop trigger if exists identities_provision_github_profile on auth.identities;

create or replace function private.provision_github_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_id_text text;
  github_id bigint;
  github_login text;
  github_display_name text;
  github_avatar_url text;
  existing_github_id bigint;
begin
  -- Non-GitHub and malformed identity rows remain valid auth platform rows,
  -- but fail closed by receiving no application profile.
  if new.provider is distinct from 'github' then
    return new;
  end if;

  provider_id_text := pg_catalog.btrim(new.provider_id);
  if provider_id_text is null or provider_id_text !~ '^[0-9]+$' then
    return new;
  end if;

  begin
    github_id := provider_id_text::bigint;
  exception
    when numeric_value_out_of_range then
      return new;
  end;

  if github_id <= 0 then
    return new;
  end if;

  github_login := pg_catalog.btrim(new.identity_data ->> 'user_name');
  if github_login is null
     or pg_catalog.char_length(github_login) not between 1 and 39
     or github_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or github_login ~ '--' then
    return new;
  end if;

  github_display_name := pg_catalog.btrim(new.identity_data ->> 'full_name');
  if github_display_name is not null
     and pg_catalog.char_length(github_display_name) not between 1 and 120 then
    github_display_name := null;
  end if;

  github_avatar_url := pg_catalog.btrim(new.identity_data ->> 'avatar_url');
  if github_avatar_url is not null
     and (
       pg_catalog.char_length(github_avatar_url) not between 1 and 2048
       or github_avatar_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$'
     ) then
    github_avatar_url := null;
  end if;

  -- Serialize both claims that must remain one-to-one. The user lock prevents
  -- concurrent identities from assigning different GitHub ids to one profile;
  -- the provider lock prevents one GitHub id from reaching different users.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-profile-user:' || new.user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-profile-provider:' || github_id::text, 0)
  );

  select p.github_user_id
    into existing_github_id
    from public.profiles as p
   where p.id = new.user_id
   for update;

  if found and existing_github_id <> github_id then
    raise exception 'GitHub identity does not match existing profile'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.profiles as p
     where p.github_user_id = github_id
       and p.id <> new.user_id
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
    new.user_id,
    github_id,
    github_login,
    github_display_name,
    github_avatar_url
  )
  on conflict (id) do update
    set login = excluded.login,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = pg_catalog.clock_timestamp()
    where public.profiles.github_user_id = excluded.github_user_id;

  return new;
end;
$$;

alter function private.provision_github_profile() owner to postgres;
revoke all on function private.provision_github_profile() from public, anon, authenticated;

create trigger identities_provision_github_profile
after insert or update of provider_id, user_id, identity_data, provider on auth.identities
for each row execute function private.provision_github_profile();
