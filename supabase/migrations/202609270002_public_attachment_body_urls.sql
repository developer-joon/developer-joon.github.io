-- Rewrite public post attachment references without exposing private Storage paths.

begin;

create function private.public_post_body(
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
  attachment record;
  rewritten text := p_body_markdown;
  public_path text;
  uuid_pattern constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  -- A stored public URL is not proof that its attachment belongs to this post.
  -- Remove every caller-supplied route before introducing authorized routes.
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    '/functions/v1/public-attachment/' || uuid_pattern,
    'about:blank#attachment-unavailable',
    'g'
  );

  for attachment in
    select a.id,a.storage_path
      from public.attachments a
     where a.post_id=p_post_id
       and a.status='attached'
       and a.deleted_at is null
       and a.client_key is not null
       and a.payload_sha256 is not null
       and a.storage_path collate "C" =
         (a.owner_id::text||'/'||a.client_key::text) collate "C"
     order by a.id
  loop
    public_path := '/functions/v1/public-attachment/'||attachment.id::text;

    -- Accept the Storage URL shapes used by Supabase clients, then reduce the
    -- body to the attachment identifier route. Query credentials disappear.
    rewritten := pg_catalog.regexp_replace(
      rewritten,
      'https?://[^[:space:]<>()]+/storage/v1/object/(public/|sign/|authenticated/)?community-images/' ||
        attachment.storage_path || '([?][^[:space:]<>()]*)?',
      public_path,
      'g'
    );
    rewritten := pg_catalog.regexp_replace(
      rewritten,
      '/storage/v1/object/(public/|sign/|authenticated/)?community-images/' ||
        attachment.storage_path || '([?][^[:space:]<>()]*)?',
      public_path,
      'g'
    );
    rewritten := pg_catalog.replace(
      rewritten,
      'community-images/'||attachment.storage_path,
      public_path
    );
    rewritten := pg_catalog.replace(rewritten,attachment.storage_path,public_path);
  end loop;

  -- Fail closed for every remaining Storage endpoint, managed object path, or
  -- forged attachment route. Ordinary Markdown that is unrelated to private
  -- attachment addressing is left byte-for-byte unchanged.
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    'https?://[^[:space:]<>()]+/storage/v1/object/[^[:space:]<>()]+',
    'about:blank#attachment-unavailable',
    'g'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    '/storage/v1/object/[^[:space:]<>()]+',
    'about:blank#attachment-unavailable',
    'g'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    'community-images/'||uuid_pattern||'/'||uuid_pattern||'([?][^[:space:]<>()]*)?',
    'about:blank#attachment-unavailable',
    'g'
  );
  rewritten := pg_catalog.regexp_replace(
    rewritten,
    uuid_pattern||'/'||uuid_pattern||'([?][^[:space:]<>()]*)?',
    'about:blank#attachment-unavailable',
    'g'
  );

  return rewritten;
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
alter function public.get_public_post(uuid) owner to postgres;
revoke all on function private.public_post_body(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
