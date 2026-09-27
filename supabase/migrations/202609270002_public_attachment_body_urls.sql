-- Rewrite public post attachment references without exposing private Storage paths.

begin;

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
  uuid_pattern constant text := '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
  token_end constant text := $re$([?#][^[:space:]<>"')]*)?(?=$|[[:space:]<>"')])$re$;
  bare_end constant text := $re$(?=$|[[:space:]<>"')])$re$;
  unavailable constant text := 'about:blank#attachment-unavailable';
  attachment_ids uuid[];
  storage_paths text[];
  rewritten text := p_body_markdown;
  placeholder text;
  i integer;
begin
  if p_body_markdown is null then
    return null;
  end if;

  -- This is the sanitizer's only relation lookup. A post can have at most five
  -- attached objects; all subsequent work is bounded regex/string processing.
  select coalesce(pg_catalog.array_agg(a.id order by a.id),array[]::uuid[]),
         coalesce(pg_catalog.array_agg(a.storage_path order by a.id),array[]::text[])
    into attachment_ids,storage_paths
    from public.attachments a
   where a.post_id=p_post_id
     and a.status='attached'
     and a.deleted_at is null
     and a.client_key is not null
     and a.payload_sha256 is not null
     and a.storage_path collate "C" =
       (a.owner_id::text||'/'||a.client_key::text) collate "C";

  -- Protect every authorized spelling with an inert placeholder first. This
  -- makes the later fail-closed global passes independent of Markdown form.
  for i in 1..coalesce(pg_catalog.cardinality(attachment_ids),0) loop
    placeholder := 'urn:public-attachment:'||attachment_ids[i]::text;
    rewritten := pg_catalog.regexp_replace(
      rewritten,
      $re$(https?://[^/[:space:]<>]+)?/storage/v1/object/(public/|sign/|authenticated/)?community-images/$re$
        ||storage_paths[i]||token_end,
      placeholder,'g'
    );
    rewritten := pg_catalog.regexp_replace(
      rewritten,
      $re$(https?://[^/[:space:]<>]+)?/functions/v1/public-attachment/$re$
        ||attachment_ids[i]::text||token_end,
      placeholder,'g'
    );
    rewritten := pg_catalog.regexp_replace(
      rewritten,
      $re$(^|[[:space:]<(])community-images/$re$||storage_paths[i]||token_end,
      E'\\1'||placeholder,'g'
    );
    rewritten := pg_catalog.regexp_replace(
      rewritten,
      $re$(^|[[:space:]<(])$re$||storage_paths[i]||token_end,
      E'\\1'||placeholder,'g'
    );
  end loop;

  -- Credential-bearing Markdown titles are presentation-only: omit the whole
  -- title rather than retaining a secret suffix beside a neutralized target.
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$[[:space:]]+("[^"\r\n]*(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[^"\r\n]*"|'[^'\r\n]*(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[^'\r\n]*'|\([^()\r\n]*(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[^()\r\n]*\))(?=\))$re$,
    '','gi'
  );

  -- Neutralize all unprotected managed paths and endpoints, regardless of
  -- whether they occur inline, in a reference, in an autolink, or as text.
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$(https?://[^/[:space:]<>]+)?/storage/v1/object/[^[:space:]<>"')]*$re$,
    unavailable,'g'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$(https?://[^/[:space:]<>]+)?/functions/v1/public-attachment/[^[:space:]<>"')]*$re$,
    unavailable,'g'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$(^|[[:space:]<(])community-images/$re$||uuid_pattern||'/'||uuid_pattern||
      $re$([?#][^[:space:]<>"')]*)?$re$||bare_end,
    E'\\1'||unavailable,'g'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$(^|[[:space:]<(])$re$||uuid_pattern||'/'||uuid_pattern||
      $re$([?#][^[:space:]<>"')]*)?$re$||bare_end,
    E'\\1'||unavailable,'g'
  );

  -- Credential material is unsafe even outside a URL. Consume the complete
  -- value so no query/fragment suffix remains after replacement.
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$https?://[^[:space:]<>"')]*(token|api[_-]?key|signature|service[_-]?role|x-amz-(credential|signature)|sb_secret)[^[:space:]<>"')]*$re$,
    unavailable,'gi'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$(token|api[_-]?key|signature|service[_-]?role|x-amz-(credential|signature))[[:space:]]*=[^[:space:]<>"')]*$re$,
    unavailable,'gi'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,$re$sb_secret_[[:alnum:]_-]+$re$,unavailable,'gi'
  );

  for i in 1..coalesce(pg_catalog.cardinality(attachment_ids),0) loop
    rewritten := pg_catalog.replace(
      rewritten,
      'urn:public-attachment:'||attachment_ids[i]::text,
      '/functions/v1/public-attachment/'||attachment_ids[i]::text
    );
  end loop;
  -- Angle brackets delimit autolinks, but inside an inline link they are only
  -- destination quoting. Remove them there to retain the established output.
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    $re$(\]\()<(/functions/v1/public-attachment/[0-9a-f-]+|about:blank#attachment-unavailable)>([[:space:]]+("[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?\)$re$,
    E'\\1\\2\\3)','g'
  );
  return rewritten;
end;
$$;

drop function if exists private.public_attachment_destination(uuid,text,text);

create or replace function private.public_post_excerpt(p_post_id uuid,p_body_markdown text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_body text;
begin
  if p_body_markdown is null then
    return null;
  end if;
  bounded_body := pg_catalog.left(p_body_markdown,2048);
  if pg_catalog.char_length(p_body_markdown)>2048 and bounded_body !~ '[[:space:]]$' then
    bounded_body := pg_catalog.regexp_replace(bounded_body,'[^[:space:]]*$','','n');
  end if;
  return pg_catalog.left(private.public_post_body(p_post_id,bounded_body),180);
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

alter function private.public_post_body(uuid,text) owner to postgres;
alter function private.public_post_excerpt(uuid,text) owner to postgres;
alter function public.get_public_post(uuid) owner to postgres;
revoke all on function private.public_post_body(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.public_post_excerpt(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
