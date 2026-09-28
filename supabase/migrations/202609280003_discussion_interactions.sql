-- Versioned discussion projections and retry-safe desired-state reactions.

begin;

lock table public.comments in share row exclusive mode;

-- Canonicalize every write path, including the still-executable legacy RPCs.
update public.comments set body_markdown=pg_catalog.btrim(body_markdown);

create function private.canonicalize_comment_body()
returns trigger language plpgsql set search_path='' as $$
begin
  new.body_markdown:=pg_catalog.btrim(new.body_markdown);
  return new;
end $$;

create trigger comments_canonicalize_body
before insert or update of body_markdown on public.comments
for each row execute function private.canonicalize_comment_body();

-- A discussion slot is a physical comment row, regardless of moderation state.
update private.post_metrics m
   set comment_count=(select pg_catalog.count(*)::bigint from public.comments c where c.post_id=m.post_id);
insert into private.post_metrics(post_id,comment_count)
select p.id,pg_catalog.count(c.id)::bigint
  from public.posts p left join public.comments c on c.post_id=p.id
 where not exists(select 1 from private.post_metrics m where m.post_id=p.id)
 group by p.id;

create or replace function private.maintain_public_comment_count()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into private.post_metrics(post_id,comment_count) values(new.post_id,1)
    on conflict(post_id) do update set comment_count=private.post_metrics.comment_count+1;
    return new;
  elsif tg_op='DELETE' then
    update private.post_metrics set comment_count=greatest(0::bigint,comment_count-1) where post_id=old.post_id;
    return old;
  elsif new.post_id is distinct from old.post_id then
    update private.post_metrics set comment_count=greatest(0::bigint,comment_count-1) where post_id=old.post_id;
    insert into private.post_metrics(post_id,comment_count) values(new.post_id,1)
    on conflict(post_id) do update set comment_count=private.post_metrics.comment_count+1;
  end if;
  return new;
end $$;

create index comments_post_roots_created_idx
  on public.comments(post_id,created_at,id) where parent_id is null;
create index comments_post_replies_created_idx
  on public.comments(post_id,parent_id,created_at,id) where parent_id is not null;

