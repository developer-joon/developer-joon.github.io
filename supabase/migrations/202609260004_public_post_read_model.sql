-- Bounded public post list metrics and a controlled RLS-aware read RPC.

begin;

-- The migration backfill and trigger installation must observe one stable
-- write-free interval. These locks are held until the migration commits.
lock table public.comments, public.post_reactions in share row exclusive mode;

create table private.post_metrics (
  post_id uuid primary key references public.posts(id) on delete cascade,
  comment_count bigint not null default 0 check (comment_count >= 0)
);

create table private.post_reaction_counts (
  post_id uuid not null references public.posts(id) on delete cascade,
  reaction_bucket smallint not null check (reaction_bucket between 0 and 63),
  reaction_count bigint not null default 0 check (reaction_count >= 0),
  primary key (post_id, reaction_bucket)
);

create table private.post_reaction_daily_counts (
  post_id uuid not null references public.posts(id) on delete cascade,
  reaction_date date not null,
  reaction_bucket smallint not null check (reaction_bucket between 0 and 63),
  reaction_count bigint not null default 0 check (reaction_count >= 0),
  primary key (post_id, reaction_date, reaction_bucket)
);
insert into private.post_metrics(post_id, comment_count)
select p.id,
  (select count(*)::bigint from public.comments c where c.post_id=p.id and c.status='published' and c.deleted_at is null)
from public.posts p;

insert into private.post_reaction_counts(post_id,reaction_bucket,reaction_count)
select r.post_id,(get_byte(uuid_send(r.user_id),15)%64)::smallint,count(*)::bigint
from public.post_reactions r
group by r.post_id,(get_byte(uuid_send(r.user_id),15)%64)::smallint;

insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count)
select r.post_id, (r.created_at at time zone 'UTC')::date, (get_byte(uuid_send(r.user_id),15)%64)::smallint, count(*)::bigint
from public.post_reactions r
group by r.post_id,(r.created_at at time zone 'UTC')::date,(get_byte(uuid_send(r.user_id),15)%64)::smallint;

create function private.maintain_public_comment_count()
returns trigger language plpgsql set search_path='' as $$
declare old_public boolean := false; new_public boolean := false;
begin
  if tg_op <> 'INSERT' then old_public := old.status='published' and old.deleted_at is null; end if;
  if tg_op <> 'DELETE' then new_public := new.status='published' and new.deleted_at is null; end if;
  if tg_op <> 'INSERT' and old_public then
    update private.post_metrics
       set comment_count=greatest(0,comment_count-1)
     where post_id=old.post_id;
  end if;
  if tg_op <> 'DELETE' and new_public then
    insert into private.post_metrics(post_id,comment_count) values(new.post_id,1)
    on conflict(post_id) do update set comment_count=private.post_metrics.comment_count+1;
  end if;
  return coalesce(new,old);
end $$;

create trigger comments_maintain_public_count
after insert or delete or update of post_id,status,deleted_at on public.comments
for each row execute function private.maintain_public_comment_count();

create function private.maintain_post_reaction_daily_count()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op <> 'INSERT' then
    update private.post_reaction_counts
       set reaction_count=greatest(0,reaction_count-1)
     where post_id=old.post_id
       and reaction_bucket=(get_byte(uuid_send(old.user_id),15)%64)::smallint;
    update private.post_reaction_daily_counts
       set reaction_count=greatest(0,reaction_count-1)
     where post_id=old.post_id and reaction_date=(old.created_at at time zone 'UTC')::date
       and reaction_bucket=(get_byte(uuid_send(old.user_id),15)%64)::smallint;
  end if;
  if tg_op <> 'DELETE' then
    insert into private.post_reaction_counts(post_id,reaction_bucket,reaction_count)
    values(new.post_id,(get_byte(uuid_send(new.user_id),15)%64)::smallint,1)
    on conflict(post_id,reaction_bucket) do update
      set reaction_count=private.post_reaction_counts.reaction_count+1;
    insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count)
    values(new.post_id,(new.created_at at time zone 'UTC')::date,(get_byte(uuid_send(new.user_id),15)%64)::smallint,1)
    on conflict(post_id,reaction_date,reaction_bucket) do update
      set reaction_count=private.post_reaction_daily_counts.reaction_count+1;
  end if;
  return coalesce(new,old);
