-- Safe public post tombstones and bounded comment reads.

begin;

-- Root order omits parent_id, so this partial index supports the root keyset walk.
create index comments_public_roots_page_idx
  on public.comments(post_id,created_at,id)
  where parent_id is null and status='published' and deleted_at is null;
-- The narrower reply index bounds each lateral reply seek by parent and cursor.
create index comments_public_replies_page_idx
  on public.comments(post_id,parent_id,created_at,id)
  where parent_id is not null and status='published' and deleted_at is null;

create or replace function public.get_public_post_v2(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_deleted_at timestamptz;
  v_post jsonb;
  v_comment_count bigint;
begin
  select p.status,p.deleted_at
    into v_status,v_deleted_at
    from public.posts p
   where p.id=p_post_id;

  if not found then
    return pg_catalog.jsonb_build_object('kind','not_found');
  end if;
  if v_status='hidden' then
    return pg_catalog.jsonb_build_object('kind','hidden');
  end if;
  if v_status='published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(detail)
      into v_post
      from public.get_public_post(p_post_id) detail;
    if v_post is null then
      return pg_catalog.jsonb_build_object('kind','not_found');
    end if;
    return pg_catalog.jsonb_build_object('kind','published','post',v_post);
  end if;
  if v_status='deleted' and v_deleted_at is not null then
    select pg_catalog.count(*)::bigint
      into v_comment_count
      from public.comments c
      join public.comments root
        on root.id=coalesce(c.parent_id,c.id)
       and root.post_id=c.post_id
       and root.parent_id is null
       and root.status='published'
       and root.deleted_at is null
     where c.post_id=p_post_id
       and c.status='published'
       and c.deleted_at is null;
    if v_comment_count > 0 then
      return pg_catalog.jsonb_build_object('kind','deleted','comment_count',v_comment_count);
    end if;
  end if;
  return pg_catalog.jsonb_build_object('kind','not_found');
end
$$;

create function public.list_public_post_comments(
  p_post_id uuid,
  p_limit integer default 50,
  p_cursor_root_created_at timestamptz default null,
  p_cursor_root_id uuid default null,
  p_cursor_is_reply boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursors jsonb;
  v_has_more boolean;
  v_next_cursor jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if (p_cursor_root_created_at is null) <> (p_cursor_root_id is null)
     or (p_cursor_root_created_at is null) <> (p_cursor_is_reply is null)
     or (p_cursor_root_created_at is null) <> (p_cursor_created_at is null)
     or (p_cursor_root_created_at is null) <> (p_cursor_id is null)
     or (p_cursor_root_created_at is not null and (
       not pg_catalog.isfinite(p_cursor_root_created_at)
       or not pg_catalog.isfinite(p_cursor_created_at)
       or (not p_cursor_is_reply and (
         p_cursor_root_id<>p_cursor_id
         or p_cursor_root_created_at<>p_cursor_created_at
       ))
       or (p_cursor_is_reply and p_cursor_root_id=p_cursor_id)
     )) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  with visible_roots as materialized (
    select root.id,root.created_at
      from public.posts p
      join public.comments root
        on root.post_id=p.id
       and root.parent_id is null
       and root.status='published'
       and root.deleted_at is null
     where p.id=p_post_id
       and (
         (p.status='published' and p.deleted_at is null)
         or (p.status='deleted' and p.deleted_at is not null)
       )
       and (
         p_cursor_root_created_at is null
         or (root.created_at,root.id)>=(p_cursor_root_created_at,p_cursor_root_id)
       )
     order by root.created_at,root.id
     -- A continuation can include its cursor root while yielding no remaining
     -- items from it, so retain one extra root for the item lookahead.
     limit p_limit+1+case when p_cursor_root_created_at is null then 0 else 1 end
  ), bounded_items as materialized (
    select
      root.created_at root_created_at,
      root.id root_id,
      item.is_reply,
      item.id,item.parent_id,item.body_markdown,item.created_at,item.updated_at,
      item.author_id,item.author_login,item.author_display_name,item.author_avatar_url
    from visible_roots root
    cross join lateral (
      select
        false is_reply,
        root_comment.id,root_comment.parent_id,root_comment.body_markdown,
        root_comment.created_at,root_comment.updated_at,
        author.id author_id,author.login author_login,
        author.display_name author_display_name,author.avatar_url author_avatar_url
      from public.comments root_comment
      join public.profiles author on author.id=root_comment.author_id
      where root_comment.id=root.id and root_comment.post_id=p_post_id
      union all
      (
        select
          true,
          reply.id,reply.parent_id,reply.body_markdown,reply.created_at,reply.updated_at,
          author.id,author.login,author.display_name,author.avatar_url
        from public.comments reply
        join public.profiles author on author.id=reply.author_id
        where reply.post_id=p_post_id
          and reply.parent_id=root.id
          and reply.status='published'
          and reply.deleted_at is null
          and (
            p_cursor_root_created_at is null
            or (root.created_at,root.id)>(p_cursor_root_created_at,p_cursor_root_id)
            or (
              (root.created_at,root.id)=(p_cursor_root_created_at,p_cursor_root_id)
              and (true,reply.created_at,reply.id)>
                  (p_cursor_is_reply,p_cursor_created_at,p_cursor_id)
            )
          )
        order by reply.created_at,reply.id
        limit p_limit+1
      )
    ) item
    where p_cursor_root_created_at is null
       or (root.created_at,root.id,item.is_reply,item.created_at,item.id)>
          (p_cursor_root_created_at,p_cursor_root_id,p_cursor_is_reply,p_cursor_created_at,p_cursor_id)
    order by root.created_at,root.id,item.is_reply,item.created_at,item.id
    limit p_limit+1
  ), page_items as materialized (
    select *
      from bounded_items
     order by root_created_at,root_id,is_reply,created_at,id
     limit p_limit
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id',id,
          'parent_id',parent_id,
          'body_markdown',body_markdown,
          'created_at',created_at,
          'updated_at',updated_at,
          'author_id',author_id,
          'author_login',author_login,
          'author_display_name',author_display_name,
          'author_avatar_url',author_avatar_url
        ) order by root_created_at,root_id,is_reply,created_at,id
      ),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'root_created_at',root_created_at,
          'root_id',root_id,
          'is_reply',is_reply,
          'created_at',created_at,
          'id',id
        ) order by root_created_at,root_id,is_reply,created_at,id
      ),
      '[]'::jsonb
    ),
    (select pg_catalog.count(*)>p_limit from bounded_items)
    into v_items,v_cursors,v_has_more
    from page_items;

  v_next_cursor := case when v_has_more then v_cursors->(p_limit-1) else 'null'::jsonb end;
  return pg_catalog.jsonb_build_object(
    'items',v_items,
    'has_more',v_has_more,
    'next_cursor',v_next_cursor
  );
end
$$;

alter function public.get_public_post_v2(uuid) owner to postgres;
alter function public.list_public_post_comments(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) owner to postgres;

revoke all on function public.get_public_post_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_public_post_comments(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_post_v2(uuid) to anon,authenticated;
grant execute on function public.list_public_post_comments(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) to anon,authenticated;

commit;