create function private.public_comment_json(p_comment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when c.status='published' and c.deleted_at is null then
    pg_catalog.jsonb_build_object(
      'id',c.id,'parent_id',c.parent_id,'kind','published',
      'body_markdown',c.body_markdown,'created_at',c.created_at,'updated_at',c.updated_at,
      'author_id',a.id,'author_login',a.login,'author_display_name',a.display_name,'author_avatar_url',a.avatar_url,
      'reaction_count',(select pg_catalog.count(*) from public.comment_reactions r where r.comment_id=c.id),
      'viewer_reacted',coalesce((select true from public.comment_reactions r where r.comment_id=c.id and r.user_id=auth.uid()),false)
    )
  else null end
  from public.comments c join public.profiles a on a.id=c.author_id
  where c.id=p_comment_id
$$;

create function public.get_public_post_v3(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_status text; v_deleted_at timestamptz; v_post jsonb; v_count bigint;
begin
  select p.status,p.deleted_at into v_status,v_deleted_at from public.posts p where p.id=p_post_id;
  if not found then return pg_catalog.jsonb_build_object('kind','not_found'); end if;
  if v_status='hidden' then return pg_catalog.jsonb_build_object('kind','hidden'); end if;
  select coalesce(m.comment_count,0) into v_count from private.post_metrics m where m.post_id=p_post_id;
  v_count:=coalesce(v_count,0);
  if v_status='published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(d) into v_post from public.get_public_post(p_post_id) d;
    if v_post is null then return pg_catalog.jsonb_build_object('kind','not_found'); end if;
    v_post:=v_post||pg_catalog.jsonb_build_object(
      'viewer_reacted',coalesce((select true from public.post_reactions r where r.post_id=p_post_id and r.user_id=auth.uid()),false)
    );
    return pg_catalog.jsonb_build_object('kind','published','post',v_post);
  end if;
  if v_status='deleted' and v_deleted_at is not null and v_count>0 then
    return pg_catalog.jsonb_build_object('kind','deleted','comment_count',v_count);
  end if;
  return pg_catalog.jsonb_build_object('kind','not_found');
end $$;

create function public.list_public_post_comments_v2(
  p_post_id uuid,
  p_limit integer default 50,
  p_cursor_root_created_at timestamptz default null,
  p_cursor_root_id uuid default null,
  p_cursor_is_reply boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_cursors jsonb; v_has_more boolean; v_next_cursor jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_root_created_at is null)<>(p_cursor_root_id is null)
     or (p_cursor_root_created_at is null)<>(p_cursor_is_reply is null)
     or (p_cursor_root_created_at is null)<>(p_cursor_created_at is null)
     or (p_cursor_root_created_at is null)<>(p_cursor_id is null)
     or (p_cursor_root_created_at is not null and (
       not pg_catalog.isfinite(p_cursor_root_created_at) or not pg_catalog.isfinite(p_cursor_created_at)
       or (not p_cursor_is_reply and (p_cursor_root_id<>p_cursor_id or p_cursor_root_created_at<>p_cursor_created_at))
       or (p_cursor_is_reply and p_cursor_root_id=p_cursor_id)
     )) then raise exception 'invalid cursor' using errcode='22023'; end if;

  with roots as materialized (
    select c.id,c.created_at
      from public.posts p join public.comments c on c.post_id=p.id and c.parent_id is null
      left join private.post_metrics m on m.post_id=p.id
     where p.id=p_post_id
       and ((p.status='published' and p.deleted_at is null)
         or (p.status='deleted' and p.deleted_at is not null and coalesce(m.comment_count,0)>0))
       and (p_cursor_root_created_at is null or (c.created_at,c.id)>=(p_cursor_root_created_at,p_cursor_root_id))
     order by c.created_at,c.id
     limit p_limit+1+case when p_cursor_root_created_at is null then 0 else 1 end
  ), bounded as materialized (
    select root.created_at root_created_at,root.id root_id,item.is_reply,
           item.id,item.parent_id,item.status,item.deleted_at,item.created_at,item.payload
      from roots root
      cross join lateral (
        select false is_reply,c.id,c.parent_id,c.status,c.deleted_at,c.created_at,
               case when c.status='published' and c.deleted_at is null then private.public_comment_json(c.id)
                    else pg_catalog.jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.status) end payload
          from public.comments c where c.id=root.id and c.post_id=p_post_id
        union all
        (select true,c.id,c.parent_id,c.status,c.deleted_at,c.created_at,
                case when c.status='published' and c.deleted_at is null then private.public_comment_json(c.id)
                     else pg_catalog.jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.status) end
           from public.comments c
          where c.post_id=p_post_id and c.parent_id=root.id
            and (p_cursor_root_created_at is null
              or (root.created_at,root.id)>(p_cursor_root_created_at,p_cursor_root_id)
              or ((root.created_at,root.id)=(p_cursor_root_created_at,p_cursor_root_id)
                and (true,c.created_at,c.id)>(p_cursor_is_reply,p_cursor_created_at,p_cursor_id)))
          order by c.created_at,c.id limit p_limit+1)
      ) item
     where p_cursor_root_created_at is null
        or (root.created_at,root.id,item.is_reply,item.created_at,item.id)>
           (p_cursor_root_created_at,p_cursor_root_id,p_cursor_is_reply,p_cursor_created_at,p_cursor_id)
     order by root.created_at,root.id,item.is_reply,item.created_at,item.id
     limit p_limit+1
  ), page as materialized (
    select * from bounded order by root_created_at,root_id,is_reply,created_at,id limit p_limit
  )
  select coalesce(pg_catalog.jsonb_agg(payload order by root_created_at,root_id,is_reply,created_at,id),'[]'::jsonb),
         coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('root_created_at',root_created_at,'root_id',root_id,'is_reply',is_reply,'created_at',created_at,'id',id) order by root_created_at,root_id,is_reply,created_at,id),'[]'::jsonb),
         (select pg_catalog.count(*)>p_limit from bounded)
    into v_items,v_cursors,v_has_more from page;
  v_next_cursor:=case when v_has_more then v_cursors->(p_limit-1) else 'null'::jsonb end;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next_cursor);