end $$;

create trigger post_reactions_maintain_daily_count
after insert or delete or update of user_id,post_id,created_at on public.post_reactions
for each row execute function private.maintain_post_reaction_daily_count();

-- The public RPC sums at most 30 days x 64 indexed buckets per post. Sharding
-- avoids serializing independent users on one hot counter row. This avoids a
-- scheduler dependency while never scanning raw reaction identities per request.
create function private.public_post_counts(p_post_id uuid)
returns table(comment_count bigint,reaction_count bigint,popularity_score bigint)
language sql stable security definer set search_path='' as $$
  select coalesce(m.comment_count,0), coalesce(total.reaction_count,0),
         coalesce(m.comment_count,0)+coalesce(r.recent_reaction_count,0)*2
  from (select 1) seed
  left join private.post_metrics m on m.post_id=p_post_id
  left join lateral (
    select coalesce(sum(a.reaction_count),0)::bigint reaction_count
    from private.post_reaction_counts a
    where a.post_id=p_post_id
  ) total on true
  left join lateral (
    select coalesce(sum(b.reaction_count),0)::bigint recent_reaction_count
    from private.post_reaction_daily_counts b
    where b.post_id=p_post_id
      and b.reaction_date between (statement_timestamp() at time zone 'UTC')::date-29
                              and (statement_timestamp() at time zone 'UTC')::date
  ) r on true
$$;

-- Later attachment migrations replace this implementation. Defining the read
-- model boundary here lets both detail and list reads consume one body mapper.
create function private.public_post_body(p_post_id uuid,p_body_markdown text)
returns text language sql stable set search_path='' as $$
  select p_body_markdown
$$;

