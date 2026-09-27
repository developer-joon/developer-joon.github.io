-- Safe public post tombstones and constrained comment reads.

begin;

create function public.get_public_post_v2(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.id is null then pg_catalog.jsonb_build_object('kind','not_found')
    when p.status='hidden' then pg_catalog.jsonb_build_object('kind','hidden')
    when p.status='deleted' and visible.comment_count=0 then pg_catalog.jsonb_build_object('kind','not_found')
    when p.status='deleted' then pg_catalog.jsonb_build_object(
      'kind','deleted',
      'comment_count',visible.comment_count
    )
    when p.status='published' and p.deleted_at is null then pg_catalog.jsonb_build_object(
      'kind','published',
      'post',(
        select pg_catalog.to_jsonb(detail)
          from public.get_public_post(p.id) detail
      )
    )
    else pg_catalog.jsonb_build_object('kind','not_found')
  end
  from (values (p_post_id)) requested(id)
  left join public.posts p on p.id=requested.id
  left join lateral (
    select count(*)::bigint comment_count
      from public.comments c
     where c.post_id=p.id
       and c.status='published'
       and c.deleted_at is null
  ) visible on true
$$;

create function public.list_public_post_comments(p_post_id uuid)
returns table(
  row_number bigint,
  id uuid,
  parent_id uuid,
  body_markdown text,
  created_at timestamptz,
  updated_at timestamptz,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.row_number() over (
      order by root.created_at,root.id,c.parent_id is not null,c.created_at,c.id
    ),
    c.id,c.parent_id,c.body_markdown,c.created_at,c.updated_at,
    author.id,author.login,author.display_name,author.avatar_url
  from public.posts p
  join public.comments c
    on c.post_id=p.id and c.status='published' and c.deleted_at is null
  join public.comments root
    on root.id=coalesce(c.parent_id,c.id) and root.post_id=c.post_id
  join public.profiles author on author.id=c.author_id
  where p.id=p_post_id
    and (
      (p.status='published' and p.deleted_at is null)
      or (p.status='deleted' and p.deleted_at is not null)
    )
  order by root.created_at,root.id,c.parent_id is not null,c.created_at,c.id
$$;

alter function public.get_public_post_v2(uuid) owner to postgres;
alter function public.list_public_post_comments(uuid) owner to postgres;

revoke all on function public.get_public_post_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_public_post_comments(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_post_v2(uuid) to anon,authenticated;
grant execute on function public.list_public_post_comments(uuid) to anon,authenticated;

commit;