end $$;

create function public.create_comment_v2(p_post_id uuid,p_parent_id uuid,p_body_markdown text,p_idempotency_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid; v_result jsonb;
begin
  v_id:=public.create_comment(p_post_id,p_parent_id,p_body_markdown,p_idempotency_key);
  v_result:=private.public_comment_json(v_id);
  if v_result is null then raise exception 'created comment is not visible' using errcode='22023'; end if;
  return v_result;
end $$;

create function public.set_post_reaction(p_post_id uuid,p_reacted boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid; v_count bigint;
begin
  perform private.require_read_committed(); v_user:=private.require_user();
  if p_reacted is null then raise exception 'invalid desired reaction state' using errcode='22023'; end if;
  perform 1 from public.posts p where p.id=p_post_id and p.status='published' and p.deleted_at is null and not p.is_locked for share;
  if not found then raise exception 'post not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('post-reaction:'||v_user::text||':'||p_post_id::text,0));
  if p_reacted then insert into public.post_reactions(user_id,post_id) values(v_user,p_post_id) on conflict(user_id,post_id) do nothing;
  else delete from public.post_reactions where user_id=v_user and post_id=p_post_id; end if;
  select pg_catalog.count(*)::bigint into v_count from public.post_reactions where post_id=p_post_id;
  return pg_catalog.jsonb_build_object('reacted',p_reacted,'reaction_count',v_count);
end $$;

create function public.set_comment_reaction(p_comment_id uuid,p_reacted boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid; v_post_id uuid; v_count bigint;
begin
  perform private.require_read_committed(); v_user:=private.require_user();
  if p_reacted is null then raise exception 'invalid desired reaction state' using errcode='22023'; end if;
  select c.post_id into v_post_id from public.comments c where c.id=p_comment_id;
  perform 1 from public.posts p where p.id=v_post_id and p.status='published' and p.deleted_at is null and not p.is_locked for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform 1 from public.comments c where c.id=p_comment_id and c.post_id=v_post_id and c.status='published' and c.deleted_at is null for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment-reaction:'||v_user::text||':'||p_comment_id::text,0));
  if p_reacted then insert into public.comment_reactions(user_id,comment_id) values(v_user,p_comment_id) on conflict(user_id,comment_id) do nothing;
  else delete from public.comment_reactions where user_id=v_user and comment_id=p_comment_id; end if;
  select pg_catalog.count(*)::bigint into v_count from public.comment_reactions where comment_id=p_comment_id;
  return pg_catalog.jsonb_build_object('reacted',p_reacted,'reaction_count',v_count);
end $$;

alter function private.canonicalize_comment_body() owner to postgres;
alter function private.maintain_public_comment_count() owner to postgres;
alter function private.public_comment_json(uuid) owner to postgres;
alter function public.get_public_post_v3(uuid) owner to postgres;
alter function public.list_public_post_comments_v2(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) owner to postgres;
alter function public.create_comment_v2(uuid,uuid,text,text) owner to postgres;
alter function public.set_post_reaction(uuid,boolean) owner to postgres;
alter function public.set_comment_reaction(uuid,boolean) owner to postgres;

revoke all on function private.canonicalize_comment_body() from public,anon,authenticated,service_role;
revoke select on public.comments from anon,authenticated;
revoke all on function private.public_comment_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post_v3(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_public_post_comments_v2(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_comment_v2(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.set_post_reaction(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.set_comment_reaction(uuid,boolean) from public,anon,authenticated,service_role;
revoke execute on function public.toggle_post_reaction(uuid) from authenticated;
revoke execute on function public.toggle_comment_reaction(uuid) from authenticated;
grant execute on function public.get_public_post_v3(uuid) to anon,authenticated;
grant execute on function public.list_public_post_comments_v2(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) to anon,authenticated;
grant execute on function public.create_comment_v2(uuid,uuid,text,text) to authenticated;
grant execute on function public.set_post_reaction(uuid,boolean) to authenticated;
grant execute on function public.set_comment_reaction(uuid,boolean) to authenticated;

commit;
