-- Rewrite public post attachment references without exposing private Storage paths.

begin;

create function private.public_attachment_destination(
  p_post_id uuid,
  p_target text,
  p_title_suffix text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uuid_pattern constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  target text := p_target;
  target_without_angles text;
  target_base text;
  public_path text;
  safe_title_suffix text := coalesce(p_title_suffix,'');
begin
  if pg_catalog.left(target,1)='<' and pg_catalog.right(target,1)='>' then
    target_without_angles := pg_catalog.substr(target,2,pg_catalog.char_length(target)-2);
  else
    target_without_angles := target;
  end if;
  target_base := pg_catalog.regexp_replace(target_without_angles,'[?#].*$','','n');

  -- Titles are presentation-only. Preserve their exact syntax and spacing unless
  -- they contain credential vocabulary, in which case omit the whole title.
  if safe_title_suffix ~* '(^|[^[:alnum:]])(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))([^[:alnum:]]|$)' then
    safe_title_suffix := '';
  end if;

  select '/functions/v1/public-attachment/'||a.id::text
    into public_path
    from public.attachments a
   where a.post_id=p_post_id
     and a.status='attached'
     and a.deleted_at is null
     and a.client_key is not null
     and a.payload_sha256 is not null
     and a.storage_path collate "C" =
       (a.owner_id::text||'/'||a.client_key::text) collate "C"
     and (
       target_base collate "C" = a.storage_path collate "C"
       or target_base collate "C" = ('community-images/'||a.storage_path) collate "C"
       or target_base ~ ('^(https?://[^/]+)?/storage/v1/object/(public/|sign/|authenticated/)?community-images/'||a.storage_path||'$')
       or target_base ~ ('^(https?://[^/]+)?/functions/v1/public-attachment/'||a.id::text||'$')
     )
   order by a.id
   limit 1;

  if public_path is not null then
    return public_path||safe_title_suffix;
  end if;

  -- Only address shapes owned by the attachment subsystem and credential-like
  -- destinations fail closed. Unrelated relative and absolute links survive.
  if target_without_angles ~ ('(^|/)community-images/'||uuid_pattern||'/'||uuid_pattern||'([?#].*)?$')
     or target_without_angles ~ ('^'||uuid_pattern||'/'||uuid_pattern||'([?#].*)?$')
     or target_without_angles ~ '(^|/)storage/v1/object/'
     or target_without_angles ~ '(^|/)functions/v1/public-attachment/'
     or target_without_angles ~* '(^|[^[:alnum:]])(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))([^[:alnum:]]|$)' then
    return 'about:blank#attachment-unavailable'||safe_title_suffix;
  end if;

  return target||coalesce(p_title_suffix,'');
end;
$$;

create or replace function private.public_post_body(
  p_post_id uuid,
  p_body_markdown text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- A deliberately bounded inline-link grammar: link/image label, a bare or
  -- angle-bracket destination, then an optional quoted/single/parenthesized title.
  destination_pattern constant text := $pattern$(!?\[[^]\r\n]*\])\((<[^<>\r\n]*>|[^[:space:]()<>\r\n]+)([[:space:]]+("[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?\)$pattern$;
  remaining text := p_body_markdown;
  rewritten text := '';
  destination_match text[];
  match_position integer;
begin
  if p_body_markdown is null then
    return null;
  end if;

  loop
    destination_match := pg_catalog.regexp_match(remaining,destination_pattern,'n');
    exit when destination_match is null;
    match_position := pg_catalog.strpos(remaining,destination_match[1]||'('||destination_match[2]||coalesce(destination_match[3],'')||')');
    rewritten := rewritten
      || pg_catalog.left(remaining,match_position-1)
      || destination_match[1] || '('
      || private.public_attachment_destination(
           p_post_id,
           destination_match[2],
           destination_match[3]
         )
      || ')';
    remaining := pg_catalog.substr(
      remaining,
      match_position + pg_catalog.char_length(
        destination_match[1]||'('||destination_match[2]||coalesce(destination_match[3],'')||')'
      )
    );
  end loop;

  return rewritten||remaining;
end;
$$;

create or replace function public.get_public_post(p_post_id uuid)
returns table(
  id uuid,
  title text,
  body_markdown text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint
)
language sql stable security definer set search_path='' as $$
  select p.id,p.title,private.public_post_body(p.id,p.body_markdown),
    p.created_at,p.updated_at,p.is_locked,p.is_pinned,
    pr.id,pr.login,pr.display_name,pr.avatar_url,
    coalesce(t.tags,'[]'::jsonb),c.comment_count,c.reaction_count,c.popularity_score
  from public.posts p
  join public.profiles pr on pr.id=p.author_id
  cross join lateral private.public_post_counts(p.id) c
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('id',tag.id,'slug',tag.slug,'label',tag.label)
      order by tag.sort_order,tag.label,tag.id
    ) tags
    from public.post_tags pt
    join public.tags tag on tag.id=pt.tag_id and tag.is_active
    where pt.post_id=p.id
  ) t on true
  where p.id=p_post_id and p.status='published' and p.deleted_at is null
$$;

alter function private.public_attachment_destination(uuid,text,text) owner to postgres;
alter function private.public_post_body(uuid,text) owner to postgres;
alter function public.get_public_post(uuid) owner to postgres;
revoke all on function private.public_attachment_destination(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function private.public_post_body(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