create function public.list_public_posts(
  p_sort text,
  p_limit integer,
  p_search text default null,
  p_tag_id uuid default null,
  p_cursor_is_pinned boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_rank bigint default null,
  p_cursor_id uuid default null,
  p_cursor_search_rank real default null
)
returns table(
  row_number bigint,
  id uuid,
  title text,
  excerpt text,
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
  popularity_score bigint,
  rank_key bigint,
  search_rank real
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_search_query tsquery;
  v_candidate_count integer;
begin
  if p_sort not in ('newest','comments','popular') then
    raise exception 'invalid post sort' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if p_search is not null and pg_catalog.char_length(pg_catalog.btrim(p_search)) > 200 then
    raise exception 'invalid search' using errcode='22023';
  end if;
  if (p_cursor_is_pinned is null) <> (p_cursor_created_at is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_id is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_search_rank is null)
     or (p_cursor_is_pinned is null and p_cursor_rank is not null)
     or (p_sort='newest' and p_cursor_rank is not null)
     or (p_sort<>'newest' and p_cursor_is_pinned is not null and p_cursor_rank is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at))
     or (p_cursor_search_rank is not null and not (p_cursor_search_rank >= 0 and p_cursor_search_rank < 1)) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  v_search_query := case
    when p_search is null or pg_catalog.btrim(p_search)='' then null
    else pg_catalog.websearch_to_tsquery('simple',pg_catalog.btrim(p_search))
  end;

  -- Bound anonymous work before evaluating per-post aggregate shards. The
  -- subquery stops as soon as one row beyond the supported capacity is found.
  select pg_catalog.count(*)::integer
    into v_candidate_count
    from (
      select 1
      from public.posts p
      where p.status='published' and p.deleted_at is null
        and (v_search_query is null or
          (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
           pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ v_search_query)
        and (p_tag_id is null or exists(
          select 1 from public.post_tags f
          join public.tags ft on ft.id=f.tag_id and ft.is_active
          where f.post_id=p.id and f.tag_id=p_tag_id
        ))
      limit 5001
    ) bounded_candidates;
  if v_candidate_count > 5000 then
    raise exception 'public post list capacity exceeded' using errcode='54000';
  end if;

  return query
  with candidates as (
    select p.id,p.title,pg_catalog.left(private.public_post_body(p.id,p.body_markdown),180) excerpt,
      p.created_at,p.updated_at,p.is_locked,p.is_pinned,
      pr.id author_id,pr.login author_login,pr.display_name author_display_name,pr.avatar_url author_avatar_url,
      coalesce(t.tags,'[]'::jsonb) tags,
      c.comment_count,c.reaction_count,c.popularity_score,
      case p_sort when 'comments' then c.comment_count when 'popular' then c.popularity_score else null end rank_key,
      case when v_search_query is null then 0::real
           else pg_catalog.ts_rank(s.search_document,v_search_query,32) end search_rank
    from public.posts p
    join public.profiles pr on pr.id=p.author_id
    cross join lateral private.public_post_counts(p.id) c
    cross join lateral (
      select pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
             pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B') search_document
    ) s
    left join lateral (
      select jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'label',t.label) order by t.sort_order,t.label,t.id) tags
      from public.post_tags pt join public.tags t on t.id=pt.tag_id
      where pt.post_id=p.id and t.is_active
    ) t on true
    where p.status='published' and p.deleted_at is null
      and (v_search_query is null or s.search_document @@ v_search_query)
      and (p_tag_id is null or exists(
        select 1 from public.post_tags f
        join public.tags ft on ft.id=f.tag_id and ft.is_active
        where f.post_id=p.id and f.tag_id=p_tag_id
      ))
  ), paged as (
    select x.*
    from candidates x
    where p_cursor_is_pinned is null
       or x.is_pinned < p_cursor_is_pinned
       or (x.is_pinned=p_cursor_is_pinned and (
         (p_sort='newest' and (x.search_rank,x.created_at,x.id)<(p_cursor_search_rank,p_cursor_created_at,p_cursor_id))
         or (p_sort<>'newest' and (x.search_rank,x.rank_key,x.created_at,x.id)<(p_cursor_search_rank,p_cursor_rank,p_cursor_created_at,p_cursor_id))
       ))
    order by x.is_pinned desc,
      x.search_rank desc,
      case when p_sort='comments' then x.comment_count when p_sort='popular' then x.popularity_score end desc nulls last,
      x.created_at desc,x.id desc
    limit p_limit+1
  )
  select row_number() over (
           order by x.is_pinned desc,
             x.search_rank desc,
             case when p_sort='comments' then x.comment_count when p_sort='popular' then x.popularity_score end desc nulls last,
             x.created_at desc,x.id desc
         ), x.*
  from paged x
  order by x.is_pinned desc,
    x.search_rank desc,
    case when p_sort='comments' then x.comment_count when p_sort='popular' then x.popularity_score end desc nulls last,
    x.created_at desc,x.id desc;
end $$;

create function public.get_public_post(p_post_id uuid)
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
  select p.id,p.title,p.body_markdown,p.created_at,p.updated_at,p.is_locked,p.is_pinned,
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

alter function private.maintain_public_comment_count() owner to postgres;
alter function private.maintain_post_reaction_daily_count() owner to postgres;
alter function private.public_post_counts(uuid) owner to postgres;
alter function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) owner to postgres;
alter function public.get_public_post(uuid) owner to postgres;
revoke all on table private.post_metrics,private.post_reaction_counts,private.post_reaction_daily_counts from public,anon,authenticated;
revoke all on function private.maintain_public_comment_count(),private.maintain_post_reaction_daily_count(),private.public_post_counts(uuid) from public,anon,authenticated;
revoke all on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) from public,anon,authenticated;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) to anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
